import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Surface fatal errors in the DOM (also read by the headless smoke test).
window.addEventListener('error', (e) => {
  document.documentElement.dataset.err = String(e.message || 'unknown error');
});

/* ================= config ================= */
const GRID = 17;
const HALF = (GRID - 1) / 2;          // cells at x/z in [-8..8]
const BASE_STEP = 175;                // ms per move at start
const MIN_STEP = 70;
const STEP_GAIN = 3.4;                // ms faster per food
const COLORS = {
  bg: 0x040713,
  grid: 0x17e0ff,
  snakeA: 0x00e5ff,
  snakeB: 0x8a2be2,
  head: 0xd9ffff,
  food: 0xff2e7e,
  wall: 0x0aa8c8,
};
const DIRS = {
  up:    { x: 0, z: -1 },
  down:  { x: 0, z: 1 },
  left:  { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

/* ================= dom ================= */
const $ = (id) => document.getElementById(id);
const scoreEl = $('score');
const bestEl = $('best');
const overlayEl = $('overlay');
const popupsEl = $('popups');
const muteBtn = $('mute-btn');
const panels = { menu: $('panel-menu'), over: $('panel-over'), pause: $('panel-pause') };

function showPanel(name) {
  overlayEl.classList.add('show');
  for (const k in panels) panels[k].classList.toggle('hidden', k !== name);
}
function hideOverlay() { overlayEl.classList.remove('show'); }

function loadBest() { try { return Number(localStorage.getItem('neon-snake-3d-best')) || 0; } catch { return 0; } }
function saveBest(v) { try { localStorage.setItem('neon-snake-3d-best', String(v)); } catch { /* private mode */ } }

/* ================= audio (synthesized, no assets) ================= */
class SFX {
  constructor() { this.ctx = null; this.master = null; this.muted = false; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
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
  eat() {
    this.tone({ type: 'triangle', f0: 540, f1: 1000, dur: 0.11, vol: 0.5 });
    this.tone({ type: 'sine', f0: 1080, f1: 1620, dur: 0.12, vol: 0.22, delay: 0.05 });
  }
  die() {
    this.tone({ type: 'sawtooth', f0: 320, f1: 52, dur: 0.65, vol: 0.4 });
    this.tone({ type: 'square', f0: 160, f1: 36, dur: 0.8, vol: 0.28, delay: 0.05 });
  }
  start() {
    [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.1, vol: 0.3, delay: i * 0.07 }));
  }
  pauseBlip() { this.tone({ type: 'sine', f0: 600, f1: 420, dur: 0.09, vol: 0.22 }); }
}
const sfx = new SFX();

/* ================= renderer / scene / camera ================= */
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
scene.fog = new THREE.Fog(COLORS.bg, 34, 85);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 220);
const CAM_DIR = new THREE.Vector3(0, 0.82, 0.58).normalize();
let camDist = 24;
function fitCamera() {
  const a = window.innerWidth / Math.max(window.innerHeight, 1);
  camDist = THREE.MathUtils.clamp(23 * Math.max(1, 1.35 / a), 23, 42);
}

scene.add(new THREE.AmbientLight(0x8fb3ff, 0.55));
const keyLight = new THREE.DirectionalLight(0xbfefff, 1.1);
keyLight.position.set(6, 14, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xff3d9a, 0.45);
rimLight.position.set(-8, 6, -10);
scene.add(rimLight);

/* ================= post-processing (bloom) ================= */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.5, 0.35);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ================= glowing grid floor ================= */
const gridMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(COLORS.grid) },
    uBase: { value: new THREE.Color(0x0a1230) },
    uWaveT: { value: -10 },
    uWavePos: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec3 uBase;
    uniform float uWaveT;
    uniform vec2 uWavePos;
    varying vec2 vUv;
    void main() {
      vec2 cell = abs(fract(vUv * ${GRID}.0) - 0.5);
      float line = smoothstep(0.44, 0.5, max(cell.x, cell.y));
      float d = distance(vUv, vec2(0.5));
      float pulse = 0.7 + 0.3 * sin(uTime * 1.7 - d * 6.0);
      float centerGlow = 1.0 - smoothstep(0.0, 0.55, d);
      vec3 col = uBase + uColor * line * pulse * (0.3 + 0.22 * centerGlow);
      col += uColor * centerGlow * 0.05;
      float wt = uTime - uWaveT;
      if (wt < 1.4) {
        float wd = distance(vUv, uWavePos);
        float q = (wd - wt * 5.5) * 9.0;
        col += uColor * exp(-q * q) * exp(-wt * 2.6) * 0.9;
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const grid = new THREE.Mesh(new THREE.PlaneGeometry(GRID, GRID), gridMat);
grid.rotation.x = -Math.PI / 2;
scene.add(grid);

/* ================= energy border walls ================= */
const wallMat = new THREE.MeshStandardMaterial({
  color: 0x06202c,
  emissive: new THREE.Color(COLORS.wall),
  emissiveIntensity: 0.7,
  roughness: 0.3,
  metalness: 0.2,
});
const wallGeoX = new THREE.BoxGeometry(GRID + 0.6, 0.35, 0.22);
for (const [x, z, rotY] of [
  [0, HALF + 0.61, 0],
  [0, -HALF - 0.61, 0],
  [HALF + 0.61, 0, Math.PI / 2],
  [-HALF - 0.61, 0, Math.PI / 2],
]) {
  const w = new THREE.Mesh(wallGeoX, wallMat);
  w.position.set(x, 0.17, z);
  w.rotation.y = rotY;
  scene.add(w);
}

/* ================= ambient dust ================= */
const dust = (() => {
  const N = 380;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 24 + Math.random() * 32;
    const th = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(th) * r;
    pos[i * 3 + 1] = -6 + Math.random() * 38;
    pos[i * 3 + 2] = Math.sin(th) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x7fd8ff, size: 0.16, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(p);
  return p;
})();

/* ================= particle bursts ================= */
const PMAX = 800;
const pPos = new Float32Array(PMAX * 3);
const pCol = new Float32Array(PMAX * 3);
const pBase = new Float32Array(PMAX * 3);
const pSize = new Float32Array(PMAX);
const pVel = new Float32Array(PMAX * 3);
const pLife = new Float32Array(PMAX);
const pMaxLife = new Float32Array(PMAX);
let pCursor = 0;

const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('pcolor', new THREE.BufferAttribute(pCol, 3));
pGeo.setAttribute('psize', new THREE.BufferAttribute(pSize, 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float psize;
    attribute vec3 pcolor;
    varying vec3 vColor;
    void main() {
      vColor = pcolor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = psize * (160.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float m = smoothstep(0.5, 0.05, length(c));
      gl_FragColor = vec4(vColor * m, 1.0);
    }
  `,
});
const particles = new THREE.Points(pGeo, pMat);
particles.frustumCulled = false;
scene.add(particles);

function burst(x, y, z, hex, count, speed = 4) {
  const c = new THREE.Color(hex);
  for (let n = 0; n < count; n++) {
    const i = pCursor;
    pCursor = (pCursor + 1) % PMAX;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const sp = speed * (0.35 + Math.random() * 0.9);
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
    pVel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.9 + 1.4;
    pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
    pLife[i] = pMaxLife[i] = 0.45 + Math.random() * 0.55;
    pSize[i] = 0.5 + Math.random() * 1.1;
    const v = 0.7 + Math.random() * 0.5;
    pBase[i * 3] = c.r * v; pBase[i * 3 + 1] = c.g * v; pBase[i * 3 + 2] = c.b * v;
  }
}

function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    const k = Math.max(pLife[i], 0) / pMaxLife[i];
    const kk = k * k;
    pCol[i * 3] = pBase[i * 3] * kk;
    pCol[i * 3 + 1] = pBase[i * 3 + 1] * kk;
    pCol[i * 3 + 2] = pBase[i * 3 + 2] * kk;
    if (pLife[i] > 0) {
      pVel[i * 3 + 1] -= 5.5 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    }
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.pcolor.needsUpdate = true;
  pGeo.attributes.psize.needsUpdate = true;
}

/* ================= snake meshes ================= */
const segGeo = new RoundedBoxGeometry(0.82, 0.82, 0.82, 4, 0.2);
const headGeo = new RoundedBoxGeometry(0.95, 0.95, 0.95, 4, 0.24);
const segPool = [];

function addEyes(head) {
  const eyeGeo = new THREE.SphereGeometry(0.11, 12, 12);
  const pupilGeo = new THREE.SphereGeometry(0.055, 10, 10);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.2 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x061018, roughness: 0.3 });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(0.2 * sx, 0.16, 0.38);
    const p = new THREE.Mesh(pupilGeo, pupilMat);
    p.position.set(0, 0, 0.09);
    e.add(p);
    head.add(e);
  }
}

function getSegMesh(i) {
  while (segPool.length <= i) {
    const idx = segPool.length;
    const m = new THREE.Mesh(idx === 0 ? headGeo : segGeo, new THREE.MeshStandardMaterial({
      color: 0x020409, roughness: 0.32, metalness: 0.15,
    }));
    m.position.y = 0.45;
    scene.add(m);
    if (idx === 0) addEyes(m);
    segPool.push(m);
  }
  return segPool[i];
}

const _cA = new THREE.Color(COLORS.snakeA);
const _cB = new THREE.Color(COLORS.snakeB);
const _tmp = new THREE.Color();

function paintSnake() {
  const n = snake.length;
  for (let i = 0; i < segPool.length; i++) segPool[i].visible = i < n;
  for (let i = 0; i < n; i++) {
    const m = getSegMesh(i);
    const t = n <= 1 ? 0 : i / (n - 1);
    if (i === 0) {
      m.material.emissive.set(COLORS.head);
      m.material.emissiveIntensity = 1.15;
    } else {
      _tmp.copy(_cA).lerp(_cB, t);
      m.material.emissive.copy(_tmp);
      m.material.emissiveIntensity = 0.95 - 0.3 * t;
    }
  }
}

/* ================= food ================= */
const foodGroup = new THREE.Group();
const foodCore = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.34, 0),
  new THREE.MeshStandardMaterial({ color: 0x2a020f, emissive: COLORS.food, emissiveIntensity: 2.2, roughness: 0.25, flatShading: true })
);
const foodHalo = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.52, 1),
  new THREE.MeshBasicMaterial({ color: COLORS.food, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true })
);
const foodLight = new THREE.PointLight(COLORS.food, 16, 8, 1.8);
foodGroup.add(foodCore, foodHalo, foodLight);
scene.add(foodGroup);

/* ================= game state ================= */
let state = 'menu';           // menu | playing | paused | dying | gameover
let snake = [];
let prevSnake = [];
let dir = DIRS.right;
let dirQueue = [];
let food = { x: 3, z: 3 };
let score = 0;
let best = loadBest();
let stepMs = BASE_STEP;
let stepAcc = 0;
let headRotY = 0;
let headPunch = 0;
let eatWaveT = -10;
let shake = 0;
let bloomPunch = 0;
let foodSpawnT = 1;
const par = new THREE.Vector2(0, 0);
const parTarget = new THREE.Vector2(0, 0);

function updateScoreHUD() {
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
}

function resetGame() {
  const c = 0;  // board center: coords run -HALF..HALF, so 0 is the middle
  snake = [{ x: c, z: c }, { x: c - 1, z: c }, { x: c - 2, z: c }];
  prevSnake = snake.map((p) => ({ x: p.x, z: p.z }));
  dir = DIRS.right;
  dirQueue = [];
  score = 0;
  stepMs = BASE_STEP;
  stepAcc = 0;
  headRotY = Math.atan2(dir.x, dir.z);
  headPunch = 0;
  paintSnake();
  for (let i = 0; i < snake.length; i++) {
    segPool[i].position.set(snake[i].x, 0.45, snake[i].z);
    segPool[i].rotation.set(0, headRotY, 0);
    segPool[i].scale.setScalar(1);
  }
  updateScoreHUD();
  spawnFood();
}

function startGame(pressedDir) {
  resetGame();
  if (pressedDir && pressedDir !== DIRS.left) dir = pressedDir;
  headRotY = Math.atan2(dir.x, dir.z);
  segPool[0].rotation.y = headRotY;
  state = 'playing';
  hideOverlay();
  sfx.start();
}

function togglePause() {
  if (state === 'playing') { state = 'paused'; showPanel('pause'); sfx.pauseBlip(); }
  else if (state === 'paused') { state = 'playing'; hideOverlay(); sfx.pauseBlip(); }
}

function spawnFood() {
  const free = [];
  for (let x = -HALF; x <= HALF; x++) {
    for (let z = -HALF; z <= HALF; z++) {
      if (!snake.some((s) => s.x === x && s.z === z)) free.push({ x, z });
    }
  }
  if (!free.length) return; // board full — you have truly won
  food = free[(Math.random() * free.length) | 0];
  foodSpawnT = 0;
  foodGroup.position.set(food.x, 0.55, food.z);
}

function popup(worldPos, text) {
  const v = worldPos.clone().project(camera);
  const s = document.createElement('div');
  s.className = 'pop';
  s.textContent = text;
  s.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  s.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  popupsEl.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
}

function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function step() {
  while (dirQueue.length) {
    const d = dirQueue.shift();
    if (d.x === -dir.x && d.z === -dir.z) continue;
    if (d.x === dir.x && d.z === dir.z) continue;
    dir = d;
    break;
  }
  const head = snake[0];
  const nx = head.x + dir.x;
  const nz = head.z + dir.z;
  if (Math.abs(nx) > HALF || Math.abs(nz) > HALF) { die(); return; }
  const eats = nx === food.x && nz === food.z;
  const checkLen = eats ? snake.length : snake.length - 1;
  for (let i = 0; i < checkLen; i++) {
    if (snake[i].x === nx && snake[i].z === nz) { die(); return; }
  }
  prevSnake = snake.map((p) => ({ x: p.x, z: p.z }));
  snake.unshift({ x: nx, z: nz });
  if (eats) {
    score += 10;
    stepMs = Math.max(MIN_STEP, BASE_STEP - (score / 10) * STEP_GAIN);
    const wx = food.x, wz = food.z;
    burst(wx, 0.6, wz, COLORS.food, 42, 4.5);
    burst(wx, 0.6, wz, 0xffffff, 10, 2.5);
    gridMat.uniforms.uWaveT.value = performance.now() / 1000;
    gridMat.uniforms.uWavePos.value.set(0.5 + wx / GRID, 0.5 - wz / GRID);
    headPunch = 1;
    eatWaveT = performance.now() / 1000;
    sfx.eat();
    popup(new THREE.Vector3(wx, 0.9, wz), '+10');
    updateScoreHUD();
    spawnFood();
    paintSnake();
  } else {
    snake.pop();
  }
}

function die() {
  state = 'dying';
  sfx.die();
  for (let i = 0; i < snake.length; i++) {
    const s = snake[i];
    burst(s.x, 0.5, s.z, i === 0 ? 0xffffff : COLORS.snakeA, i === 0 ? 46 : 12, i === 0 ? 5 : 3.2);
    segPool[i].visible = false;
  }
  shake = 1;
  bloomPunch = 1.3;
  const isBest = score > best;
  if (isBest) { best = score; saveBest(best); updateScoreHUD(); }
  $('final-score').textContent = String(score);
  $('final-best').textContent = String(best);
  $('new-best').classList.toggle('show', isBest);
  setTimeout(() => {
    if (state === 'dying') { state = 'gameover'; showPanel('over'); }
  }, 900);
}

/* ================= input ================= */
function queueDir(d) {
  if (state !== 'playing') return;
  const last = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
  if (d === last) return;
  if (d.x === -last.x && d.z === -last.z) return; // no instant reverse
  if (dirQueue.length < 2) dirQueue.push(d);
}

const keyDirs = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

window.addEventListener('keydown', (e) => {
  sfx.init();
  const dk = keyDirs[e.code];
  if (dk) e.preventDefault();
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (state === 'menu' || state === 'gameover') startGame();
    else if (state === 'paused') togglePause();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'playing' || state === 'paused') togglePause();
    return;
  }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (dk) {
    if (state === 'menu' || state === 'gameover') { startGame(DIRS[dk]); return; }
    queueDir(DIRS[dk]);
  }
});

let touchStart = null;
window.addEventListener('pointerdown', (e) => {
  sfx.init();
  touchStart = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', (e) => {
  if (!touchStart) return;
  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;
  touchStart = null;
  if (e.target && e.target.closest && e.target.closest('button')) return;
  if (Math.hypot(dx, dy) < 24) {
    if (state === 'menu' || state === 'gameover') startGame();
    else if (state === 'paused') togglePause();
    return;
  }
  queueDir(Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? DIRS.right : DIRS.left)
    : (dy > 0 ? DIRS.down : DIRS.up));
});

window.addEventListener('pointermove', (e) => {
  parTarget.set((e.clientX / window.innerWidth - 0.5) * 2, (e.clientY / window.innerHeight - 0.5) * 2);
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') togglePause();
});

function toggleMute() {
  sfx.init();
  sfx.muted = !sfx.muted;
  muteBtn.textContent = sfx.muted ? '\u{1F507}' : '\u{1F50A}';
}
muteBtn.addEventListener('click', toggleMute);
$('btn-play').addEventListener('click', () => { sfx.init(); startGame(); });
$('btn-again').addEventListener('click', () => { sfx.init(); startGame(); });

/* ================= resize ================= */
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  fitCamera();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

/* ================= main loop ================= */
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  const time = now / 1000;

  if (state === 'playing') {
    stepAcc += dt * 1000;
    let guard = 0;
    while (stepAcc >= stepMs && state === 'playing' && guard++ < 8) {
      stepAcc -= stepMs;
      step();
    }
  }

  // snake visuals: interpolate between grid steps
  const t = state === 'playing' ? Math.min(stepAcc / stepMs, 1) : 1;
  const waveAmp = state === 'menu' ? 0.075 : 0.032;
  for (let i = 0; i < snake.length; i++) {
    const m = segPool[i];
    const cur = snake[i];
    const prv = prevSnake[Math.min(i, prevSnake.length - 1)] || cur;
    m.position.x = THREE.MathUtils.lerp(prv.x, cur.x, t);
    m.position.z = THREE.MathUtils.lerp(prv.z, cur.z, t);
    m.position.y = 0.45 + Math.sin(time * 5 - i * 0.55) * waveAmp;
    const wavePos = (time - eatWaveT) * 14;
    const dq = wavePos - i;
    const s = 1 + 0.2 * Math.exp(-dq * dq * 0.35) + (i === 0 ? headPunch * 0.18 : 0);
    m.scale.setScalar(s);
  }
  headPunch = Math.max(0, headPunch - dt * 4);
  if (segPool[0]) {
    headRotY = lerpAngle(headRotY, Math.atan2(dir.x, dir.z), 1 - Math.exp(-14 * dt));
    segPool[0].rotation.y = headRotY;
  }

  // food
  foodSpawnT = Math.min(foodSpawnT + dt * 2.8, 1);
  foodGroup.scale.setScalar(Math.max(easeOutBack(foodSpawnT), 0.001));
  foodGroup.position.y = 0.55 + Math.sin(time * 3.2) * 0.09;
  foodGroup.rotation.y += dt * 1.4;
  foodCore.rotation.x += dt * 0.9;
  foodLight.intensity = 14 + Math.sin(time * 6) * 3;

  // environment
  gridMat.uniforms.uTime.value = time;
  wallMat.emissiveIntensity = 0.55 + 0.2 * Math.sin(time * 2.4);
  dust.rotation.y += dt * 0.008;
  updateParticles(dt);

  // camera: slow drift + mouse parallax + shake
  par.lerp(parTarget, 1 - Math.exp(-3 * dt));
  shake = Math.max(0, shake - dt * 1.5);
  const sx = (Math.random() - 0.5) * shake * 0.9;
  const sy = (Math.random() - 0.5) * shake * 0.9;
  const ox = Math.sin(time * 0.16) * 1.1 + par.x * 1.7 + sx;
  const oy = par.y * 1.0 + sy;
  const oz = Math.cos(time * 0.13) * 0.7;
  camera.position.set(CAM_DIR.x * camDist + ox, CAM_DIR.y * camDist + oy, CAM_DIR.z * camDist + oz);
  camera.lookAt(0, 0.3, 0);

  bloomPunch = Math.max(0, bloomPunch - dt * 2.0);
  bloom.strength = 0.85 + bloomPunch;

  composer.render();
}

/* ================= boot ================= */
bestEl.textContent = String(best);
resetGame();
state = 'menu';
showPanel('menu');
document.documentElement.dataset.booted = '1';
requestAnimationFrame(loop);



/* ================= headless self-test hook (?autopilot=live|eat) =================
   Inert in normal play.
   - ?autopilot=live : just start a game (used for screenshots).
   - ?autopilot=eat  : synchronously drive the real logic - eat on step 1,
     then run into the bottom wall - and report the outcome in the DOM.
   Independent of requestAnimationFrame so it works under headless virtual time. */
const _params = new URLSearchParams(location.search);
const _auto = _params.get('autopilot');
if (_auto) {
  window.__snakeDebug = () => ({ state, score, len: snake.length, head: snake[0] ? { x: snake[0].x, z: snake[0].z } : null });
  try {
    startGame();
    if (_auto !== 'live') {
      food = { x: 0, z: 1 };  // queued turn applies before the move, so this is the bite cell
      dirQueue = [DIRS.down]; // then head for the bottom wall
      let steps = 0;
      while (steps < 40 && state === 'playing') {
        stepAcc = stepMs;
        step();
        steps++;
      }
      document.documentElement.dataset.autopilot =
        'done steps=' + steps + ' state=' + state + ' score=' + score + ' len=' + snake.length +
        ' head=' + snake[0].x + ',' + snake[0].z + ' food=' + food.x + ',' + food.z;
    } else {
      document.documentElement.dataset.autopilot = 'live';
    }
  } catch (e) {
    document.documentElement.dataset.autopilot = 'crash ' + e.message;
  }
}
