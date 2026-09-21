/* view.js — all Three.js rendering: jungle world, realistic species snakes, prey, particles.
   No grid, no neon: procedural ground textures, real-time sun shadows, wind-swayed vegetation. */
import * as THREE from 'three';
import { CFG, SPECIES, speciesFor, mulberry32 } from './game.js';

const CAM_DIR = new THREE.Vector3(0, 0.82, 0.58).normalize();

const RADIAL = 10;
const MAX_RINGS = 300;
const REPEAT_LEN = 5.5;   // world units per texture repeat along the body

/* ------------------------------------------------------------------ */
/* canvas helpers                                                      */
/* ------------------------------------------------------------------ */

function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* overlapping scale rows; cell size tiles both axes so the texture wraps cleanly */
function paintScales(ctx, w, h, dark = 0.1, light = 0.06) {
  const cell = 16;
  let row = -1;
  for (let y = -cell; y < h + cell; y += cell, row++) {
    const off = (row & 1) ? cell / 2 : 0;
    for (let x = -cell; x < w + cell; x += cell) {
      ctx.beginPath();
      ctx.arc(x + off, y, cell * 0.62, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(10, 8, 4, ${dark})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + off, y - 2, cell * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 250, 235, ${light})`;
      ctx.fill();
    }
  }
}

/* grayscale scale relief, shared bump map for all species */
let bumpCanvasCache = null;
function scaleBumpCanvas() {
  if (bumpCanvasCache) return bumpCanvasCache;
  const cv = makeCanvas(256, 512);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 512);
  const cell = 16;
  let row = -1;
  for (let y = -cell; y < 512 + cell; y += cell, row++) {
    const off = (row & 1) ? cell / 2 : 0;
    for (let x = -cell; x < 256 + cell; x += cell) {
      ctx.beginPath();
      ctx.arc(x + off, y, cell * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + off, y - 2, cell * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fill();
    }
  }
  bumpCanvasCache = cv;
  return cv;
}

/* species body texture: u wraps the tube (u 0.25 = spine, 0.75 = belly), v runs along it */
function paintSpeciesMap(sp, idx, v) {
  const w = 256, h = 512;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(991 + idx * 131 + v * 977);
  const wrapY = (y, fn) => { fn(y - h); fn(y); fn(y + h); };

  ctx.fillStyle = sp.base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    ctx.globalAlpha = 0.05 + rnd() * 0.06;
    ctx.fillStyle = rnd() < 0.5 ? sp.dark : sp.light;
    ctx.fillRect(0, rnd() * h, w, 20 + rnd() * 60);
  }
  ctx.globalAlpha = 1;

  /* belly band (cream, around u = 0.75) */
  let g = ctx.createLinearGradient(140, 0, 244, 0);
  g.addColorStop(0, hexA(sp.base, 0));
  g.addColorStop(0.42, hexA(sp.belly, 0.95));
  g.addColorStop(0.6, hexA(sp.belly, 1));
  g.addColorStop(1, hexA(sp.base, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  /* corn snake checkered belly */
  if (idx === 7) {
    for (let y = 0; y < h + 16; y += 16) {
      ctx.fillStyle = hexA(sp.dark, 0.4);
      const sh = (y / 16) & 1;
      for (const yy of [y, y - h, y + h]) ctx.fillRect(172, yy + (sh ? 0 : 8), 40, 8);
    }
  }

  /* dorsal shading along the spine (u = 0.25 => x = 64) */
  g = ctx.createLinearGradient(16, 0, 128, 0);
  g.addColorStop(0, hexA(sp.dark, 0));
  g.addColorStop(0.5, hexA(sp.dark, 0.3));
  g.addColorStop(1, hexA(sp.dark, 0));
  ctx.fillStyle = g;
  ctx.fillRect(16, 0, 112, h);

  const P = sp.pattern;
  if (P === 'bands') {
    const y0 = rnd() * 110;
    for (let k = 0; y0 + k * 112 < h + 60; k++) {
      const y = y0 + k * 112;
      const rx = 30 + rnd() * 8;
      wrapY(y, (yy) => {
        const gg = ctx.createLinearGradient(0, yy, 0, yy + 30);
        gg.addColorStop(0, hexA(sp.light, 0.72));
        gg.addColorStop(1, hexA(sp.light, 0));
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.ellipse(64, yy + 10, rx, 17, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexA(sp.dark, 0.5);
        ctx.beginPath();
        ctx.ellipse(64, yy + 30, rx * 0.8, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  } else if (P === 'retic') {
    const step = 52, off = rnd() * step;
    ctx.lineCap = 'round';
    for (let k = -1; off + k * step < h + step; k++) {
      const y = off + k * step;
      const j1 = (rnd() - 0.5) * 16, j2 = (rnd() - 0.5) * 16;
      wrapY(y, (yy) => {
        ctx.strokeStyle = hexA(sp.dark, 0.85);
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(18 + j1, yy - 26);
        ctx.lineTo(64, yy);
        ctx.lineTo(110 + j2, yy - 26);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(64, yy);
        ctx.lineTo(18 + j1, yy + 26);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(64, yy);
        ctx.lineTo(110 + j2, yy + 26);
        ctx.stroke();
      });
      const dy = y + step / 2;
      wrapY(dy, (yy) => {
        ctx.fillStyle = hexA(sp.light, 0.55);
        ctx.beginPath();
        ctx.ellipse(64, yy, 9, 13, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  } else if (P === 'blotches') {
    const step = 96, off = rnd() * step;
    for (let k = -1; off + k * step < h + step; k++) {
      const y = off + k * step;
      const jx = (rnd() - 0.5) * 24;
      wrapY(y, (yy) => {
        ctx.fillStyle = hexA(sp.dark, 0.85);
        ctx.beginPath();
        ctx.ellipse(64 + jx, yy, 28, 36, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexA(sp.light, 0.35);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(64 + jx, yy, 17, 23, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      const sy = y + 48;
      wrapY(sy, (yy) => {
        ctx.fillStyle = hexA(sp.dark, 0.5);
        ctx.beginPath();
        ctx.ellipse(18 + jx * 0.4, yy, 9, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(110 + jx * 0.4, yy, 9, 14, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  } else if (P === 'saddles') {
    const step = 128, off = rnd() * step;
    for (let k = -1; off + k * step < h + step; k++) {
      const y = off + k * step;
      wrapY(y, (yy) => {
        ctx.fillStyle = hexA(sp.dark, 0.78);
        ctx.beginPath();
        ctx.ellipse(64, yy, 44, 26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexA(sp.light, 0.4);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(64, yy, 30, 15, 0, 0, Math.PI * 2);
        ctx.stroke();
      });
      const sy = y + 62;
      wrapY(sy, (yy) => {
        ctx.fillStyle = hexA(sp.dark, 0.5);
        ctx.beginPath();
        ctx.ellipse(20, yy, 7, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(108, yy, 7, 11, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  } else if (P === 'zigzag') {
    const seg = 36, off = rnd() * seg;
    const pts = [];
    for (let k = -4; off + k * seg < h * 2; k++) pts.push([64 + ((k & 1) ? 21 : -21), off + k * seg]);
    const strokeZig = (yy, lw, style) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1] + yy);
        else ctx.lineTo(pts[i][0], pts[i][1] + yy);
      }
      ctx.stroke();
    };
    for (const oy of [-h, 0, h]) {
      strokeZig(oy, 16, hexA(sp.light, 0.9));
      strokeZig(oy + 9, 5, hexA(sp.dark, 0.45));
    }
  }

  if (P === 'solid') {
    for (let i = 0; i < 130; i++) {
      ctx.fillStyle = rnd() < 0.5 ? hexA(sp.dark, 0.14) : hexA(sp.light, 0.12);
      ctx.beginPath();
      ctx.ellipse(20 + rnd() * 96, rnd() * h, 2 + rnd() * 5, 3 + rnd() * 8, rnd(), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* fine speckle + scales */
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,250,230,0.04)';
    ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
  paintScales(ctx, w, h, 0.09, 0.05);
  return cv;
}

function paintHeadTexture(sp) {
  const cv = makeCanvas(128, 128);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = sp.base;
  ctx.fillRect(0, 0, 128, 128);
  let g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, hexA(sp.dark, 0.4));
  g.addColorStop(0.55, hexA(sp.base, 0));
  g.addColorStop(1, hexA(sp.belly, 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  paintScales(ctx, 128, 128, 0.13, 0.06);
  return cv;
}

function paintGroundCanvas() {
  const size = 2048;
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(20260921);

  ctx.fillStyle = '#4a402c';
  ctx.fillRect(0, 0, size, size);

  const blotches = ['#544833', '#423c2a', '#564e37', '#3e4826', '#574833', '#444d2e'];
  for (let i = 0; i < 150; i++) {
    ctx.globalAlpha = 0.1 + rnd() * 0.16;
    ctx.fillStyle = blotches[(rnd() * blotches.length) | 0];
    ctx.beginPath();
    ctx.ellipse(rnd() * size, rnd() * size, 40 + rnd() * 150, 30 + rnd() * 120, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const moss = ['#3c4d2b', '#445530', '#35452a'];
  for (let i = 0; i < 110; i++) {
    ctx.globalAlpha = 0.14 + rnd() * 0.16;
    ctx.fillStyle = moss[(rnd() * moss.length) | 0];
    ctx.beginPath();
    ctx.ellipse(rnd() * size, rnd() * size, 25 + rnd() * 80, 20 + rnd() * 60, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const litter = ['#5c452a', '#6b5232', '#493826', '#7a5f3a', '#454a2c', '#6b5c33', '#523d28'];
  for (let i = 0; i < 2400; i++) {
    ctx.globalAlpha = 0.22 + rnd() * 0.26;
    ctx.fillStyle = litter[(rnd() * litter.length) | 0];
    const w = 7 + rnd() * 13;
    ctx.save();
    ctx.translate(rnd() * size, rnd() * size);
    ctx.rotate(rnd() * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, w * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* dappled canopy shade drifting across the floor */
  for (let i = 0; i < 130; i++) {
    const x = rnd() * size, y = rnd() * size, r = 60 + rnd() * 150;
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
    g2.addColorStop(0, 'rgba(15, 20, 9, ' + (0.06 + rnd() * 0.07).toFixed(3) + ')');
    g2.addColorStop(1, 'rgba(15, 20, 9, 0)');
    ctx.fillStyle = g2;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  ctx.strokeStyle = '#4e6a33';
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.25 + rnd() * 0.3;
    ctx.strokeStyle = ['#4e6a33', '#5c7a3c', '#42552c'][(rnd() * 3) | 0];
    ctx.lineWidth = 1 + rnd();
    const x = rnd() * size, y = rnd() * size;
    ctx.beginPath();
    for (let b = 0; b < 3; b++) {
      const bx = x + (rnd() - 0.5) * 6;
      ctx.moveTo(bx, y);
      ctx.lineTo(bx + (rnd() - 0.5) * 5, y - 4 - rnd() * 7);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  let g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, 380);
  g.addColorStop(0, 'rgba(216, 205, 150, 0.1)');
  g.addColorStop(1, 'rgba(216, 205, 150, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const half = size / 2;
  g = ctx.createRadialGradient(half, half, half * 0.68, half, half, half);
  g.addColorStop(0, 'rgba(10, 14, 6, 0)');
  g.addColorStop(0.75, 'rgba(10, 14, 6, 0.55)');
  g.addColorStop(1, 'rgba(8, 11, 5, 0.94)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return cv;
}

function paintGrassTexture() {
  const cv = makeCanvas(64, 64);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(777);
  /* a few FAT blades with hard edges — thin alpha strokes darken in the mip chain */
  const blade = (bx, bh, lean, color, w0) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(bx - w0, 64);
    ctx.quadraticCurveTo(bx - w0 * 0.5 + lean * 0.4, 64 - bh * 0.55, bx + lean, 64 - bh);
    ctx.quadraticCurveTo(bx + w0 * 0.5 + lean * 0.4, 64 - bh * 0.55, bx + w0, 64);
    ctx.fill();
  };
  const cols = ['#567f36', '#639142', '#4a6e2e', '#6f9c4b'];
  for (let i = 0; i < 3; i++) {
    const bx = 14 + i * 16 + (rnd() - 0.5) * 8;
    blade(bx, 46 + rnd() * 16, (rnd() - 0.5) * 20, cols[(rnd() * cols.length) | 0], 8 + rnd() * 4);
  }
  return cv;
}

function paintLeafTexture() {
  const cv = makeCanvas(128, 128);
  const ctx = cv.getContext('2d');
  /* bleed pass: fat translucent leaf underneath so edges don't darken when minified */
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#5d8c3e';
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.bezierCurveTo(118, 32, 118, 94, 64, 122);
  ctx.bezierCurveTo(10, 94, 10, 32, 64, 6);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#527f36';
  ctx.beginPath();
  ctx.moveTo(64, 8);
  ctx.bezierCurveTo(110, 34, 110, 92, 64, 120);
  ctx.bezierCurveTo(18, 92, 18, 34, 64, 8);
  ctx.fill();
  ctx.strokeStyle = '#7fb558';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 16);
  ctx.lineTo(64, 112);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(58, 92, 40, 0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const y = 32 + i * 20;
    ctx.beginPath();
    ctx.moveTo(64, y);
    ctx.lineTo(64 - 32, y + 14);
    ctx.moveTo(64, y);
    ctx.lineTo(64 + 32, y + 14);
    ctx.stroke();
  }
  return cv;
}

/* fan of leaves radiating from the base — reads as a small plant/clump */
function paintPlantTexture() {
  const cv = makeCanvas(128, 128);
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(555);
  const leaf = (ang, len, w, color, alpha) => {
    ctx.save();
    ctx.translate(64, 122);
    ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-w, -len * 0.55, 0, -len);
    ctx.quadraticCurveTo(w, -len * 0.55, 0, 0);
    ctx.fill();
    ctx.restore();
  };
  const cols = ['#527f36', '#5f8f40', '#477030', '#6a9c48'];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 4 - 0.5) * 2.0 + (rnd() - 0.5) * 0.1;
    const len = 70 + rnd() * 34;
    const col = cols[(rnd() * cols.length) | 0];
    leaf(ang, len, 22 + rnd() * 9, col, 0.96);
  }
  ctx.globalAlpha = 1;
  return cv;
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function makeTubeGeometry() {
  const geo = new THREE.BufferGeometry();
  const cols = RADIAL + 1;
  const count = MAX_RINGS * cols;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  for (let r = 0; r < MAX_RINGS; r++) {
    for (let s = 0; s <= RADIAL; s++) {
      uv[(r * cols + s) * 2] = s / RADIAL;
      uv[(r * cols + s) * 2 + 1] = (r * CFG.SPACING) / REPEAT_LEN;
    }
  }
  const idx = [];
  for (let r = 0; r < MAX_RINGS - 1; r++) {
    for (let s = 0; s < RADIAL; s++) {
      const a = r * cols + s, b = (r + 1) * cols + s, c = (r + 1) * cols + s + 1, d = r * cols + s + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

function crossQuadsGeometry(w, h) {
  const pos = [], uv = [], nor = [], idx = [];
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2;
    const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    /* both windings so the card has no backface (fake up-normal stays lit) */
    for (let f = 0; f < 2; f++) {
      const o = pos.length / 3;
      pos.push(-dx, 0, -dz, dx, 0, dz, dx, h, dz, -dx, h, -dz);
      for (let i = 0; i < 4; i++) { nor.push(0, 1, 0); uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); }
      if (f === 0) idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      else idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/* wind sway for instanced foliage: gentle sinusoids phased by instance position */
function addSway(material, swayUniform, strength = 1) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #else
        vec4 iw = vec4(0.0);
      #endif
      float swPh = iw.x * 0.31 + iw.z * 0.47;
      float swA = uv.y * uv.y;
      transformed.x += (sin(uTime * 1.7 + swPh) * 0.6 + sin(uTime * 2.9 + swPh * 1.6) * 0.4) * ${strength.toFixed(3)} * swA;
      transformed.z += cos(uTime * 1.1 + swPh * 0.8) * ${(strength * 0.55).toFixed(3)} * swA;`
    );
  };
}

/* merge simple part spheres/cylinders into one vertex-colored geometry (prey models) */
function mergeParts(parts) {
  const pos = [], nor = [], col = [], idx = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const s = new THREE.Vector3(), t = new THREE.Vector3(), nm = new THREE.Matrix3();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  let off = 0;
  for (const p of parts) {
    e.set(p.rx || 0, p.ry || 0, p.rz || 0);
    q.setFromEuler(e);
    m.compose(t.set(p.x || 0, p.y || 0, p.z || 0), q, s.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1));
    nm.getNormalMatrix(m);
    c.set(p.color);
    const pa = p.geo.attributes.position, na = p.geo.attributes.normal, ia = p.geo.index;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
    }
    if (ia) for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + off);
    off += pa.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

const SPH = new THREE.SphereGeometry(1, 7, 5);   /* low-poly: instanced by the hundreds for prey */
const CYL = new THREE.CylinderGeometry(1, 1, 1, 6);
const PART = (x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0, geo = SPH) => ({ geo, x, y, z, sx, sy, sz, color, rx, ry, rz });

function buildFrogGeo() {
  return mergeParts([
    PART(0, 0.16, 0, 0.42, 0.26, 0.5, 0x557f38),
    PART(0, 0.2, 0.3, 0.34, 0.18, 0.3, 0x6b9a46),
    PART(-0.16, 0.34, 0.26, 0.1, 0.1, 0.1, 0xcfd08a),
    PART(0.16, 0.34, 0.26, 0.1, 0.1, 0.1, 0xcfd08a),
    PART(-0.16, 0.36, 0.34, 0.045, 0.045, 0.045, 0x1c2312),
    PART(0.16, 0.36, 0.34, 0.045, 0.045, 0.045, 0x1c2312),
    PART(-0.24, 0.08, -0.24, 0.11, 0.06, 0.22, 0x4a7030, 0, 0, 0.5),
    PART(0.24, 0.08, -0.24, 0.11, 0.06, 0.22, 0x4a7030, 0, 0, -0.5),
    PART(-0.16, 0.04, 0.4, 0.08, 0.04, 0.11, 0x4a7030),
    PART(0.16, 0.04, 0.4, 0.08, 0.04, 0.11, 0x4a7030),
  ]);
}

function buildMouseGeo() {
  return mergeParts([
    PART(0, 0.2, -0.05, 0.32, 0.26, 0.42, 0x8d7b68),
    PART(0, 0.22, 0.4, 0.16, 0.14, 0.2, 0x96826f),
    PART(0, 0.2, 0.56, 0.045, 0.04, 0.05, 0x4a3a30),
    PART(-0.11, 0.36, 0.36, 0.09, 0.11, 0.03, 0xb39a86, 0, 0, 0.2),
    PART(0.11, 0.36, 0.36, 0.09, 0.11, 0.03, 0xb39a86, 0, 0, -0.2),
    PART(0, 0.12, -0.52, 0.02, 0.02, 0.26, 0xa58a76, 1.25, 0, 0, CYL),
  ]);
}

function buildBeetleGeo() {
  return mergeParts([
    PART(0, 0.1, 0, 0.22, 0.13, 0.3, 0x35402a),
    PART(0, 0.12, -0.02, 0.225, 0.135, 0.2, 0x2c3a22),
    PART(0, 0.1, 0.26, 0.09, 0.08, 0.09, 0x232a1c),
    PART(0, 0.14, 0.14, 0.01, 0.01, 0.16, 0x1c2312),
  ]);
}

/* ------------------------------------------------------------------ */
/* species assets (textures + materials, cached)                       */
/* ------------------------------------------------------------------ */

const speciesAssets = new Map();

function getSpeciesAssets(idx, v) {
  const key = idx * 4 + (v & 3);
  if (speciesAssets.has(key)) return speciesAssets.get(key);
  const sp = SPECIES[idx % SPECIES.length];
  const mapTex = new THREE.CanvasTexture(paintSpeciesMap(sp, idx, v & 3));
  mapTex.colorSpace = THREE.SRGBColorSpace;
  mapTex.wrapS = mapTex.wrapT = THREE.RepeatWrapping;
  const bumpTex = new THREE.CanvasTexture(scaleBumpCanvas());
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  const headTex = new THREE.CanvasTexture(paintHeadTexture(sp));
  headTex.colorSpace = THREE.SRGBColorSpace;
  const bodyMat = new THREE.MeshStandardMaterial({
    map: mapTex, bumpMap: bumpTex, bumpScale: 0.035, roughness: sp.rough, metalness: 0.02,
  });
  const headMat = new THREE.MeshStandardMaterial({
    map: headTex, bumpMap: bumpTex, bumpScale: 0.025, roughness: sp.rough, metalness: 0.02,
  });
  const hoodMat = new THREE.MeshStandardMaterial({
    map: headTex, color: 0x6e6e66, roughness: Math.min(0.9, sp.rough + 0.2),
  });
  const eyeBase = new THREE.Color(0xd8a837);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: eyeBase.lerp(new THREE.Color(sp.light), 0.45), roughness: 0.15, metalness: 0.05,
  });
  const a = { sp, bodyMat, headMat, hoodMat, eyeMat };
  speciesAssets.set(key, a);
  return a;
}

/* head rigs per species family; units are skull radii (scaled by body thickness) */
const HEADS = {
  cobra:  { skull: [0.82, 0.68, 1.2], snout: [0.5, 0.42, 0.55, 0, 0.02, 0.72], hood: true,  eye: [0.34, 0.3, 0.58], eyeS: 0.19, tip: 1.15 },
  broad:  { skull: [1.0, 0.74, 1.25], snout: [0.62, 0.5, 0.55, 0, 0, 0.8],   hood: false, eye: [0.44, 0.32, 0.62], eyeS: 0.18, tip: 1.25 },
  slim:   { skull: [0.58, 0.52, 1.3], snout: [0.38, 0.34, 0.5, 0, 0.02, 0.82], hood: false, eye: [0.26, 0.26, 0.68], eyeS: 0.21, tip: 1.2 },
  viper:  { skull: [1.12, 0.58, 1.0], snout: [0.68, 0.4, 0.5, 0, -0.02, 0.7], hood: false, eye: [0.5, 0.26, 0.42], eyeS: 0.19, tip: 1.05 },
  mamba:  { skull: [0.72, 0.58, 1.35], snout: [0.42, 0.36, 0.55, 0, 0.02, 0.85], hood: false, eye: [0.3, 0.28, 0.68], eyeS: 0.17, tip: 1.3 },
  normal: { skull: [0.88, 0.7, 1.25], snout: [0.55, 0.46, 0.55, 0, 0.02, 0.78], hood: false, eye: [0.38, 0.3, 0.62], eyeS: 0.19, tip: 1.2 },
};

const skullGeo = new THREE.SphereGeometry(1, 20, 14);
const eyeGeo = new THREE.SphereGeometry(1, 12, 10);
const pupilGeo = new THREE.BoxGeometry(0.07, 0.26, 0.04);
const nostrilGeo = new THREE.SphereGeometry(0.035, 6, 6);
const tongueStemGeo = new THREE.CylinderGeometry(0.03, 0.024, 0.6, 5);
const tongueForkGeo = new THREE.CylinderGeometry(0.02, 0.012, 0.3, 5);
const tongueMat = new THREE.MeshStandardMaterial({ color: 0x8f2a2a, roughness: 0.55 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0a08, roughness: 0.3 });

function buildHead(assets, sp) {
  const cfg = HEADS[sp.head] || HEADS.normal;
  const head = new THREE.Group();

  const skull = new THREE.Mesh(skullGeo, assets.headMat);
  skull.scale.set(cfg.skull[0], cfg.skull[1], cfg.skull[2]);
  skull.castShadow = true;
  head.add(skull);

  const snout = new THREE.Mesh(skullGeo, assets.headMat);
  snout.scale.set(cfg.snout[0], cfg.snout[1], cfg.snout[2]);
  snout.position.set(cfg.snout[3], cfg.snout[4], cfg.snout[5]);
  snout.castShadow = true;
  head.add(snout);

  let hood = null;
  if (cfg.hood) {
    hood = new THREE.Mesh(skullGeo, assets.hoodMat);
    hood.scale.set(1.34, 0.24, 1.52);
    hood.position.set(0, -0.04, 0.12);
    hood.castShadow = true;
    head.add(hood);
  }

  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, assets.eyeMat);
    e.scale.setScalar(cfg.eyeS);
    e.position.set(cfg.eye[0] * sx, cfg.eye[1], cfg.eye[2]);
    e.castShadow = true;
    const p = new THREE.Mesh(pupilGeo, pupilMat);
    p.position.set(0, 0, cfg.eyeS * 0.85);
    e.add(p);
    head.add(e);
    const n = new THREE.Mesh(nostrilGeo, pupilMat);
    n.position.set(0.16 * sx, 0.22, cfg.snout[5] + cfg.snout[2] * 0.7);
    head.add(n);
  }

  const tongue = new THREE.Group();
  tongue.position.set(0, -0.1, cfg.tip * 0.92);
  const stem = new THREE.Mesh(tongueStemGeo, tongueMat);
  stem.rotation.x = Math.PI / 2;
  stem.position.z = 0.3;
  tongue.add(stem);
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(tongueForkGeo, tongueMat);
    f.rotation.x = Math.PI / 2;
    f.rotation.z = 0.35 * sx;
    f.position.set(0.07 * sx, 0, 0.72);
    tongue.add(f);
  }
  tongue.visible = false;
  head.add(tongue);

  return { head, tongue, hood, tip: cfg.tip };
}

/* ------------------------------------------------------------------ */
/* SnakeView                                                           */
/* ------------------------------------------------------------------ */

const nameRedraws = new Set();
function registerNameRedraw(fn) {
  nameRedraws.add(fn);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { try { fn(); } catch { /* sprite gone */ } });
  }
}

class SnakeView {
  constructor(scene, name, skin) {
    const idx = skin && typeof skin.sp === 'number' ? skin.sp : speciesFor(String(name));
    const v = skin ? (skin.v | 0) & 3 : 0;
    this.assets = getSpeciesAssets(idx, v);
    this.sp = this.assets.sp;
    this.phase = v * 0.37 + 0.21;
    this.geo = makeTubeGeometry();
    this.mesh = new THREE.Mesh(this.geo, this.assets.bodyMat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    const rig = buildHead(this.assets, this.sp);
    this.head = rig.head;
    this.tongue = rig.tongue;
    this.hood = rig.hood;
    scene.add(this.head);

    this.sprite = View.makeNameSprite(name, this.sp.ui);
    scene.add(this.sprite);
    this.lastRings = -1;
    this.norFlip = false;
  }

  update(pts, thickness, angle, time, showName, fade) {
    const sp = this.sp;
    const rad = thickness * sp.width;
    const posA = this.geo.attributes.position.array;
    const norA = this.geo.attributes.normal.array;
    const n = Math.min(pts.length, MAX_RINGS);
    const cols = RADIAL + 1;
    /* normals barely change frame to frame: refresh them every other frame */
    const doNor = this.norFlip = !this.norFlip;

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const pa = pts[Math.max(0, i - 1)];
      const pb = pts[Math.min(n - 1, i + 1)];
      let tx = pb.x - pa.x, tz = pb.z - pa.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      /* slither wave travelling down the body */
      const wig = Math.sin(time * 4.2 - i * 0.34) * 0.11 * rad;
      const cx = p.x + nx * wig;
      const cz = p.z + nz * wig;
      const cy = rad * 0.78 + 0.05 + Math.sin(time * 3 - i * 0.5) * 0.015;
      const t = n <= 1 ? 0 : i / (n - 1);
      let r = rad;
      if (i === 0) r *= 0.82; else if (i === 1) r *= 0.93; else if (i === 2) r *= 0.98;
      const neck = 0.12;
      if (t < neck) r *= 1 - 0.25 * (1 - t / neck);         /* slight neck taper behind head */
      const tailStart = 0.72;
      if (t > tailStart) {
        const k = (t - tailStart) / (1 - tailStart);
        r *= 1 - 0.92 * k * k;
      }
      for (let s = 0; s <= RADIAL; s++) {
        const phi = (s / RADIAL) * Math.PI * 2;
        const cp = Math.cos(phi), sph = Math.sin(phi);
        const o = (i * cols + s) * 3;
        posA[o] = cx + nx * cp * r;
        posA[o + 1] = cy + sph * r;
        posA[o + 2] = cz + nz * cp * r;
        if (doNor) {
          norA[o] = nx * cp;
          norA[o + 1] = sph;
          norA[o + 2] = nz * cp;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    if (doNor) this.geo.attributes.normal.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, n - 1) * RADIAL * 6);

    const hp = pts[0];
    const headLift = rad * 0.85 + 0.1;
    this.head.position.set(hp.x + Math.cos(angle) * rad * 0.5, headLift, hp.z + Math.sin(angle) * rad * 0.5);
    this.head.scale.setScalar(rad * 1.45);
    this.head.rotation.y = Math.atan2(Math.cos(angle), Math.sin(angle));
    this.head.rotation.z = Math.sin(time * 4.2 + 0.3) * 0.05;   /* subtle head sway */

    /* tongue flick */
    const tp = (time * 0.45 + this.phase) % 1;
    if (tp < 0.16) {
      this.tongue.visible = true;
      this.tongue.scale.set(1, 1, Math.max(0.001, Math.sin((tp / 0.16) * Math.PI)));
    } else this.tongue.visible = false;
    if (this.hood) {
      const br = 1 + Math.sin(time * 2 + this.phase) * 0.04;
      this.hood.scale.set(1.34 * br, 0.24, 1.52);
    }

    this.sprite.visible = showName !== false && fade > 0.02;
    this.sprite.material.opacity = 0.95 * fade;
    this.sprite.position.set(hp.x, headLift + rad * 2.1 + 0.8, hp.z);
    const hs = 0.7 + rad * 0.65;
    this.sprite.scale.set(hs * 3.6, hs, 1);
  }

  dispose(scene) {
    scene.remove(this.mesh, this.head, this.sprite);
    this.geo.dispose();
    if (this.sprite.userData.redraw) nameRedraws.delete(this.sprite.userData.redraw);
    this.sprite.material.map.dispose();
    this.sprite.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export class View {
  constructor(canvas) {
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    this.isMobileLike = coarse || Math.min(window.innerWidth, window.innerHeight) < 500;
    this.baseDpr = Math.min(window.devicePixelRatio || 1, this.isMobileLike ? 1.0 : 1.5);
    this.resScale = this.isMobileLike ? 0.9 : 1;
    this.frameAvg = 16;
    this.lastAdjust = 0;
    this.foodFlip = false;
    this.zoom = 1;
    this.menuMode = true;
    this.focus = new THREE.Vector3();

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: !this.isMobileLike, powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x33402a);
    this.scene.fog = new THREE.Fog(0x33402a, 28, 140);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 420);
    this.camPos = new THREE.Vector3(60, 28, 40);
    this.boostAmt = 0;

    this.sway = { value: 0 };
    this.initLights();
    this.initGround();
    this.initForest();
    this.initFoliage();
    this.initPollen();
    this.initPrey();
    this.initParticles();

    this.snakeViews = new Map();
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.baseDpr * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  initLights() {
    this.scene.add(new THREE.AmbientLight(0x26301c, 0.45));
    this.scene.add(new THREE.HemisphereLight(0xcfe0b0, 0x2f2a1c, 0.95));
    const sun = new THREE.DirectionalLight(0xffe9bd, 2.1);
    sun.position.set(55, 95, 30);
    sun.castShadow = true;
    const sh = this.isMobileLike ? 1024 : 2048;
    sun.shadow.mapSize.set(sh, sh);
    sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
    sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 220;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  initGround() {
    const tex = new THREE.CanvasTexture(paintGroundCanvas());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(CFG.R + 34, 72),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(1600, 1600),
      new THREE.MeshLambertMaterial({ color: 0x18220f })
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.08;
    this.scene.add(under);
  }

  initForest() {
    const rnd = mulberry32(31337);
    const mobile = this.isMobileLike;
    const treeCount = mobile ? 30 : 46;
    const megaCount = 14;
    const trunks = [];
    const canopies = [];
    const canopyCols = [0x2f4a26, 0x3a552c, 0x263d1e, 0x466034];

    const addTree = (angle, r, h, trunkR, canopyR, blobs) => {
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      trunks.push({ x, z, h, r: trunkR, tilt: (rnd() - 0.5) * 0.08 });
      for (let b = 0; b < blobs; b++) {
        canopies.push({
          x: x + (rnd() - 0.5) * canopyR * 2.4, y: h + rnd() * canopyR * 0.9,
          z: z + (rnd() - 0.5) * canopyR * 2.4, r: canopyR * (0.55 + rnd() * 0.6),
          col: canopyCols[(rnd() * canopyCols.length) | 0],
        });
      }
    };

    for (let i = 0; i < treeCount; i++) {
      const angle = ((i + rnd() * 0.6) / treeCount) * Math.PI * 2;
      addTree(angle, CFG.R + 7 + rnd() * 42, 9 + rnd() * 9, 0.5 + rnd() * 0.7, 2.6 + rnd() * 3, 2 + ((rnd() * 2) | 0));
    }
    for (let i = 0; i < megaCount; i++) {
      const angle = ((i + rnd() * 0.8) / megaCount) * Math.PI * 2;
      addTree(angle, CFG.R + 75 + rnd() * 160, 22 + rnd() * 18, 1.6 + rnd() * 1.8, 8 + rnd() * 9, 3 + ((rnd() * 2) | 0));
    }

    const trunkGeo = new THREE.CylinderGeometry(0.62, 1, 1, 7);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMesh = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 }),
      trunks.length
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    trunks.forEach((t, i) => {
      e.set(t.tilt, rnd() * Math.PI * 2, t.tilt * 0.7);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.r, t.h, t.r));
      trunkMesh.setMatrixAt(i, m);
    });
    trunkMesh.castShadow = true;
    this.scene.add(trunkMesh);

    const canopyMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      canopies.length
    );
    const c = new THREE.Color();
    canopies.forEach((k, i) => {
      e.set(rnd() * 3, rnd() * 3, rnd() * 3);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(k.x, k.y, k.z), q, new THREE.Vector3(k.r, k.r * 0.72, k.r));
      canopyMesh.setMatrixAt(i, m);
      canopyMesh.setColorAt(i, c.setHex(k.col));
    });
    this.scene.add(canopyMesh);

    /* fallen logs */
    const logCount = mobile ? 6 : 9;
    const logGeo = new THREE.CylinderGeometry(0.5, 0.55, 1, 8);
    const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95 });
    for (let i = 0; i < logCount; i++) {
      const log = new THREE.Mesh(logGeo, logMat);
      const a = rnd() * Math.PI * 2;
      const r = 20 + Math.sqrt(rnd()) * (CFG.R - 40);
      const len = 4 + rnd() * 3.5;
      log.scale.set(1, len, 1);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rnd() * Math.PI;
      log.position.set(Math.cos(a) * r, 0.42, Math.sin(a) * r);
      log.castShadow = true;
      log.receiveShadow = true;
      this.scene.add(log);
    }
  }

  initFoliage() {
    const rnd = mulberry32(4242);
    const mobile = this.isMobileLike;
    const grassTex = new THREE.CanvasTexture(paintGrassTexture());
    grassTex.colorSpace = THREE.SRGBColorSpace;
    const leafTex = new THREE.CanvasTexture(paintLeafTexture());
    leafTex.colorSpace = THREE.SRGBColorSpace;
    const plantTex = new THREE.CanvasTexture(paintPlantTexture());
    plantTex.colorSpace = THREE.SRGBColorSpace;

    /* grass */
    const nGrass = mobile ? 1200 : 3000;
    const grassGeo = crossQuadsGeometry(1.3, 1);
    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex, alphaTest: 0.5 });
    addSway(grassMat, this.sway, 0.22);
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, nGrass);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < nGrass; i++) {
      const rim = rnd() < 0.55;
      const a = rnd() * Math.PI * 2;
      const r = rim ? CFG.R * (0.72 + 0.27 * Math.sqrt(rnd())) : Math.sqrt(rnd()) * CFG.R * 0.96;
      const h = rim ? 0.85 + rnd() * 1.2 : 0.55 + rnd() * 1.0;
      e.set(0, rnd() * Math.PI * 2, 0);
      q.setFromEuler(e);
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      s.set(h * (0.8 + rnd() * 0.5), h, h * (0.8 + rnd() * 0.5));
      m.compose(p, q, s);
      grass.setMatrixAt(i, m);
      const g2 = 0.82 + rnd() * 0.38;
      grass.setColorAt(i, new THREE.Color(g2 * 0.95, g2, g2 * 0.85));
    }
    grass.instanceColor.needsUpdate = true;
    this.scene.add(grass);

    /* tall ferns / plants */
    const nFern = mobile ? 16 : 30;
    const fernMat = new THREE.MeshLambertMaterial({
      map: plantTex, alphaTest: 0.5, color: 0xb8d098,
    });
    addSway(fernMat, this.sway, 0.12);
    const ferns = new THREE.InstancedMesh(crossQuadsGeometry(2.0, 2.4), fernMat, nFern);
    for (let i = 0; i < nFern; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * CFG.R * 0.94;
      const h = 0.8 + rnd() * 0.7;
      e.set(0, rnd() * Math.PI * 2, 0);
      q.setFromEuler(e);
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      s.set(h, h, h);
      m.compose(p, q, s);
      ferns.setMatrixAt(i, m);
    }
    this.scene.add(ferns);

    /* bushes */
    const nBush = mobile ? 50 : 90;
    const bushMat = new THREE.MeshLambertMaterial({
      map: plantTex, alphaTest: 0.5, color: 0xa8c490,
    });
    addSway(bushMat, this.sway, 0.08);
    const bushes = new THREE.InstancedMesh(crossQuadsGeometry(2.6, 1.8), bushMat, nBush);
    for (let i = 0; i < nBush; i++) {
      const rim = rnd() < 0.6;
      const a = rnd() * Math.PI * 2;
      const r = rim ? CFG.R * (0.78 + 0.21 * Math.sqrt(rnd())) : Math.sqrt(rnd()) * CFG.R * 0.9;
      const h = 0.7 + rnd() * 0.9;
      e.set(0, rnd() * Math.PI * 2, 0);
      q.setFromEuler(e);
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      s.set(h, h, h);
      m.compose(p, q, s);
      bushes.setMatrixAt(i, m);
    }
    this.scene.add(bushes);

    /* fallen leaves flat on the ground */
    const nLitter = mobile ? 160 : 300;
    const litterMat = new THREE.MeshLambertMaterial({
      map: leafTex, alphaTest: 0.3, side: THREE.DoubleSide, color: 0x9a8a62,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const litter = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.9, 1.9), litterMat, nLitter);
    const qSpin = new THREE.Quaternion(), qFlat = new THREE.Quaternion();
    const AXY = new THREE.Vector3(0, 1, 0), AXX = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < nLitter; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * CFG.R * 0.98;
      qSpin.setFromAxisAngle(AXY, rnd() * Math.PI * 2);
      qFlat.setFromAxisAngle(AXX, -Math.PI / 2);
      q.copy(qFlat).multiply(qSpin);
      p.set(Math.cos(a) * r, 0.02 + rnd() * 0.04, Math.sin(a) * r);
      const h = 0.5 + rnd() * 0.8;
      s.set(h, h, h);
      m.compose(p, q, s);
      litter.setMatrixAt(i, m);
    }
    this.scene.add(litter);

    /* rocks */
    const nRock = mobile ? 36 : 60;
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.9 }),
      nRock
    );
    for (let i = 0; i < nRock; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * CFG.R * 0.97;
      const h = 0.5 + rnd() * 1.6;
      e.set(rnd() * 3, rnd() * Math.PI * 2, rnd() * 3);
      q.setFromEuler(e);
      p.set(Math.cos(a) * r, h * 0.2, Math.sin(a) * r);
      s.set(h, h * 0.55, h * 0.8);
      m.compose(p, q, s);
      rocks.setMatrixAt(i, m);
    }
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.scene.add(rocks);
  }

  initPollen() {
    const N = this.isMobileLike ? 140 : 240;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt(Math.random()) * 210;
      const th = Math.random() * Math.PI * 2;
      pos[i * 3] = Math.cos(th) * r;
      pos[i * 3 + 1] = 0.5 + Math.random() * 13;
      pos[i * 3 + 2] = Math.sin(th) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dotCv = makeCanvas(32, 32);
    const dctx = dotCv.getContext('2d');
    const grad = dctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255, 244, 214, 1)');
    grad.addColorStop(0.5, 'rgba(255, 244, 214, 0.5)');
    grad.addColorStop(1, 'rgba(255, 244, 214, 0)');
    dctx.fillStyle = grad;
    dctx.fillRect(0, 0, 32, 32);
    const dotTex = new THREE.CanvasTexture(dotCv);
    dotTex.colorSpace = THREE.SRGBColorSpace;
    this.pollen = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xfff2c8, size: 0.5, map: dotTex, transparent: true, opacity: 0.55,
      depthWrite: false,
    }));
    this.pollen.frustumCulled = false;
    this.scene.add(this.pollen);
  }

  initPrey() {
    const cap = 560;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
    this.preyMeshes = [
      new THREE.InstancedMesh(buildBeetleGeo(), mat, cap),
      new THREE.InstancedMesh(buildFrogGeo(), mat, cap),
      new THREE.InstancedMesh(buildMouseGeo(), mat, cap),
    ];
    for (const pm of this.preyMeshes) {
      pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      pm.frustumCulled = false;
      pm.count = 0;
      this.scene.add(pm);
    }
    this._fm = new THREE.Matrix4();
    this._fq = new THREE.Quaternion();
    this._fe = new THREE.Euler();
    this._fs = new THREE.Vector3();
    this._fp = new THREE.Vector3();
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
    const counts = [0, 0, 0];
    const cap = 220;   /* only the nearest prey is drawn; fog hides the rest */
    const n = Math.min(list.length, cap * 3);
    for (let i = 0; i < n; i++) {
      const f = list[i];
      const type = Math.min(2, (f.v | 0) - 1);
      const mesh = this.preyMeshes[type];
      const ci = counts[type]++;
      if (ci >= cap) continue;
      const s = 1.0 + f.v * 0.15;
      let y = 0.12, rx = 0, ry = f.ph * 7;
      if (type === 1) {          /* frog hops */
        const hop = Math.max(0, Math.sin(time * 2.4 + f.ph));
        y = 0.14 + hop * hop * 0.3;
        rx = -hop * 0.35;
      } else if (type === 0) {   /* beetle scuttles */
        y = 0.1;
        ry += Math.sin(time * 1.5 + f.ph) * 0.25;
      } else {                   /* mouse twitches */
        y = 0.16;
        ry += Math.sin(time * 0.8 + f.ph) * 0.08;
      }
      this._fe.set(rx, ry, 0);
      this._fq.setFromEuler(this._fe);
      this._fp.set(f.x, y, f.z);
      this._fs.setScalar(s);
      this._fm.compose(this._fp, this._fq, this._fs);
      mesh.setMatrixAt(ci, this._fm);
      const j = (f.ph % 0.14) - 0.07;
      mesh.setColorAt(ci, this._fc.setRGB(0.94 + j * 0.5, 0.93, 0.9 - j * 0.5));
    }
    for (let t = 0; t < 3; t++) {
      this.preyMeshes[t].count = counts[t];
      this.preyMeshes[t].instanceMatrix.needsUpdate = true;
      if (this.preyMeshes[t].instanceColor) this.preyMeshes[t].instanceColor.needsUpdate = true;
    }
  }

  initParticles() {
    const PMAX = (this.PMAX = this.isMobileLike ? 300 : 900);
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
      transparent: true, depthWrite: false,
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
          float m = smoothstep(0.5, 0.08, length(c));
          float a = m * 0.85;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor, a);
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
      this.pVel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.8 + 1.0;
      this.pVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      this.pLife[i] = this.pMaxLife[i] = 0.5 + Math.random() * 0.6;
      this.pSize[i] = 0.5 + Math.random() * 1.1;
      const v = 0.75 + Math.random() * 0.5;
      this.pBase[i * 3] = c.r * v; this.pBase[i * 3 + 1] = c.g * v; this.pBase[i * 3 + 2] = c.b * v;
    }
  }

  updateParticles(dt) {
    for (let i = 0; i < this.PMAX; i++) {
      if (this.pLife[i] <= 0) {
        this.pCol[i * 3] = this.pCol[i * 3 + 1] = this.pCol[i * 3 + 2] = 0;
        continue;
      }
      this.pLife[i] -= dt;
      const k = Math.max(this.pLife[i], 0) / this.pMaxLife[i];
      const kk = k * k;
      this.pCol[i * 3] = this.pBase[i * 3] * kk;
      this.pCol[i * 3 + 1] = this.pBase[i * 3 + 1] * kk;
      this.pCol[i * 3 + 2] = this.pBase[i * 3 + 2] * kk;
      if (this.pLife[i] > 0) {
        this.pVel[i * 3 + 1] -= 3.0 * dt;
        this.pVel[i * 3] *= 1 - 1.2 * dt;
        this.pVel[i * 3 + 2] *= 1 - 1.2 * dt;
        this.pPos[i * 3] += this.pVel[i * 3] * dt;
        this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
        this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
        if (this.pPos[i * 3 + 1] < 0.05) this.pPos[i * 3 + 1] = 0.05;
      }
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.pcolor.needsUpdate = true;
    this.pGeo.attributes.psize.needsUpdate = true;
  }

  static makeNameSprite(name, uiColor) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 10;
    const col = '#' + uiColor.toString(16).padStart(6, '0');
    const draw = () => {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 512, 128);
      ctx.font = '700 52px "Averia Serif Libre", Georgia, serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 9;
      ctx.strokeStyle = 'rgba(12, 16, 8, 0.85)';
      ctx.strokeText(name, 256, 66);
      ctx.fillStyle = col;
      ctx.fillText(name, 256, 66);
      tex.needsUpdate = true;
    };
    draw();
    registerNameRedraw(draw);
    sp.userData.redraw = draw;
    return sp;
  }

  /* list: [{id, name, pts, thickness, angle, showName, skin:{sp,v}}] */
  updateSnakes(list, time) {
    const seen = new Set();
    for (const item of list) {
      seen.add(item.id);
      let sv = this.snakeViews.get(item.id);
      const skin = item.skin || { sp: speciesFor(String(item.id)), v: 0 };
      if (!sv) {
        sv = new SnakeView(this.scene, item.name, skin);
        this.snakeViews.set(item.id, sv);
      }
      const cd = Math.hypot(item.pts[0].x - this.camera.position.x, item.pts[0].z - this.camera.position.z);
      const fade = Math.max(0, Math.min(1, 1.25 - cd / 80));
      const vis = cd <= 105;
      sv.mesh.visible = vis;
      sv.head.visible = vis;
      if (vis) sv.update(item.pts, item.thickness, item.angle, time, item.showName, fade);
    }
    for (const [id, sv] of this.snakeViews) {
      if (!seen.has(id)) {
        sv.dispose(this.scene);
        this.snakeViews.delete(id);
      }
    }
  }

  follow(head, thickness, boosting, dt) {
    const fit = Math.min(2.4, Math.max(1, 1.35 / this.camera.aspect));
    const dist = (13 + thickness * 14) * fit * (this.zoom || 1);
    const desiredX = head.x + CAM_DIR.x * dist;
    const desiredY = CAM_DIR.y * dist;
    const desiredZ = head.z + CAM_DIR.z * dist;
    const k = 1 - Math.exp(-4.5 * dt);
    this.camPos.x += (desiredX - this.camPos.x) * k;
    this.camPos.y += (desiredY - this.camPos.y) * k;
    this.camPos.z += (desiredZ - this.camPos.z) * k;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(head.x, 0.4, head.z);
    this.focus.set(head.x, 0, head.z);
    this.boostAmt += ((boosting ? 1 : 0) - this.boostAmt) * (1 - Math.exp(-4 * dt));
    /* soil kicked up while boosting */
    if (boosting) {
      this.dustAcc = (this.dustAcc || 0) + dt;
      if (this.dustAcc > 0.14) {
        this.dustAcc = 0;
        const back = 2.5 + thickness * 4;
        const bx = head.x - Math.cos(head.a || 0) * back;
        const bz = head.z - Math.sin(head.a || 0) * back;
        this.burst(bx, 0.15, bz, 0x7a6845, 2, 1.1);
      }
    }
  }

  render(dt, time) {
    this.sway.value = time;
    this.pollen.rotation.y = time * 0.006;
    this.frameCount = (this.frameCount || 0) + 1;
    if (this.frameCount % 4 === 0) this.updateFood(time);   /* idle prey: 15Hz is plenty */
    this.updateParticles(dt);

    /* sun follows the action so shadows stay crisp near the player */
    const fx = this.focus.x, fz = this.focus.z;
    this.sun.position.set(fx + 55, 95, fz + 30);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.target.updateMatrixWorld();

    if (this.menuMode) {
      const a = time * 0.05;
      const k = 1 - Math.exp(-1.2 * dt);
      this.camPos.x += (Math.cos(a) * 74 - this.camPos.x) * k;
      this.camPos.y += (30 - this.camPos.y) * k;
      this.camPos.z += (Math.sin(a) * 74 - this.camPos.z) * k;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(0, 1, 0);
    }

    this.renderer.render(this.scene, this.camera);
    this.frameAvg = this.frameAvg * 0.95 + Math.min(dt, 0.1) * 1000 * 0.05;
    const ms = performance.now();
    if (!navigator.webdriver && ms - this.lastAdjust > 900 && this.frameAvg > 1) {
      this.lastAdjust = ms;
      const fps = 1000 / this.frameAvg;
      if (fps < 45 && this.resScale > 0.5) {
        this.resScale = Math.max(0.5, this.resScale - 0.25);
        this.onResize();
      } else if (fps > 56 && this.resScale < 1) {
        this.resScale = Math.min(1, this.resScale + 0.1);
        this.onResize();
      }
      if (fps < 40 && this.sun.shadow.mapSize.width > 1024) {
        this.sun.shadow.mapSize.set(1024, 1024);
        if (this.sun.shadow.map) {
          this.sun.shadow.map.dispose();
          this.sun.shadow.map = null;
        }
      }
    }
  }
}
