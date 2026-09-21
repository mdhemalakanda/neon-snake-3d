/* main.js — game flow, input, network glue, HUD, self-test hooks. */
import { CFG, World, makeSnake, seedTrail, stepKinematics, sampleBody, segCount, radiusOf, hueOf } from './game.js';
import { View } from './view.js';
import { Net, makeRoomCode } from './net.js';

window.addEventListener('error', (e) => {
  document.documentElement.dataset.err = String(e.message || 'unknown error');
});

/* ---------- dom ---------- */
const $ = (id) => document.getElementById(id);
const el = {
  score: $('score'), length: $('length'), lb: $('lb'),
  overlay: $('overlay'), panelMenu: $('panel-menu'), panelOver: $('panel-over'), panelWait: $('panel-wait'),
  nameInput: $('name-input'), codeInput: $('code-input'),
  btnSolo: $('btn-solo'), btnHost: $('btn-host'), btnJoin: $('btn-join'),
  btnAgain: $('btn-again'), btnMenu: $('btn-menu'), btnCopy: $('btn-copy'),
  roomChip: $('room-chip'), roomCode: $('room-code'),
  toast: $('toast'), muteBtn: $('mute-btn'), netStatus: $('net-status'), endBtn: $('end-btn'),
  newBest: $('new-best'), finalScore: $('final-score'), finalBest: $('final-best'), overLb: $('over-lb'),
};

function showPanel(name) {
  el.overlay.classList.add('show');
  for (const p of [el.panelMenu, el.panelOver, el.panelWait]) p.classList.add('hidden');
  ({ menu: el.panelMenu, over: el.panelOver, wait: el.panelWait })[name].classList.remove('hidden');
}
function hideOverlay() { el.overlay.classList.remove('show'); }
let toastTimer = null;
function toast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
}
function netStatus(msg) { el.netStatus.textContent = msg; }
function loadBest() { try { return Number(localStorage.getItem('neon-snake-online-best')) || 0; } catch { return 0; } }
function saveBest(v) { try { localStorage.setItem('neon-snake-online-best', String(v)); } catch { /* private mode */ } }

/* ---------- audio ---------- */
class SFX {
  constructor() { this.ctx = null; this.master = null; this.muted = false; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.3;
    this.master.connect(this.ctx.destination);
  }
  tone(o) {
    if (!this.ctx || this.muted) return;
    const { type = 'sine', f0 = 440, f1 = f0, dur = 0.15, vol = 0.5, delay = 0 } = o;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(f0, 1), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  eat() { this.tone({ type: 'triangle', f0: 560, f1: 1020, dur: 0.1, vol: 0.4 }); }
  die() { this.tone({ type: 'sawtooth', f0: 320, f1: 52, dur: 0.65, vol: 0.4 }); }
  start() { [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.1, vol: 0.28, delay: i * 0.07 })); }
}
const sfx = new SFX();

/* ---------- state ---------- */
const S = {
  screen: 'menu',            // menu | playing | waiting | over
  mode: 'solo',              // solo | host | client
  name: 'SNAKE',
  room: '',
  world: null,
  view: null,
  net: null,
  ownId: 'me',
  own: null,
  remotes: new Map(),
  foods: new Map(),
  lb: [],
  input: { a: -Math.PI / 2 },
  spaceHeld: false, mouseBoost: false, touchBoost: false,
  acc: 0, sendT: 0, hudT: 0,
  lastOwnScore: 0,
  best: loadBest(),
  camHead: { x: 0, z: 0, th: 0.5 },
  hostTries: 0,
};
const boostNow = () => S.spaceHeld || S.mouseBoost || S.touchBoost;

/* ---------- flow ---------- */
function ensureView() {
  if (!S.view) S.view = new View($('game'));
  S.view.setFoodRef(S.foods);
  return S.view;
}

function addBots(n) {
  const names = [...CFG.BOT_NAMES].sort(() => Math.random() - 0.5);
  for (let i = 0; i < n; i++) S.world.addSnake('bot-' + i + '-' + ((Math.random() * 999) | 0), names[i % names.length], true);
}

function startSoloFlow() {
  cleanupNet();
  S.mode = 'solo'; S.ownId = 'me'; S.room = '';
  S.world = new World();
  S.own = S.world.addSnake('me', S.name);
  addBots(CFG.BOT_COUNT_SOLO);
  S.foods = S.world.food;
  el.roomChip.classList.add('hidden');
  beginPlay();
}

function startHostFlow(code) {
  cleanupNet();
  S.mode = 'host'; S.ownId = 'host';
  netStatus('CREATING ROOM ' + code + '...');
  S.net = new Net();
  S.net.host(code, {
    onOpen: () => {
      S.room = code;
      S.world = new World();
      S.own = S.world.addSnake('host', S.name);
      addBots(CFG.BOT_COUNT_ROOM);
      S.foods = S.world.food;
      el.roomCode.textContent = code;
      el.roomChip.classList.remove('hidden');
      netStatus('');
      beginPlay();
      sfx.start();
    },
    onData: handleClientMsg,
    onLeave: (conn) => {
      S.world && S.world.removeSnake(conn.peer);
      toast('A PLAYER LEFT');
    },
    onError: (e) => {
      if (e && e.type === 'unavailable-id' && S.hostTries < 3) {
        S.hostTries++;
        startHostFlow(makeRoomCode());
      } else {
        netStatus(friendlyError(e));
      }
    },
  });
}

function startJoinFlow(code) {
  cleanupNet();
  S.mode = 'client'; S.ownId = null;
  netStatus('CONNECTING TO ' + code + '...');
  S.net = new Net();
  let welcomed = false;
  setTimeout(() => {
    if (!welcomed && S.screen === 'menu') {
      netStatus('ROOM NOT FOUND - CHECK THE CODE');
      cleanupNet();
    }
  }, 12000);
  S.net.join(code, {
    onOpen: (conn) => conn.send({ t: 'hi', n: S.name }),
    onData: (m) => handleHostMsg(m, () => { welcomed = true; }),
    onHostLost: () => {
      if (S.screen !== 'menu') { toast('HOST LEFT THE ARENA'); backToMenu(); }
      else netStatus('ROOM NOT FOUND - CHECK THE CODE');
    },
    onError: (e) => netStatus(friendlyError(e)),
  });
}

function beginPlay() {
  ensureView();
  S.screen = 'playing';
  el.endBtn.classList.remove('hidden');
  S.acc = 0;
  S.lastOwnScore = S.own ? S.own.score : 0;
  hideOverlay();
  netStatus('');
  sfx.start();
}

function endGameNow() {
  if (S.screen !== 'playing') return;
  const score = S.own ? S.own.score | 0 : 0;
  if (S.mode === 'client') {
    S.net && S.net.sendToHost({ t: 'bye' });
    if (S.own) S.own.dead = true;
    gameOver(score, S.lb);
  } else if (S.world && S.own && !S.own.dead) {
    S.world.kill(S.own);
    gameOver(score, S.world.leaderboard());
  } else {
    gameOver(score, S.lb);
  }
}

function backToMenu() {
  cleanupNet();
  S.screen = 'menu';
  el.endBtn.classList.add('hidden');
  S.world = null;
  S.own = null;
  S.remotes.clear();
  S.foods = new Map();
  if (S.view) S.view.setFoodRef(S.foods);
  el.roomChip.classList.add('hidden');
  showPanel('menu');
}

function cleanupNet() {
  if (S.net) { S.net.destroy(); S.net = null; }
  S.hostTries = 0;
  netStatus('');
}

function friendlyError(e) {
  const t = e && e.type;
  if (t === 'unavailable-id') return 'ROOM CODE TAKEN - TRY AGAIN';
  if (t === 'peer-unavailable') return 'ROOM NOT FOUND - CHECK THE CODE';
  if (t === 'network' || t === 'server-error') return 'MULTIPLAYER SERVER UNREACHABLE';
  if (t === 'browser-incompatible') return 'BROWSER DOES NOT SUPPORT WEBRTC';
  return 'CONNECTION ERROR';
}

/* ---------- host message handling ---------- */
function handleClientMsg(conn, m) {
  if (!S.world) return;
  if (m.t === 'hi') {
    let s = S.world.get(conn.peer);
    if (!s) s = S.world.addSnake(conn.peer, m.n);
    else if (s.dead) S.world.respawn(conn.peer);
    conn.send({ t: 'welcome', id: conn.peer, x: s.x, z: s.z, a: s.a, food: S.world.foodList() });
  } else if (m.t === 'i') {
    S.world.setInput(conn.peer, m.a, !!m.b);
  } else if (m.t === 'respawn') {
    const s = S.world.respawn(conn.peer);
    if (s) conn.send({ t: 'spawn', x: s.x, z: s.z, a: s.a });
  } else if (m.t === 'bye') {
    S.world.removeSnake(conn.peer);
  }
}

/* ---------- client message handling ---------- */
function handleHostMsg(m, markWelcomed) {
  if (m.t === 'welcome') {
    markWelcomed && markWelcomed();
    S.ownId = m.id;
    S.own = makeSnake(m.id, S.name, m.x, m.z, m.a);
    S.remotes.clear();
    S.foods = new Map();
    for (const [id, x, z, v] of m.food) S.foods.set(id, { x, z, v, ph: Math.random() * 6.28 });
    el.roomCode.textContent = S.room;
    el.roomChip.classList.remove('hidden');
    beginPlay();
  } else if (m.t === 's') {
    applySnapshot(m);
  } else if (m.t === 'die') {
    gameOver(m.score, m.lb || []);
  } else if (m.t === 'spawn') {
    S.own = makeSnake(S.ownId, S.name, m.x, m.z, m.a);
    S.lastOwnScore = 0;
    S.screen = 'playing';
    el.endBtn.classList.remove('hidden');
    hideOverlay();
  }
}

function applySnapshot(m) {
  if (S.screen === 'menu') return;
  const seen = new Set();
  for (const e of m.snakes) {
    if (e.id === S.ownId) {
      if (S.own) {
        const grew = e.sc > S.lastOwnScore;
        S.own.mass = e.m;
        S.own.score = e.sc;
        S.own.boost = !!e.b;
        const k = 0.12;
        S.own.x += (e.x - S.own.x) * k;
        S.own.z += (e.z - S.own.z) * k;
        if (grew) { sfx.eat(); S.lastOwnScore = e.sc; }
      }
      seen.add(e.id);
      continue;
    }
    let r = S.remotes.get(e.id);
    if (!r) {
      r = makeSnake(e.id, e.n, e.x, e.z, e.a);
      S.remotes.set(e.id, r);
    }
    r.name = e.n;
    r.sa = e.a; r.targetA = e.a;
    r.sm = e.m; r.ssc = e.sc;
    r.boost = !!e.b;
    r.sx = e.x; r.sz = e.z;
    r.snapT = S.time;
    seen.add(e.id);
  }
  for (const [id, r] of S.remotes) {
    if (!seen.has(id)) {
      for (let i = 0; i < 14; i++) S.view.burst(r.x, 0.5, r.z, 0x19c8ff, 6, 3.5);
      S.remotes.delete(id);
    }
  }
  if (S.own && S.screen === 'playing' && S.ownId && !seen.has(S.ownId)) {
    S.snapMiss = (S.snapMiss || 0) + 1;
    if (S.snapMiss > 4) gameOver(S.own.score | 0, S.lb);
  } else S.snapMiss = 0;
  for (const id of m.ea) {
    const f = S.foods.get(id);
    if (f) {
      if (S.own && Math.hypot(f.x - S.own.x, f.z - S.own.z) < 30) S.view.burst(f.x, 0.5, f.z, 0xff2e7e, 8, 3);
      S.foods.delete(id);
    }
  }
  for (const [id, x, z, v] of m.ad) S.foods.set(id, { x, z, v, ph: Math.random() * 6.28 });
  S.lb = m.lb || [];
}

/* ---------- death / respawn ---------- */
function gameOver(score, lbList) {
  if (S.screen === 'over') return;
  S.screen = 'over';
  el.endBtn.classList.add('hidden');
  if (S.own) S.own.dead = true;
  sfx.die();
  const pts = S.own ? sampleBody(S.own) : [];
  for (let i = 0; i < pts.length; i += 4) {
    S.view.burst(pts[i].x, 0.5, pts[i].z, i === 0 ? 0xffffff : 0x19c8ff, i === 0 ? 42 : 7, 4);
  }
  const isBest = score > S.best;
  if (isBest) { S.best = score; saveBest(S.best); }
  el.finalScore.textContent = String(score | 0);
  el.finalBest.textContent = String(S.best);
  el.newBest.classList.toggle('show', isBest);
  renderLb(el.overLb, lbList && lbList.length ? lbList : S.lb, null);
  showPanel('over');
}

function renderLb(ol, entries, meId) {
  ol.innerHTML = entries
    .map(([n, sc, id]) => `<li class="${id && id === meId ? 'me' : ''}"><span>${escapeHtml(String(n))}</span><span class="pts">${sc | 0}</span></li>`)
    .join('');
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function respawnMe() {
  if (S.mode === 'client') {
    showPanel('wait');
    S.screen = 'waiting';
    S.net && S.net.sendToHost({ t: 'respawn' });
  } else if (S.world) {
    S.world.respawn(S.ownId);
    S.own = S.world.get(S.ownId);
    S.lastOwnScore = 0;
    S.screen = 'playing';
    el.endBtn.classList.remove('hidden');
    hideOverlay();
    sfx.start();
  }
}

/* ---------- input ---------- */
const DIR_ANGLES = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };
const keyDirs = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

window.addEventListener('keydown', (e) => {
  sfx.init();
  const dk = keyDirs[e.code];
  if (dk) {
    e.preventDefault();
    S.input.a = DIR_ANGLES[dk];
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (S.screen === 'menu') { startFromMenu('solo'); return; }
    if (S.screen === 'over') { respawnMe(); return; }
    S.spaceHeld = true;
  }
  if (e.code === 'Enter') {
    if (S.screen === 'over') respawnMe();
  }
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') S.spaceHeld = false;
});

const steerPointers = new Map();   // pointerId -> {x0, y0}
let steerPointerId = null;

window.addEventListener('pointerdown', (e) => {
  sfx.init();
  if (S.screen !== 'playing') return;
  if (e.target && e.target.closest && e.target.closest('button')) return;
  if (e.pointerType === 'mouse') {
    S.mouseBoost = true;
    return;
  }
  if (steerPointerId === null) {
    steerPointerId = e.pointerId;
    steerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  } else {
    S.touchBoost = true;
  }
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    const sx = e.clientX - window.innerWidth / 2;
    const sy = e.clientY - window.innerHeight / 2;
    if (Math.abs(sx) + Math.abs(sy) > 8) S.input.a = Math.atan2(sy, sx);
    return;
  }
  const p = steerPointers.get(e.pointerId);
  if (p && e.pointerId === steerPointerId) {
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) > 18) S.input.a = Math.atan2(dy, dx);
  }
});
function pointerEnd(e) {
  if (e.pointerType === 'mouse') { S.mouseBoost = false; return; }
  if (e.pointerId === steerPointerId) steerPointerId = null;
  steerPointers.delete(e.pointerId);
  if (steerPointerId === null) S.touchBoost = false;
}
window.addEventListener('pointerup', pointerEnd);
window.addEventListener('pointercancel', pointerEnd);
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.screen === 'playing' && S.mode !== 'client') {
    /* host keeps simulating so friends keep playing; just drop boost */
    S.spaceHeld = S.mouseBoost = S.touchBoost = false;
  }
});

function toggleMute() {
  sfx.init();
  sfx.muted = !sfx.muted;
  el.muteBtn.textContent = sfx.muted ? '\u{1F507}' : '\u{1F50A}';
}
el.muteBtn.addEventListener('click', toggleMute);

/* ---------- menu wiring ---------- */
function readName() {
  const n = (el.nameInput.value || '').trim().toUpperCase().slice(0, 12);
  S.name = n || 'SNAKE' + ((Math.random() * 90 + 10) | 0);
  try { localStorage.setItem('neon-snake-name', S.name); } catch { /* ignore */ }
}
function startFromMenu(kind) {
  readName();
  const code = (el.codeInput.value || '').trim().toUpperCase();
  if (kind === 'solo') startSoloFlow();
  else if (kind === 'host') startHostFlow(makeRoomCode());
  else if (kind === 'join') {
    if (!/^[A-Z0-9]{3,6}$/.test(code)) { netStatus('ENTER THE 4-LETTER ROOM CODE'); return; }
    S.room = code;
    startJoinFlow(code);
  }
}
el.btnSolo.addEventListener('click', () => { sfx.init(); startFromMenu('solo'); });
el.btnHost.addEventListener('click', () => { sfx.init(); startFromMenu('host'); });
el.btnJoin.addEventListener('click', () => { sfx.init(); startFromMenu('join'); });
el.btnAgain.addEventListener('click', respawnMe);
el.endBtn.addEventListener('click', () => { sfx.init(); endGameNow(); });
el.btnMenu.addEventListener('click', backToMenu);
el.btnCopy.addEventListener('click', () => {
  const link = `${location.origin}${location.pathname}?room=${S.room}`;
  const done = () => toast('INVITE LINK COPIED - SEND IT TO A FRIEND');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(done, () => toast('SHARE THIS URL: ' + link, 5000));
  } else toast('SHARE THIS URL: ' + link, 5000);
});

/* ---------- main loop ---------- */
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  S.time = now / 1000;

  if (S.screen !== 'menu') tick(dt);
  if (S.view) S.view.render(dt, S.time);
}

function tick(dt) {
  const playing = S.screen === 'playing';
  const boost = playing && boostNow();

  if (S.mode === 'client') {
    if (S.own && !S.own.dead && playing) {
      S.own.targetA = S.input.a;
      S.own.boost = boost && S.own.mass > CFG.MIN_BOOST_MASS;
      stepKinematics(S.own, dt);
    }
    for (const r of S.remotes.values()) {
      stepKinematics(r, dt);
      const lead = Math.min(Math.max(S.time - r.snapT, 0), 0.25);
      const tx = r.sx + Math.cos(r.sa) * CFG.SPEED * lead;
      const tz = r.sz + Math.sin(r.sa) * CFG.SPEED * lead;
      const k = Math.min(1, 4 * dt);
      r.x += (tx - r.x) * k;
      r.z += (tz - r.z) * k;
    }
    S.sendT -= dt;
    if (S.sendT <= 0) {
      S.sendT = 0.066;
      S.net && S.net.sendToHost({ t: 'i', a: S.input.a, b: boost ? 1 : 0 });
    }
  } else if (S.world) {
    if (playing) S.world.setInput(S.ownId, S.input.a, boost);
    S.acc += dt;
    let guard = 0;
    while (S.acc >= CFG.TICK && guard++ < 6) {
      S.acc -= CFG.TICK;
      S.world.step(CFG.TICK);
    }
    S.own = S.world.get(S.ownId) || S.own;
    if (S.own && S.own.score > S.lastOwnScore) {
      sfx.eat();
      const h = S.own;
      S.view.burst(h.x + Math.cos(h.a) * 1.2, 0.5, h.z + Math.sin(h.a) * 1.2, 0xff2e7e, 10, 3.5);
      S.lastOwnScore = S.own.score;
    }
    S.sendT -= dt;
    if (S.mode === 'host' && S.sendT <= 0) {
      S.sendT = 0.08;
      const snap = S.world.snapshot();
      for (const d of snap.de) {
        if (d.id === S.ownId) gameOver(d.score, snap.lb);
        else {
          const c = S.net && S.net.conns.get(d.id);
          if (c && c.open) c.send({ t: 'die', score: d.score, lb: snap.lb });
        }
      }
      S.net && S.net.broadcast(snap);
    } else if (S.mode === 'solo') {
      S.world.takeEvents();
    }
  }

  /* render list */
  const list = [];
  if (S.mode === 'client') {
    if (S.own && !S.own.dead) {
      list.push({ id: S.ownId, name: S.name, pts: sampleBody(S.own), thickness: radiusOf(S.own.mass), angle: S.own.a, showName: false });
    }
    for (const r of S.remotes.values()) {
      list.push({ id: r.id, name: r.name, pts: sampleBody(r), thickness: radiusOf(r.mass), angle: r.a, showName: true });
    }
  } else if (S.world) {
    for (const s of S.world.alive()) {
      list.push({ id: s.id, name: s.name, pts: s.body.length ? s.body : sampleBody(s), thickness: radiusOf(s.mass), angle: s.a, showName: s.id !== S.ownId });
    }
  }
  S.view.updateSnakes(list, S.time);

  /* camera */
  const ownAlive = S.own && !S.own.dead;
  if (ownAlive) {
    S.camHead.x = S.own.x;
    S.camHead.z = S.own.z;
    S.camHead.th = radiusOf(S.own.mass);
  }
  S.view.follow(S.camHead, S.camHead.th, ownAlive && boostNow(), dt);

  /* HUD */
  S.hudT -= dt;
  if (S.hudT <= 0) {
    S.hudT = 0.2;
    const myScore = S.own ? S.own.score | 0 : 0;
    el.score.textContent = String(myScore);
    el.length.textContent = String(S.own ? segCount(S.own.mass) : 0);
    let lb = S.lb;
    if (S.mode !== 'client' && S.world) {
      lb = S.world.leaderboard();
      S.lb = lb;
    }
    renderLb(el.lb, lb, S.ownId);
  }
}

/* ---------- self-test hooks (inert in normal play) ---------- */
const params = new URLSearchParams(location.search);

window.__snakeDebug = () => ({
  screen: S.screen, mode: S.mode, score: S.own ? S.own.score | 0 : 0,
  mass: S.own ? S.own.mass : 0, snakes: S.world ? S.world.snakes.size : S.remotes.size + (S.own ? 1 : 0),
});

if (params.get('autopilot') === 'eat') {
  /* synchronous logic test: eat food, grow, then die at the wall. No rAF needed. */
  try {
    const w = new World({ seed: 1234 });
    const me = w.addSnake('T', 'TEST');
    me.x = 0; me.z = 0; me.a = 0; me.targetA = 0;
    seedTrail(me);
    w.spawnFood(4, 0, 3);
    let ticks = 0;
    while (me.score === 0 && ticks < 600) { w.setInput('T', 0, false); w.step(CFG.TICK); ticks++; }
    const ate = me.score > 0 ? 1 : 0;
    const score = me.score;
    const segs = segCount(me.mass);
    me.targetA = Math.atan2(0 - me.z, CFG.R + 9 - me.x);
    while (!me.dead && ticks < 40000) { w.setInput('T', me.targetA, false); w.step(CFG.TICK); ticks++; }
    document.documentElement.dataset.autopilot =
      `ate=${ate} score=${score} segs=${segs} dead=${me.dead} ticks=${ticks} food=${w.food.size}`;
  } catch (e) {
    document.documentElement.dataset.autopilot = 'crash ' + e.message;
  }
} else if (params.get('autopilot') === 'live') {
  S.name = (params.get('name') || 'PILOT').toUpperCase();
  setTimeout(() => {
    startSoloFlow();
    const bot = [...S.world.snakes.values()].find((s) => s.bot);
    if (bot) {
      bot.x = S.own.x + 7; bot.z = S.own.z + 3;
      bot.a = Math.PI; bot.targetA = Math.PI;
      seedTrail(bot);
      bot.name = 'NEARBOT';
    }
  }, 50);
}

if (params.get('nettest') === 'host') {
  S.name = 'HOSTBOT';
  startHostFlow((params.get('room') || makeRoomCode()).toUpperCase());
  setInterval(() => {
    if (S.screen === 'playing') {
      document.documentElement.dataset.net = `hosting peers=${S.net ? S.net.peerCount : 0} snakes=${S.world ? S.world.snakes.size : 0}`;
    }
  }, 500);
} else if (params.get('nettest') === 'join') {
  S.name = 'CLIENTBOT';
  const code = (params.get('room') || '').toUpperCase();
  startJoinFlow(code);
  const iv = setInterval(() => {
    if (S.foods.size > 0) {
      document.documentElement.dataset.net = `client snakes=${S.remotes.size + (S.own ? 1 : 0)} food=${S.foods.size}`;
    }
  }, 500);
}

/* ---------- boot ---------- */
try { S.name = localStorage.getItem('neon-snake-name') || ''; } catch { /* ignore */ }
el.nameInput.value = S.name;
const roomParam = params.get('room');
if (roomParam) el.codeInput.value = roomParam.toUpperCase();
ensureView();
showPanel('menu');
document.documentElement.dataset.booted = '1';
requestAnimationFrame(loop);
