/* view.js — all Three.js rendering: follow camera, world grid, food, snakes, names, particles. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CFG, radiusOf, hueOf } from './game.js';

const CAM_DIR = new THREE.Vector3(0, 0.82, 0.58).normalize();
const UP = new THREE.Vector3(0, 1, 0);

const eyeGeo = new THREE.SphereGeometry(0.17, 12, 12);
const pupilGeo = new THREE.SphereGeometry(0.085, 10, 10);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.2 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x061018, roughness: 0.3 });
const skullGeo = new THREE.SphereGeometry(1, 24, 18);
const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.05 });
const RADIAL = 8;
const MAX_RINGS = 300;

function makeTubeGeometry() {
  const geo = new THREE.BufferGeometry();
  const cols = RADIAL + 1;
  const count = MAX_RINGS * cols;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const idx = [];
  for (let r = 0; r < MAX_RINGS - 1; r++) {
    for (let s = 0; s < RADIAL; s++) {
      const a = r * cols + s, b = (r + 1) * cols + s, c = (r + 1) * cols + s + 1, d = r * cols + s + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  return geo;
}

const FOOD_COLORS = { 1: 0.52, 2: 0.9, 3: 0.13 };

const nameRedraws = new Set();
function registerNameRedraw(fn) {
  nameRedraws.add(fn);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { try { fn(); } catch { /* sprite gone */ } });
  }
}

class SnakeView {
  constructor(scene, name, hue) {
    this.scene = scene;
    this.hue = hue;
    this.geo = makeTubeGeometry();
    this.mesh = new THREE.Mesh(this.geo, tubeMat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.colA = new THREE.Color().setHSL(hue, 1.0, 0.6).multiplyScalar(1.25);
    this.colB = new THREE.Color().setHSL((hue + 0.22) % 1, 0.9, 0.5).multiplyScalar(1.1);
    this.tmpC = new THREE.Color();
    this.lastRings = -1;

    this.headMat = new THREE.MeshStandardMaterial({
      color: 0x05070f, roughness: 0.4,
      emissive: new THREE.Color().setHSL(hue, 1, 0.55), emissiveIntensity: 0.45,
    });
    this.head = new THREE.Group();
    const skull = new THREE.Mesh(skullGeo, this.headMat);
    skull.scale.set(1.0, 0.78, 1.4);
    this.head.add(skull);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, eyeMat);
      e.position.set(0.42 * sx, 0.34, 0.72);
      const p = new THREE.Mesh(pupilGeo, pupilMat);
      p.position.set(0, 0, 0.12);
      e.add(p);
      this.head.add(e);
    }
    scene.add(this.head);

    this.sprite = View.makeNameSprite(name, hue);
    scene.add(this.sprite);
  }

  update(pts, thickness, angle, time, scene, showName, fade) {
    const posA = this.geo.attributes.position.array;
    const norA = this.geo.attributes.normal.array;
    const n = Math.min(pts.length, MAX_RINGS);
    const cols = RADIAL + 1;

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const pa = pts[Math.max(0, i - 1)];
      const pb = pts[Math.min(n - 1, i + 1)];
      let tx = pb.x - pa.x, tz = pb.z - pa.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      const wig = Math.sin(time * 4.5 - i * 0.38) * 0.13 * thickness;
      const cx = p.x + nx * wig;
      const cz = p.z + nz * wig;
      const cy = 0.42 + Math.sin(time * 5 - i * 0.5) * 0.02;
      const t = n <= 1 ? 0 : i / (n - 1);
      let rad = thickness;
      if (i === 0) rad *= 0.8; else if (i === 1) rad *= 0.92; else if (i === 2) rad *= 0.98;
      const tailStart = 0.7;
      if (t > tailStart) {
        const k = (t - tailStart) / (1 - tailStart);
        rad *= 1 - 0.9 * k * k;
      }
      for (let s = 0; s <= RADIAL; s++) {
        const phi = (s / RADIAL) * Math.PI * 2;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const o = (i * cols + s) * 3;
        posA[o] = cx + nx * cp * rad;
        posA[o + 1] = cy + sp * rad;
        posA[o + 2] = cz + nz * cp * rad;
        norA[o] = nx * cp;
        norA[o + 1] = sp;
        norA[o + 2] = nz * cp;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (n - 1)) * RADIAL * 6);

    if (this.lastRings !== n) {
      const colA2 = this.geo.attributes.color.array;
      for (let i = 0; i < n; i++) {
        const t = n <= 1 ? 0 : i / (n - 1);
        this.tmpC.copy(this.colA).lerp(this.colB, t);
        const band = 0.86 + 0.14 * Math.sin(i * 1.15);
        for (let s = 0; s <= RADIAL; s++) {
          const o = (i * cols + s) * 3;
          colA2[o] = this.tmpC.r * band;
          colA2[o + 1] = this.tmpC.g * band;
          colA2[o + 2] = this.tmpC.b * band;
        }
      }
      this.geo.attributes.color.needsUpdate = true;
      this.lastRings = n;
    }

    const hp = pts[0];
    this.head.position.set(
      hp.x + Math.cos(angle) * thickness * 0.45, 0.42,
      hp.z + Math.sin(angle) * thickness * 0.45
    );
    this.head.scale.setScalar(thickness);
    this.head.rotation.y = Math.atan2(Math.cos(angle), Math.sin(angle));
    this.headMat.emissiveIntensity = 0.4 + 0.12 * Math.sin(time * 3);

    this.sprite.visible = showName !== false && fade > 0.02;
    this.sprite.material.opacity = 0.95 * fade;
    this.sprite.position.set(hp.x, 0.45 + thickness * 2.1 + 0.8, hp.z);
    const hs = 0.7 + thickness * 0.65;
    this.sprite.scale.set(hs * 3.6, hs, 1);
  }

  dispose(scene) {
    scene.remove(this.mesh, this.head, this.sprite);
    this.geo.dispose();
    this.headMat.dispose();
    if (this.sprite.userData.redraw) nameRedraws.delete(this.sprite.userData.redraw);
    this.sprite.material.map.dispose();
    this.sprite.material.dispose();
  }
}

export class View {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x040713);
    this.scene.fog = new THREE.Fog(0x040713, 45, 170);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
    this.camPos = new THREE.Vector3(0, 24, 17);
    this.boostAmt = 0;

    this.scene.add(new THREE.AmbientLight(0x8fb3ff, 0.7));
    const keyLight = new THREE.DirectionalLight(0xbfefff, 1.0);
    keyLight.position.set(30, 60, 40);
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xff3d9a, 0.35);
    rimLight.position.set(-40, 30, -50);
    this.scene.add(rimLight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.5, 0.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.initGround();
    this.initDust();
    this.initFood();
    this.initParticles();

    this.snakeViews = new Map();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  initGround() {
    const uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0x17e0ff) },
      uBg: { value: new THREE.Color(0x040713) },
      uR: { value: CFG.R },
    };
    this.groundUniforms = uniforms;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec2 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uCam;
        uniform vec3 uColor;
        uniform vec3 uBg;
        uniform float uR;
        varying vec2 vW;
        float gridLine(vec2 p, float size, float w) {
          vec2 g = abs(fract(p / size - 0.5) - 0.5) * size;
          vec2 fw = fwidth(p) * w;
          float lx = 1.0 - smoothstep(0.0, max(fw.x, 1e-4), g.x);
          float ly = 1.0 - smoothstep(0.0, max(fw.y, 1e-4), g.y);
          return max(lx, ly);
        }
        void main() {
          float d = length(vW);
          float camD = distance(vW, uCam.xz);
          float pulse = 0.75 + 0.25 * sin(uTime * 1.6 - d * 0.08);
          vec3 col = uBg;
          col += uColor * gridLine(vW, 4.0, 1.1) * 0.15 * exp(-camD * 0.02) * pulse;
          col += uColor * gridLine(vW, 20.0, 1.3) * 0.3 * exp(-camD * 0.012) * pulse;
          col += uColor * 0.05 * (1.0 - smoothstep(0.0, 60.0, d));
          float ring = 1.0 - smoothstep(0.0, 1.8, abs(d - uR));
          col += uColor * ring * (0.9 + 0.25 * sin(uTime * 2.2));
          col *= 1.0 - smoothstep(uR, uR + 14.0, d) * 0.85;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry((CFG.R + 16) * 2, (CFG.R + 16) * 2), mat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
  }

  initDust() {
    const N = 420;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 40 + Math.random() * 160;
      const th = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(th) * r;
      pos[i * 3 + 1] = -8 + Math.random() * 55;
      pos[i * 3 + 2] = Math.sin(th) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0x7fd8ff, size: 0.22, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.dust);
  }

  initFood() {
    this.foodMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.34, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      700
    );
    this.foodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foodMesh.frustumCulled = false;
    this.foodMesh.count = 0;
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < 700; i++) this.foodMesh.setColorAt(i, c);
    this.scene.add(this.foodMesh);
    this._fm = new THREE.Matrix4();
    this._fc = new THREE.Color();
  }

  setFoodRef(map) { this.foodRef = map; }

  updateFood(time) {
    if (!this.foodRef) return;
    const list = [];
    for (const f of this.foodRef.values()) list.push(f);
    const cx = this.camera.position.x, cz = this.camera.position.z;
    for (const f of list) f._d2 = (f.x - cx) * (f.x - cx) + (f.z - cz) * (f.z - cz);
    list.sort((a, b) => a._d2 - b._d2);
    const n = Math.min(list.length, 700);
    for (let i = 0; i < n; i++) {
      const f = list[i];
      const s = (0.75 + f.v * 0.18) * (1 + 0.08 * Math.sin(time * 3 + f.ph));
      this._v3s = this._v3s || new THREE.Vector3();
      this._v3s.set(f.x, 0.5 + Math.sin(time * 2 + f.ph) * 0.12, f.z);
      this._fm.compose(this._v3s, this._qIdent || (this._qIdent = new THREE.Quaternion()), this._s3s || (this._s3s = new THREE.Vector3(s, s, s)));
      this.foodMesh.setMatrixAt(i, this._fm);
      const hue = FOOD_COLORS[f.v] ?? 0.52;
      this._fc.setHSL((hue + (f.ph % 0.06)) % 1, 1.0, 0.62).multiplyScalar(1.5);
      this.foodMesh.setColorAt(i, this._fc);
    }
    this.foodMesh.count = n;
    this.foodMesh.instanceMatrix.needsUpdate = true;
    if (this.foodMesh.instanceColor) this.foodMesh.instanceColor.needsUpdate = true;
  }

  initParticles() {
    const PMAX = (this.PMAX = 900);
    this.pPos = new Float32Array(PMAX * 3);
    this.pCol = new Float32Array(PMAX * 3);
    this.pBase = new Float32Array(PMAX * 3);
    this.pSize = new Float32Array(PMAX);
    this.pVel = new Float32Array(PMAX * 3);
    this.pLife = new Float32Array(PMAX);
    this.pMaxLife = new Float32Array(PMAX);
    this.pCursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
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
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    this.pGeo = geo;
    this.scene.add(this.particles);
  }

  burst(x, y, z, hex, count, speed = 4) {
    const c = new THREE.Color(hex);
    for (let n = 0; n < count; n++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % this.PMAX;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.35 + Math.random() * 0.9);
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      this.pVel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.8 + 1.2;
      this.pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.pLife[i] = this.pMaxLife[i] = 0.4 + Math.random() * 0.5;
      this.pSize[i] = 0.5 + Math.random() * 1.0;
      const v = 0.7 + Math.random() * 0.5;
      this.pBase[i * 3] = c.r * v; this.pBase[i * 3 + 1] = c.g * v; this.pBase[i * 3 + 2] = c.b * v;
    }
  }

  updateParticles(dt) {
    for (let i = 0; i < this.PMAX; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const k = Math.max(this.pLife[i], 0) / this.pMaxLife[i];
      const kk = k * k;
      this.pCol[i * 3] = this.pBase[i * 3] * kk;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * kk;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * kk;
      if (this.pLife[i] > 0) {
        this.pVel[i * 3 + 1] -= 5.5 * dt;
        this.pPos[i * 3] += this.pVel[i * 3] * dt;
        this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
        this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      }
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.pcolor.needsUpdate = true;
    this.pGeo.attributes.psize.needsUpdate = true;
  }

  static makeNameSprite(name, hue) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 10;
    const draw = () => {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 512, 128);
      ctx.font = '700 54px Orbitron, "Avenir Next", "Trebuchet MS", sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '5px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(3, 8, 18, 0.85)';
      ctx.strokeText(name, 256, 66);
      ctx.fillStyle = `hsl(${(hue * 360) | 0}, 85%, 78%)`;
      ctx.fillText(name, 256, 66);
      tex.needsUpdate = true;
    };
    draw();
    registerNameRedraw(draw);
    sp.userData.redraw = draw;
    return sp;
  }

  /* list: [{id, name, pts, thickness, angle}] */
  updateSnakes(list, time) {
    const seen = new Set();
    for (const item of list) {
      seen.add(item.id);
      let sv = this.snakeViews.get(item.id);
      if (!sv) {
        sv = new SnakeView(this.scene, item.name, hueOf(item.id));
        this.snakeViews.set(item.id, sv);
      }
      const cd = Math.hypot(item.pts[0].x - this.camera.position.x, item.pts[0].z - this.camera.position.z);
      const fade = Math.max(0, Math.min(1, 1.25 - cd / 80));
      sv.update(item.pts, item.thickness, item.angle, time, this.scene, item.showName, fade);
    }
    for (const [id, sv] of this.snakeViews) {
      if (!seen.has(id)) {
        sv.dispose(this.scene);
        this.snakeViews.delete(id);
      }
    }
  }

  follow(head, thickness, boosting, dt) {
    const dist = 13 + thickness * 14;
    const desiredX = head.x + CAM_DIR.x * dist;
    const desiredY = CAM_DIR.y * dist;
    const desiredZ = head.z + CAM_DIR.z * dist;
    const k = 1 - Math.exp(-4.5 * dt);
    this.camPos.x += (desiredX - this.camPos.x) * k;
    this.camPos.y += (desiredY - this.camPos.y) * k;
    this.camPos.z += (desiredZ - this.camPos.z) * k;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(head.x, 0.4, head.z);
    this.boostAmt += ((boosting ? 1 : 0) - this.boostAmt) * (1 - Math.exp(-4 * dt));
    this.groundUniforms.uCam.value.copy(this.camera.position);
  }

  render(dt, time) {
    this.groundUniforms.uTime.value = time;
    this.dust.rotation.y += dt * 0.006;
    this.updateFood(time);
    this.updateParticles(dt);
    this.bloom.strength = 0.85 + this.boostAmt * 0.5;
    this.composer.render();
  }
}
