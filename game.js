/* game.js — authoritative world simulation: snakes, food, growth, collisions, bots.
   Pure logic, no rendering. Rendering lives in view.js. */

export const CFG = {
  R: 250,                 // arena radius (world units)
  TICK: 1 / 60,           // fixed simulation step
  SPEED: 9,               // base speed (units/s)
  BOOST: 17,              // boosting speed
  TURN: 3.0,              // turn rate (rad/s)
  TURN_BOOST: 2.3,
  START_MASS: 10,
  SPACING: 0.62,          // distance between rendered body segments
  MAX_SEGS: 300,
  FOOD_MIN: 220,
  FOOD_PER_PLAYER: 16,
  FOOD_MAX: 520,
  BOOST_DRAIN: 2.4,       // mass lost per second while boosting
  BOOST_DROP_T: 0.4,      // pellet drop interval while boosting
  MIN_BOOST_MASS: 9,
  BOT_COUNT_SOLO: 5,
  BOT_COUNT_ROOM: 3,
  BOT_NAMES: ['KAA', 'MAMBA', 'KRAIT', 'COILZ', 'HISSA', 'SLINK', 'VYPE', 'NAGA', 'SNEK', 'BOA'],
};

export const segCount = (mass) => Math.min(CFG.MAX_SEGS, 6 + Math.floor(mass * 0.55));
export const radiusOf = (mass) => 0.42 + Math.min(0.85, Math.sqrt(mass) * 0.028);

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function hueOf(id) {
  let h = 0;
  const str = String(id);
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return ((h % 360) / 360 + 0.52) % 1; // bias away from red so names stay readable
}

/* Seed a body trail stretching behind the head so snakes don't "grow out" of a point. */
export function seedTrail(s) {
  s.trail.length = 0;
  s.trailD.length = 0;
  const dx = -Math.cos(s.a), dz = -Math.sin(s.a);
  for (let i = 60; i >= 1; i--) {
    s.trail.push({ x: s.x + dx * i * 0.15, z: s.z + dz * i * 0.15 });
    s.trailD.push((60 - i) * 0.15);
  }
  s.trailDist = 9;
}

export function makeSnake(id, name, x, z, a) {
  const s = {
    id, name: String(name || 'SNAKE').slice(0, 12).toUpperCase(),
    x, z, a, targetA: a, boost: false,
    mass: CFG.START_MASS, score: 0,
    dead: false, respawnT: 0, dropT: 0, thinkT: 0,
    wpx: 0, wpz: 0, wpt: 0,
    trail: [], trailD: [], trailDist: 0,
    body: [],
  };
  seedTrail(s);
  return s;
}

/* One kinematic tick: turn toward target angle, move, grow the trail. */
export function stepKinematics(s, dt) {
  const tr = s.boost ? CFG.TURN_BOOST : CFG.TURN;
  const da = wrapAngle(s.targetA - s.a);
  s.a = wrapAngle(s.a + Math.max(-tr * dt, Math.min(tr * dt, da)));
  const sp = s.boost ? CFG.BOOST : CFG.SPEED;
  const mx = Math.cos(s.a) * sp * dt, mz = Math.sin(s.a) * sp * dt;
  s.x += mx; s.z += mz;
  s.trail.push({ x: s.x, z: s.z });
  s.trailDist += Math.hypot(mx, mz);
  s.trailD.push(s.trailDist);
  const need = segCount(s.mass) * CFG.SPACING + 4;
  while (s.trailD.length > 2 && s.trailDist - s.trailD[1] > need) {
    s.trail.shift();
    s.trailD.shift();
  }
}

/* Resample the trail into evenly spaced body points, head first. */
export function sampleBody(s) {
  const n = segCount(s.mass);
  const pts = [{ x: s.x, z: s.z }];
  let px = s.x, pz = s.z;
  let i = s.trail.length - 1;
  let dNeeded = CFG.SPACING;
  while (pts.length < n && i >= 0) {
    const q = s.trail[i];
    const dx = px - q.x, dz = pz - q.z;
    const segd = Math.hypot(dx, dz);
    if (segd > 1e-6 && segd >= dNeeded) {
      const t = dNeeded / segd;
      px = q.x + dx * t;
      pz = q.z + dz * t;
      pts.push({ x: px, z: pz });
      dNeeded = CFG.SPACING;
    } else {
      dNeeded -= segd;
      px = q.x; pz = q.z;
      i--;
    }
  }
  while (pts.length < n) {
    const l = pts[pts.length - 1];
    pts.push({ x: l.x, z: l.z });
  }
  return pts;
}

export class World {
  constructor(opts = {}) {
    this.seed = opts.seed ?? ((Math.random() * 2 ** 31) | 0);
    this.rng = mulberry32(this.seed);
    this.food = new Map();      // id -> {x, z, v, ph}
    this.foodSeq = 1;
    this.snakes = new Map();    // id -> snake
    this.time = 0;
    this.eatenIds = [];         // food deltas since last takeEvents()
    this.addedFoods = [];       // [id, x, z, v]
    this.deaths = [];           // {id, name, score}
    for (let i = 0; i < CFG.FOOD_MIN + CFG.FOOD_PER_PLAYER; i++) this.spawnFood();
  }

  spawnFood(x = null, z = null, v = null) {
    if (x === null) {
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * (CFG.R - 8);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      v = [1, 1, 2, 2, 3][(this.rng() * 5) | 0];
    }
    const id = this.foodSeq++;
    this.food.set(id, { x, z, v, ph: this.rng() * Math.PI * 2 });
    this.addedFoods.push([id, +x.toFixed(1), +z.toFixed(1), v]);
    return id;
  }

  addSnake(id, name, bot = false) {
    const a = this.rng() * Math.PI * 2;
    const r = this.rng() * CFG.R * 0.35;
    const s = makeSnake(id, name, Math.cos(a) * r, Math.sin(a) * r, a);
    s.bot = bot;
    this.snakes.set(id, s);
    return s;
  }

  respawn(id) {
    const s = this.snakes.get(id);
    if (!s) return null;
    const a = this.rng() * Math.PI * 2;
    const r = this.rng() * CFG.R * 0.35;
    s.x = Math.cos(a) * r;
    s.z = Math.sin(a) * r;
    s.a = this.rng() * Math.PI * 2;
    s.targetA = s.a;
    s.mass = CFG.START_MASS;
    s.score = 0;
    s.dead = false;
    s.boost = false;
    seedTrail(s);
    return s;
  }

  removeSnake(id) { this.snakes.delete(id); }
  get(id) { return this.snakes.get(id); }

  setInput(id, a, boost) {
    const s = this.snakes.get(id);
    if (!s || s.dead) return;
    s.targetA = a;
    s.boost = !!boost && s.mass >= CFG.MIN_BOOST_MASS;
  }

  foodTarget() {
    let players = 0;
    for (const s of this.snakes.values()) if (!s.bot) players++;
    return Math.min(CFG.FOOD_MAX, CFG.FOOD_MIN + players * CFG.FOOD_PER_PLAYER);
  }

  step(dt) {
    this.time += dt;
    while (this.food.size < this.foodTarget()) this.spawnFood();
    for (const s of this.snakes.values()) {
      if (s.dead) {
        if (s.bot) {
          s.respawnT -= dt;
          if (s.respawnT <= 0) this.respawn(s.id);
        }
        continue;
      }
      stepKinematics(s, dt);
      if (s.boost) {
        s.mass = Math.max(CFG.MIN_BOOST_MASS * 0.7, s.mass - CFG.BOOST_DRAIN * dt);
        s.dropT -= dt;
        if (s.dropT <= 0) {
          s.dropT = CFG.BOOST_DROP_T;
          const tail = s.body.length ? s.body[s.body.length - 1] : s;
          this.spawnFood(tail.x + (this.rng() - 0.5), tail.z + (this.rng() - 0.5), 1);
        }
      }
      this.eatFood(s);
      s.body = sampleBody(s);
      const rr = radiusOf(s.mass);
      if (Math.hypot(s.x, s.z) > CFG.R - rr * 0.5) { this.kill(s); continue; }
      for (const o of this.snakes.values()) {
        if (o === s || o.dead) continue;
        const ro = radiusOf(o.mass);
        const hdx = o.x - s.x, hdz = o.z - s.z;
        const hh = (rr + ro) * 0.9;
        if (hdx * hdx + hdz * hdz < hh * hh) { this.kill(s); this.kill(o); break; }
        const lim = rr * 0.9 + ro * 0.85;
        const lim2 = lim * lim;
        let hit = false;
        const b = o.body;
        for (let j = 2; j < b.length; j += 2) {
          const dx = b[j].x - s.x, dz = b[j].z - s.z;
          if (dx * dx + dz * dz < lim2) { hit = true; break; }
        }
        if (hit) { this.kill(s); break; }
      }
    }
    for (const s of this.snakes.values()) {
      if (s.bot && !s.dead) botThink(this, s, dt);
    }
  }

  eatFood(s) {
    const rr = radiusOf(s.mass) * 1.5 + 0.5;
    const rr2 = rr * rr;
    for (const [id, f] of this.food) {
      const dx = f.x - s.x, dz = f.z - s.z;
      if (dx * dx + dz * dz < rr2) {
        this.food.delete(id);
        this.eatenIds.push(id);
        s.mass += f.v * 1.1;
        s.score += f.v;
      }
    }
  }

  kill(s) {
    if (s.dead) return;
    s.dead = true;
    const b = s.body.length ? s.body : [s];
    for (let j = 0; j < b.length; j += 2) this.spawnFood(b[j].x, b[j].z, 2);
    this.deaths.push({ id: s.id, name: s.name, score: s.score });
    if (s.bot) s.respawnT = 3;
  }

  takeEvents() {
    const e = { eaten: this.eatenIds, added: this.addedFoods, deaths: this.deaths };
    this.eatenIds = [];
    this.addedFoods = [];
    this.deaths = [];
    return e;
  }

  alive() {
    const out = [];
    for (const s of this.snakes.values()) if (!s.dead) out.push(s);
    return out;
  }

  leaderboard() {
    return this.alive()
      .map((s) => [s.name, s.score | 0, s.id])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }

  snapshot() {
    const snakes = [];
    for (const s of this.alive()) {
      snakes.push({
        id: s.id, n: s.name,
        x: +s.x.toFixed(2), z: +s.z.toFixed(2),
        a: +s.a.toFixed(3), m: +s.mass.toFixed(1),
        sc: s.score | 0, b: s.boost ? 1 : 0,
      });
    }
    const ev = this.takeEvents();
    return { t: 's', snakes, lb: this.leaderboard(), ea: ev.eaten, ad: ev.added, de: ev.deaths };
  }

  foodList() {
    const out = [];
    for (const [id, f] of this.food) out.push([id, +f.x.toFixed(1), +f.z.toFixed(1), f.v]);
    return out;
  }
}

/* Bot AI: avoid the border, dodge bodies, chase food, wander, rare boost. */
function botThink(w, s, dt) {
  s.thinkT -= dt;
  if (s.thinkT > 0) return;
  s.thinkT = 0.1 + Math.random() * 0.1;
  const rr = radiusOf(s.mass);
  const rad = Math.hypot(s.x, s.z);
  if (rad > CFG.R - 22) {
    s.targetA = Math.atan2(-s.z, -s.x) + (Math.random() - 0.5) * 0.7;
    s.boost = false;
    return;
  }
  const la = 5 + rr * 4;
  const fx = s.x + Math.cos(s.a) * la, fz = s.z + Math.sin(s.a) * la;
  for (const o of w.snakes.values()) {
    if (o === s || o.dead) continue;
    const b = o.body;
    for (let j = 0; j < b.length; j += 3) {
      const dx = b[j].x - fx, dz = b[j].z - fz;
      if (dx * dx + dz * dz < 16) {
        s.targetA = Math.atan2(s.z - b[j].z, s.x - b[j].x);
        s.boost = false;
        return;
      }
    }
  }
  let best = null, bd = 60 * 60;
  for (const f of w.food.values()) {
    const dx = f.x - s.x, dz = f.z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = f; }
  }
  if (best) {
    s.targetA = Math.atan2(best.z - s.z, best.x - s.x);
  } else {
    if (s.wpt <= 0 || Math.hypot(s.wpx - s.x, s.wpz - s.z) < 8) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (CFG.R - 30);
      s.wpx = Math.cos(a) * r;
      s.wpz = Math.sin(a) * r;
      s.wpt = 8;
    }
    s.wpt -= 0.12;
    s.targetA = Math.atan2(s.wpz - s.z, s.wpx - s.x);
  }
  s.boost = s.mass > 40 && Math.random() < 0.05;
}
