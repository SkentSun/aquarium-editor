// Aquatic plants built from photographed leaves (leaf atlas cut from Codex specimen sheets) plus a small procedural
// atlas (moss fronds, ribbons, grass blades, stems). Species without their own photo borrow a real leaf of similar
// shape, recoloured by luminance. One material for everything: per-vertex aLeaf = (atlas select, recolour, sway, phase).
//   clump    : stem plants / rosettes / ribbons, one merged mesh per clump planted in the soil
//   epiphyte : anubias / fern / moss parented to the stone or driftwood they are tied to
//   carpet   : instanced tufts scattered from a painted density grid (1 cm cells)
import * as THREE from 'three';
import { patchUnder, rng, U, makeNoise } from './shaders.js';
import { loadImageTex, loadJSON } from './textures.js';

// ---------- procedural atlas (fronds, ribbons, blades, solid) ----------
function proceduralAtlas() {
  const N = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const R = rng(5);
  const regions = { moss: [], ribbon: [], blade: [], solid: null };
  // solid white square for stems
  g.fillStyle = '#fff'; g.fillRect(4, 4, 24, 24); regions.solid = { u0: 6 / N, v0: 6 / N, u1: 26 / N, v1: 26 / N, bu: 16 / N, bv: 26 / N, aspect: 1 };
  // moss fronds: feathery branching sprigs (8 of them), 120 x 160 px cells at x 40..
  for (let k = 0; k < 8; k++) {
    const x0 = 40 + (k % 4) * 130, y0 = 4 + Math.floor(k / 4) * 170, w = 120, h = 160;
    const frond = (x, y, ang, len, depth, width) => {
      const ex = x + Math.sin(ang) * len, ey = y - Math.cos(ang) * len;
      g.strokeStyle = `rgba(${150 + R() * 40},${200 + R() * 40},${90 + R() * 30},1)`;
      g.lineWidth = width; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo((x + ex) / 2 + (R() - 0.5) * 6, (y + ey) / 2, ex, ey); g.stroke();
      // tiny leaflets along it
      const nl = Math.floor(len / 3);
      for (let i = 1; i < nl; i++) {
        const t = i / nl, px = x + (ex - x) * t, py = y + (ey - y) * t;
        for (const s of [-1, 1]) {
          const la = ang + s * (0.7 + R() * 0.4), ll = 3.5 + R() * 3 * (1 - t * 0.5);
          g.fillStyle = `rgba(${130 + R() * 60},${190 + R() * 50},${70 + R() * 40},${0.85 + R() * 0.15})`;
          g.beginPath(); g.ellipse(px + Math.sin(la) * ll * 0.5, py - Math.cos(la) * ll * 0.5, 1.1, ll * 0.55, la, 0, Math.PI * 2); g.fill();
        }
      }
      if (depth > 0) {
        const nb = 2 + Math.floor(R() * 3);
        for (let i = 0; i < nb; i++) {
          const t = 0.25 + 0.65 * (i + R() * 0.6) / nb;
          frond(x + (ex - x) * t, y + (ey - y) * t, ang + (i % 2 ? 1 : -1) * (0.5 + R() * 0.5), len * (0.45 + R() * 0.25), depth - 1, width * 0.7);
        }
      }
    };
    frond(x0 + w / 2, y0 + h - 4, (R() - 0.5) * 0.3, h * 0.8, 2, 2.2);
    regions.moss.push({ u0: x0 / N, v0: y0 / N, u1: (x0 + w) / N, v1: (y0 + h) / N, bu: (x0 + w / 2) / N, bv: (y0 + h - 4) / N, aspect: w / h });
  }
  // ribbons (vallisneria): 6 strips 22 x 700 px
  for (let k = 0; k < 6; k++) {
    const x0 = 580 + k * 34, y0 = 4, w = 24, h = 700;
    const grd = g.createLinearGradient(x0, 0, x0 + w, 0);
    grd.addColorStop(0, 'rgba(150,200,110,0.9)'); grd.addColorStop(0.5, 'rgba(185,225,130,1)'); grd.addColorStop(1, 'rgba(150,200,110,0.9)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(x0 + 2, y0 + h); g.lineTo(x0 + 2, y0 + 30); g.quadraticCurveTo(x0 + w / 2, y0 - 6, x0 + w - 2, y0 + 30); g.lineTo(x0 + w - 2, y0 + h); g.fill();
    g.strokeStyle = 'rgba(120,170,90,0.55)'; g.lineWidth = 1;
    for (const f of [0.3, 0.5, 0.7]) { g.beginPath(); g.moveTo(x0 + w * f, y0 + h); g.lineTo(x0 + w * f, y0 + 26); g.stroke(); }
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(120,110,60,${R() * 0.25})`; g.beginPath(); g.arc(x0 + 4 + R() * (w - 8), y0 + 40 + R() * (h - 60), 1 + R() * 2, 0, 7); g.fill(); }
    regions.ribbon.push({ u0: x0 / N, v0: y0 / N, u1: (x0 + w) / N, v1: (y0 + h) / N, bu: (x0 + w / 2) / N, bv: (y0 + h) / N, aspect: w / h });
  }
  // grass blades (hairgrass): 10 blades 10 x 300 px
  for (let k = 0; k < 10; k++) {
    const x0 = 40 + k * 16, y0 = 360, w = 10, h = 300;
    const grd = g.createLinearGradient(0, y0 + h, 0, y0);
    grd.addColorStop(0, 'rgba(120,170,70,1)'); grd.addColorStop(1, 'rgba(175,220,110,1)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(x0 + 1, y0 + h); g.quadraticCurveTo(x0 + 2, y0 + h * 0.3, x0 + w / 2 + (R() - 0.5) * 3, y0 + 2); g.quadraticCurveTo(x0 + w - 2, y0 + h * 0.3, x0 + w - 1, y0 + h); g.fill();
    regions.blade.push({ u0: x0 / N, v0: y0 / N, u1: (x0 + w) / N, v1: (y0 + h) / N, bu: (x0 + w / 2) / N, bv: (y0 + h) / N, aspect: w / h });
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { tex: t, regions };
}

// ---------- the shared plant material ----------
const PLANT_V = /* glsl */`
uniform vec3 uTankMin, uTankMax;
attribute vec4 aLeaf;
varying vec4 vLeaf;
varying vec2 vLUv;
`;
const SWAY = /* glsl */`
vLeaf = aLeaf; vLUv = uv;
{
  // the filter current pushes everything one way, with gusts; flexible tips move most
  float ph = aLeaf.w;
  vec3 wp0 = transformed;
  #ifdef USE_INSTANCING
  wp0 = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  float s = sin(uTime * 1.25 + ph + wp0.x * 9.0) * 0.6 + sin(uTime * 2.3 + ph * 1.7 + wp0.z * 7.0) * 0.3 + 0.35;
  float k = aLeaf.z * aLeaf.z * uFlow;
  transformed.x += s * k * 0.05;
  transformed.z += sin(uTime * 0.9 + ph * 2.3) * k * 0.02;
  transformed.y -= abs(s) * k * 0.012;
  // the sway must never carry a leaf through the glass
  mat4 M = modelMatrix;
  #ifdef USE_BATCHING
  M = modelMatrix * batchingMatrix;
  #endif
  #ifdef USE_INSTANCING
  M = modelMatrix * instanceMatrix;
  #endif
  vec3 w = (M * vec4(transformed, 1.0)).xyz;
  vec3 wc = vec3(clamp(w.x, uTankMin.x + 0.003, uTankMax.x - 0.003), w.y, clamp(w.z, uTankMin.z + 0.003, uTankMax.z - 0.003));
  transformed += inverse(mat3(M)) * (wc - w);
}`;
export function plantMaterial(texA, alphaA, texB, hiCol = null) {
  const uni = { tLA: { value: texA }, tLAA: { value: alphaA }, tLB: { value: texB }, uHiCol: { value: new THREE.Vector3(...(hiCol || [0, 0, 0])) } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true });
  patchUnder(m, {
    key: hiCol ? 'planthi' : 'plant', uniforms: uni,
    vhead: PLANT_V,
    vertex: SWAY,
    fhead: 'uniform sampler2D tLA, tLAA, tLB; uniform vec3 uHiCol; varying vec4 vLeaf; varying vec2 vLUv;',
    map: `
      vec4 lc;
      if (vLeaf.x > 0.5) lc = texture2D(tLB, vLUv);
      else lc = vec4(texture2D(tLA, vLUv).rgb, texture2D(tLAA, vLUv).r);
      float llum = dot(lc.rgb, vec3(0.3, 0.59, 0.11));
      vec3 lcol = mix(lc.rgb, vec3(llum) * 2.1, vLeaf.y);
      lcol = mix(vec3(dot(lcol, vec3(0.3, 0.59, 0.11))), lcol, 0.85);
      diffuseColor.rgb *= lcol;
      // alpha-to-coverage sharpening: crisp cut-out edges at every distance, no dithered stipple
      diffuseColor.a = clamp((lc.a - 0.45) / max(fwidth(lc.a), 1e-4) + 0.5, 0.0, 1.0);`,
    extra: (sh) => {
      // leaves receive shadow at grazing angles: extra bias for the plant material only (no self-shadow acne)
      sh.fragmentShader = sh.fragmentShader.replaceAll('directionalLightShadow.shadowBias', '(directionalLightShadow.shadowBias - 0.003)');
      // light through the leaf only where the lamp actually reaches it (shadow-map test, as in the canal scene)
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          float lit = 1.0;
          #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          {
            vec3 sc = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
            if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0) {
              // soft 9-tap test (the hard single tap drew stair-stepped edges across the leaves)
              vec2 tx = 2.5 / directionalLightShadows[ 0 ].shadowMapSize;
              lit = 0.0;
              for (int sy = -1; sy <= 1; sy++) for (int sx = -1; sx <= 1; sx++)
                lit += step(sc.z - 0.006, unpackRGBAToDepth(texture2D(directionalShadowMap[ 0 ], sc.xy + vec2(float(sx), float(sy)) * tx)));
              lit /= 9.0;
            }
          }
          #endif
          float tr = max(dot(-normal, directionalLights[0].direction), 0.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * aqCau * (tr * 0.24 * lit + 0.012) * vec3(0.95, 1.05, 0.72);
        }
        #endif` + (hiCol ? '\ntotalEmissiveRadiance += uHiCol;' : ''));
    },
  });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.uniforms.uTime = U.uTime;
    sh.uniforms.uFlow = U.uFlow;
    sh.uniforms.uTankMin = U.uTankMin; sh.uniforms.uTankMax = U.uTankMax;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uFlow;\n' + PLANT_V)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tLAA, tLB; varying vec4 vLeaf; varying vec2 vLUv;')
      .replace('#include <alphatest_fragment>', `{ float a = vLeaf.x > 0.5 ? texture2D(tLB, vLUv).a : texture2D(tLAA, vLUv).r; if (a < 0.45) discard; }`);
  };
  depth.customProgramCacheKey = () => 'plantdepth';
  m.userData.depth = depth;
  m.userData.uni = uni;
  return m;
}

// ---------- geometry builder ----------
class Builder {
  constructor(maxY = 1, box = null) { this.p = []; this.n = []; this.uv = []; this.c = []; this.l = []; this.i = []; this.v = 0; this.maxY = maxY; this.box = box; }
  // keep a growing point inside the tank (local coordinates); returns true if it was pushed back
  clampIn(p, d) {
    const b = this.box; if (!b) return false;
    let hit = false;
    if (p.x < b[0]) { p.x = b[0]; d.x = Math.abs(d.x) * 0.3; hit = true; }
    if (p.x > b[1]) { p.x = b[1]; d.x = -Math.abs(d.x) * 0.3; hit = true; }
    if (p.z < b[2]) { p.z = b[2]; d.z = Math.abs(d.z) * 0.3; hit = true; }
    if (p.z > b[3]) { p.z = b[3]; d.z = -Math.abs(d.z) * 0.3; hit = true; }
    if (hit) d.normalize();
    return hit;
  }
  /** A leaf card from base B along unit dir D, blade plane spanned by D and S (unit), length L.
   *  reg: atlas rect (image coords, v down) with base anchor; curl: bend toward N (rad over the length) */
  leaf(B, D, S, L, reg, col, sel, recolor, sway0, sway1, phase, curl = 0, widthK = 1, segs = 3) {
    const N = new THREE.Vector3().crossVectors(S, D).normalize();
    if (recolor && reg.col) {
      const lum = 0.3 * reg.col[0] + 0.59 * reg.col[1] + 0.11 * reg.col[2];
      col = col.clone().multiplyScalar(THREE.MathUtils.clamp(0.42 / Math.max(lum * 2.1, 0.05), 0.6, 3.5));
    }
    const W = L * reg.aspect * widthK;
    const bu = (reg.bu - reg.u0) / (reg.u1 - reg.u0);           // base anchor across (0..1)
    const v0 = this.v;
    const d = D.clone(), p = B.clone(), q = new THREE.Vector3();
    const step = L / segs;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const vImg = reg.bv + (reg.v0 - reg.bv) * t;             // base -> tip in the image
      for (let j = 0; j <= 1; j++) {
        q.copy(p).addScaledVector(S, (j - bu) * W);
        this.p.push(q.x, q.y, q.z);
        // normal tilts a little across the blade so cards don't look flat
        const nn = N.clone().addScaledVector(S, (j - 0.5) * 0.5).normalize();
        this.n.push(nn.x, nn.y, nn.z);
        this.uv.push(reg.u0 + (reg.u1 - reg.u0) * j, 1 - vImg);
        this.c.push(col.r, col.g, col.b);
        this.l.push(sel, recolor, sway0 + (sway1 - sway0) * t, phase);
      }
      if (s < segs) {
        p.addScaledVector(d, step);
        d.applyAxisAngle(S, curl / segs).normalize();
        if (p.y > this.maxY) { p.y = this.maxY; d.y = Math.min(d.y, 0) * 0.2; d.normalize(); }
        this.clampIn(p, d);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a = v0 + s * 2;
      this.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.v += (segs + 1) * 2;
  }
  /** a thin stem: two crossed strips along a polyline */
  stem(pts, w, reg, col, sway, phase) {
    for (const rot of [0, Math.PI / 2]) {
      const v0 = this.v;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[Math.min(k + 1, pts.length - 1)], pa = pts[Math.max(k - 1, 0)];
        const dir = new THREE.Vector3().subVectors(b, pa).normalize();
        const side = new THREE.Vector3(Math.cos(rot), 0, Math.sin(rot)).cross(dir).normalize();
        const t = k / (pts.length - 1);
        for (let j = 0; j <= 1; j++) {
          const q = a.clone().addScaledVector(side, (j - 0.5) * w * (1 - t * 0.5));
          this.p.push(q.x, q.y, q.z);
          const nn = new THREE.Vector3().crossVectors(side, dir).normalize();
          this.n.push(nn.x, nn.y, nn.z);
          this.uv.push(reg.u0 + (reg.u1 - reg.u0) * j, 1 - (reg.v0 + (reg.v1 - reg.v0) * 0.5));
          this.c.push(col.r, col.g, col.b);
          this.l.push(1, 0, sway[k], phase);
        }
      }
      for (let k = 0; k < pts.length - 1; k++) { const a = v0 + k * 2; this.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      this.v += pts.length * 2;
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.l, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
// highlight colours shared with stones / driftwood: selected, under the cursor (movable), being moved
export const HI_COL = { sel: [0.008, 0.03, 0.02], hover: [0.05, 0.2, 0.3], drag: [0.45, 0.24, 0.02] };   // sel is faint: the gizmo ring marks it
const perp = (d) => { const a = Math.abs(d.y) < 0.9 ? _up : new THREE.Vector3(1, 0, 0); return new THREE.Vector3().crossVectors(d, a).normalize(); };
const sRGB = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

export class Plants {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.carpets = new Map();         // species id -> { grid, mesh }
  }
  async init(defs) {
    this.defs = defs;
    const proc = proceduralAtlas();
    this.proc = proc.regions;
    const [tex, alpha, meta] = await Promise.all([loadImageTex('tex/leaves.webp'), loadImageTex('tex/leaves_a.webp', false), loadJSON('tex/leaves.json')]);
    this.meta = meta || {};
    const dummy = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); dummy.needsUpdate = true;
    if (alpha) alpha.colorSpace = THREE.NoColorSpace;
    for (const t of [tex, alpha]) if (t) { t.anisotropy = 4; }
    this.mat = plantMaterial(tex || dummy, alpha || dummy, proc.tex);
    // the same leaves glowing: selected / under the cursor / being moved (ui.js picks one per clump)
    this.hiMat = {};
    for (const [k, c] of Object.entries(HI_COL)) this.hiMat[k] = plantMaterial(tex || dummy, alpha || dummy, proc.tex, c);
    // flip the v of atlas rects once (JSON is in image coordinates; builder converts)
  }
  /** leaf regions for a species: { regs, sel (0 photo atlas / 1 procedural), recolor } */
  leaves(def) {
    const real = (k) => this.meta[k]?.length ? this.meta[k] : null;
    const pick = (k, fb, recolor) => real(k) ? { regs: real(k), sel: 0, recolor: 0 } : { regs: fb.regs, sel: fb.sel, recolor };
    const green = real('lf_green') ? { regs: real('lf_green'), sel: 0 } : { regs: this.proc.blade, sel: 1 };
    const round = real('lf_ludwigia') ? { regs: real('lf_ludwigia'), sel: 0 } : green;
    switch (def.leaf) {
      case 'lf_rotala': return pick('lf_rotala', green, 1);
      case 'lf_ludwigia': return pick('lf_ludwigia', round, 1);
      case 'lf_green': return pick('lf_green', green, 1);
      case 'lf_carpet': return pick('lf_carpet', round, 1);
      case 'lf_crypt': return pick('lf_crypt', green, 1);
      case 'lf_sword': return pick('lf_sword', green, 1);
      case 'lf_anubias': return pick('lf_anubias', round, 1);
      case 'lf_fern': return pick('lf_fern', green, 1);
      case 'moss': return real('moss') ? { regs: real('moss'), sel: 0, recolor: 0 } : { regs: this.proc.moss, sel: 1, recolor: 0 };
      case 'valis': return real('valis') ? { regs: real('valis'), sel: 0, recolor: 0 } : { regs: this.proc.ribbon, sel: 1, recolor: 0 };
      default: return { regs: this.proc.blade, sel: 1, recolor: 0 };
    }
  }

  /** Build the mesh for a clump / epiphyte item: { type, seed, scale } at the local origin (up = +y). */
  buildClump(def, item, maxY = 1, box = null) {
    const R = rng(item.seed * 7919 + 1), B = new Builder(maxY, box);
    const L = this.leaves(def);
    const sc = item.scale || 1;
    const base = sRGB(...def.color);
    const tint = (k = 0) => base.clone().offsetHSL((R() - 0.5) * 0.03, (R() - 0.5) * 0.1, (R() - 0.5) * 0.08 + k);
    const tinted = L.recolor > 0;
    const white = new THREE.Color(1, 1, 1);
    const phase0 = R() * 6.28;
    const kind = def.kind;
    if (kind === 'stem') {
      const n = Math.round((9 + R() * 5) * Math.sqrt(sc));
      // rotala: leaves ordered from green (bottom) to red (top) by their photographed colour
      const regs = [...L.regs].sort((a, b) => ((a.col?.[0] ?? 0) - (a.col?.[1] ?? 0)) - ((b.col?.[0] ?? 0) - (b.col?.[1] ?? 0)));
      for (let s = 0; s < n; s++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.022 * Math.sqrt(sc);
        const H = def.h * sc * (0.62 + 0.5 * R());
        const lean = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.12 + R() * 0.15);
        const pts = [], sway = [];
        let p = new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr), d = new THREE.Vector3(0, 1, 0).add(lean).normalize();
        const segs = 8;
        for (let k = 0; k <= segs; k++) {
          pts.push(p.clone()); sway.push(k / segs);
          d.x += (R() - 0.5) * 0.12; d.z += (R() - 0.5) * 0.12; d.y += 0.05; d.normalize();
          p = p.clone().addScaledVector(d, H / segs);
          // reaching the surface: the tip turns and creeps along it
          if (p.y > maxY) { p.y = maxY; d.y = 0; d.x += lean.x * 3; d.z += lean.z * 3; d.normalize(); }
          B.clampIn(p, d);
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        B.stem(pts, 0.0016, this.proc.solid, tint(-0.12), sway, phase0 + s * 0.4);
        const spacing = (def.leafSize || 1) * 0.0062 * (0.8 + 0.4 * R());
        const nodes = Math.floor(H / spacing);
        let rot = R() * Math.PI;
        const off = R();
        for (let k = 1; k <= nodes; k++) {
          const t = Math.min(1, (k - off * 0.9 + (R() - 0.5) * 0.3) / nodes);
          if (t <= 0.02) continue;
          const pos = curve.getPointAt(Math.min(t, 1)), tan = curve.getTangentAt(Math.min(t, 1));
          rot += Math.PI / 2 + (R() - 0.5) * 0.3;
          // leaves shrink toward the growing tip and stand more upright there
          const size = 0.0185 * (def.leafSize || 1) * (0.55 + 0.45 * Math.min(1, (1 - t) * 3 + 0.2)) * (0.85 + 0.3 * R());
          const up = THREE.MathUtils.lerp(1.0, 0.35, Math.pow(t, 1.5));
          for (const side of [0, Math.PI]) {
            const ang = rot + side;
            const out = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
            const dir = out.clone().multiplyScalar(Math.sin(up)).addScaledVector(tan, Math.cos(up)).normalize();
            const S = new THREE.Vector3().crossVectors(dir, out).normalize().negate();
            const idx = Math.min(regs.length - 1, Math.max(0, Math.round((t * 0.9 + (R() - 0.5) * 0.25) * (regs.length - 1))));
            const reg = def.leaf === 'lf_rotala' ? regs[idx] : regs[Math.floor(R() * regs.length)];
            let col = white.clone();
            if (tinted) col = tint().lerp(sRGB(...(def.tip || def.color)), Math.pow(t, 2));
            else if (def.tip && def.leaf !== 'lf_rotala') col = white.clone().lerp(sRGB(...def.tip).multiplyScalar(1.4), Math.pow(t, 3) * 0.5);
            // self-shading inside the bush: lower and inner leaves get less light
            col = col.clone().multiplyScalar((0.5 + 0.5 * Math.pow(t, 0.7)) * (0.8 + 0.2 * Math.min(1, rr / 0.015)));
            B.leaf(pos, dir, S, size, reg, col, L.sel, L.recolor, t * 0.9, t * 0.9 + 0.08, phase0 + s * 0.4, -0.5, 1, 2);
          }
        }
      }
    } else if (kind === 'rosette') {
      const n = Math.round((def.big ? 14 : 11) + R() * 5);
      for (let k = 0; k < n; k++) {
        const az = (k / n) * Math.PI * 2 * 2.4 + R() * 0.5;     // golden-ish spiral
        const inner = k / n;
        const el = THREE.MathUtils.lerp(1.25, 0.55, inner) + (R() - 0.5) * 0.25;   // young leaves upright in the middle
        const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const dir = out.clone().multiplyScalar(Math.cos(el)).add(new THREE.Vector3(0, Math.sin(el), 0)).normalize();
        const S = perp(dir);
        const Lk = def.h * sc * (0.6 + 0.5 * R()) * (1.1 - inner * 0.3);
        const reg = L.regs[Math.floor(R() * L.regs.length)];
        const col = tinted ? tint() : white;
        // a borrowed lanceolate leaf is stretched to the species' proportions
        const widthK = tinted ? (def.big ? 0.5 : 0.75) : 1;
        B.leaf(new THREE.Vector3((R() - 0.5) * 0.006, 0, (R() - 0.5) * 0.006), dir, S, Lk, reg, col, L.sel, L.recolor, 0, 0.6, phase0 + k, 0.9 + R() * 0.4, widthK, 5);
      }
    } else if (kind === 'ribbon') {
      const n = Math.round((12 + R() * 8) * Math.sqrt(sc));
      for (let k = 0; k < n; k++) {
        const az = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.02;
        const p = new THREE.Vector3(Math.cos(az) * rr, 0, Math.sin(az) * rr);
        const dir = new THREE.Vector3((R() - 0.5) * 0.25, 1, (R() - 0.5) * 0.25 - 0.08).normalize();
        const S = new THREE.Vector3(Math.cos(az + R()), 0, Math.sin(az + R())).cross(dir).normalize();
        const Lk = def.h * sc * (0.6 + 0.5 * R());
        const reg = L.regs[Math.floor(R() * L.regs.length)];
        // a ribbon is ~8 mm wide whatever its length; the photographed ribbon keeps its own colour and spots
        const col = L.sel || L.recolor ? tint() : white.clone().multiplyScalar(0.85 + 0.3 * R());
        B.leaf(p, dir, S, Lk, reg, col, L.sel, L.recolor, 0, 1.4, phase0 + k * 0.7, 0.5 + R() * 0.6, 0.008 / (Lk * reg.aspect), 10);
      }
    } else if (kind === 'anubias') {
      const n = 5 + Math.floor(R() * 4);
      for (let k = 0; k < n; k++) {
        const az = R() * Math.PI * 2, el = 0.5 + R() * 0.7;
        const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        const base = new THREE.Vector3((R() - 0.5) * 0.03, 0.002, (R() - 0.5) * 0.012);
        const leafDir = dir.clone(); leafDir.y += 0.3; leafDir.normalize();
        const reg = L.regs[Math.floor(R() * L.regs.length)];
        const Lk = def.h * sc * (0.6 + 0.5 * R());
        if (L.sel === 0 && !tinted) {
          // the photographed leaf carries its own stalk: it starts at the rhizome
          B.leaf(base, leafDir, perp(leafDir), Lk * 1.2, reg, white, 0, 0, 0.0, 0.35, phase0 + k, -0.4, 1.0, 4);
          continue;
        }
        const stalkEnd = base.clone().addScaledVector(dir, 0.012 * sc);
        B.stem([base, base.clone().lerp(stalkEnd, 0.5), stalkEnd], 0.002, this.proc.solid, tint(-0.05), [0, 0.1, 0.2], phase0);
        B.leaf(stalkEnd, leafDir, perp(leafDir), Lk, reg, tinted ? tint() : white, L.sel, L.recolor, 0.15, 0.35, phase0 + k, -0.4, 1.0, 3);
      }
    } else if (kind === 'fern') {
      const n = 6 + Math.floor(R() * 5);
      for (let k = 0; k < n; k++) {
        const az = R() * Math.PI * 2, el = 0.85 + R() * 0.55;
        const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
        const reg = L.regs[Math.floor(R() * L.regs.length)];
        B.leaf(new THREE.Vector3((R() - 0.5) * 0.02, 0, (R() - 0.5) * 0.01), dir, perp(dir), def.h * sc * (0.55 + 0.5 * R()), reg,
               tinted ? tint() : white, L.sel, L.recolor, 0.05, 0.7, phase0 + k, 1.0 + R() * 0.5, tinted ? 0.42 : 1, 5);
      }
    } else if (kind === 'moss') {
      const n = Math.round(60 * sc);
      for (let k = 0; k < n; k++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.028 * Math.sqrt(sc);
        const p = new THREE.Vector3(Math.cos(a) * rr, (R() - 0.3) * 0.004, Math.sin(a) * rr);
        const dir = new THREE.Vector3(Math.cos(a) * 0.9, 0.5 + R() * 0.5, Math.sin(a) * 0.9).normalize();
        const reg = L.regs[Math.floor(R() * L.regs.length)];
        // photographed sprigs carry their own colour; the procedural frond is grey and takes the species tint
        const col = L.sel ? tint() : white.clone().multiplyScalar(0.8 + 0.3 * R());
        B.leaf(p, dir, perp(dir), 0.012 + R() * 0.014, reg, col, L.sel, 0, 0.0, 0.25, phase0 + k, -0.4 + R() * 0.8, 1, 2);
      }
    }
    const g = B.geometry();
    if (kind !== 'moss') {
      const P = g.attributes.position, Cc = g.attributes.color;
      let ymax = 1e-3, rmax = 1e-3;
      for (let i = 0; i < P.count; i++) { ymax = Math.max(ymax, P.getY(i)); rmax = Math.max(rmax, Math.hypot(P.getX(i), P.getZ(i))); }
      const tintK = 0.9 + R() * 0.18, warm = (R() - 0.5) * 0.08;
      for (let i = 0; i < P.count; i++) {
        const rn = Math.hypot(P.getX(i), P.getZ(i)) / rmax, hn = Math.max(0, P.getY(i)) / ymax;
        const ao = 0.4 + 0.6 * Math.pow(THREE.MathUtils.clamp(0.4 * rn + 0.75 * hn, 0, 1), 0.75);
        Cc.setXYZ(i, Cc.getX(i) * ao * tintK * (1 + warm), Cc.getY(i) * ao * tintK, Cc.getZ(i) * ao * tintK * (1 - warm));
      }
    }
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.customDepthMaterial = this.mat.userData.depth;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.layers.enable(1);
    return mesh;
  }

  // ---------- carpets: instanced tufts over a density grid ----------
  tuftGeometry(def) {
    const R = rng(def.id.length * 131), B = new Builder();
    const L = this.leaves(def);
    const white = new THREE.Color(1, 1, 1), base = sRGB(...def.color);
    if (def.kind === 'hairgrass') {
      for (let k = 0; k < 9; k++) {
        const a = R() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25).normalize();
        const reg = this.proc.blade[k % this.proc.blade.length];
        B.leaf(new THREE.Vector3(Math.cos(a) * 0.002, 0, Math.sin(a) * 0.002), dir, perp(dir), def.h * (0.6 + 0.6 * R()), reg,
               base.clone().offsetHSL(0, 0, (R() - 0.5) * 0.1), 1, 0, 0, 1, R() * 6, 0.6 + R() * 0.5, 1.6, 4);
      }
    } else {
      // a little mound of tiny paired leaves
      const n = def.scale ? 14 : 18;
      for (let k = 0; k < n; k++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.007 * (def.scale || 1);
        const hgt = def.h * (0.3 + 0.7 * (1 - rr / 0.012)) * R();
        const p = new THREE.Vector3(Math.cos(a) * rr, hgt, Math.sin(a) * rr);
        const dir = new THREE.Vector3(Math.cos(a) * 0.8, 0.7 + R() * 0.4, Math.sin(a) * 0.8).normalize();
        const reg = L.regs[Math.floor(R() * L.regs.length)];
        const col = L.recolor ? base.clone().offsetHSL((R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.12) : white;
        B.leaf(p, dir, perp(dir), 0.0045 * (def.scale || 1) * (0.7 + 0.6 * R()), reg, col, L.sel, L.recolor, 0, 0.12, R() * 6, -0.3, 1, 1);
      }
    }
    return B.geometry();
  }

  carpet(def, soil) {
    let c = this.carpets.get(def.id);
    if (!c) {
      const NX = Math.round((soil.I.x1 - soil.I.x0) / 0.01), NZ = Math.round((soil.I.z1 - soil.I.z0) / 0.01);
      c = { def, NX, NZ, grid: new Uint8Array(NX * NZ), mesh: null, geo: this.tuftGeometry(def), dirty: true };
      this.carpets.set(def.id, c);
    }
    return c;
  }
  resetCarpets() {
    for (const c of this.carpets.values()) { if (c.mesh) { this.group.remove(c.mesh); c.mesh.dispose(); } c.geo.dispose(); }
    this.carpets.clear();
  }
  /** paint density (v 1 add / 0 erase) */
  paintCarpet(def, soil, x, z, r, v, k) {
    const c = this.carpet(def, soil);
    const cx = (x - soil.I.x0) / 0.01, cz = (z - soil.I.z0) / 0.01, cr = r / 0.01;
    for (let j = Math.max(0, Math.floor(cz - cr)); j <= Math.min(c.NZ - 1, Math.ceil(cz + cr)); j++)
      for (let i = Math.max(0, Math.floor(cx - cr)); i <= Math.min(c.NX - 1, Math.ceil(cx + cr)); i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / cr;
        if (d >= 1) continue;
        const n = j * c.NX + i, w = Math.min(1, (1 - d) * 2) * k;
        c.grid[n] = Math.round(THREE.MathUtils.clamp(c.grid[n] + (v * 255 - c.grid[n]) * w, 0, 255));
      }
    c.dirty = true;
  }
  rebuildCarpet(c, soil, avoid) {
    c.dirty = false;
    const R = rng(c.def.id.length * 17 + 3);
    const nz = this._carpetNoise ||= makeNoise(41);
    const per = c.def.kind === 'hairgrass' ? 2.2 : 1.6;     // tufts per cm² at full density
    const items = [];
    for (let j = 0; j < c.NZ; j++) for (let i = 0; i < c.NX; i++) {
      const d = c.grid[j * c.NX + i] / 255;
      if (d < 0.05) continue;
      const k = d * per;
      let cnt = Math.floor(k) + (R() < k - Math.floor(k) ? 1 : 0);
      while (cnt--) {
        const x = soil.I.x0 + (i + R()) * 0.01, z = soil.I.z0 + (j + R()) * 0.01;
        if (avoid && avoid(x, z)) continue;
        // a real carpet grows in mounds, thinner and lower toward its edges, with lighter and darker patches
        const mound = 0.7 + 0.55 * (nz(x * 14, z * 14, 0.3) * 0.5 + 0.5) + 0.25 * nz(x * 40, z * 40, 1.7);
        if (nz(x * 22, z * 22, 4.1) < -0.55 + (1 - d) * 0.6) continue;
        const shade = 0.78 + 0.32 * (nz(x * 9, z * 9, 7.3) * 0.5 + 0.5);
        items.push([x, z, R() * Math.PI * 2, (0.55 + 0.45 * d) * mound * (0.85 + R() * 0.3), shade]);
      }
    }
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.dispose(); }
    if (!items.length) { c.mesh = null; return; }
    // Stable thinning: storage and coverage remain at full resolution, only rendering changes.
    const density = this.renderDensity ?? 1;
    const visibleItems = density >= 1 ? items : items.filter((_, i) => ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) < density);
    const footprint = Math.min(1.55, 1 / Math.sqrt(density));
    const im = new THREE.InstancedMesh(c.geo, this.mat, visibleItems.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    visibleItems.forEach(([x, z, a, sc, shade], n) => {
      const nrm = soil.normalAt(x, z);
      q.setFromUnitVectors(_up, nrm.lerp(_up, 0.5).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(_up, a));
      p.set(x, soil.heightAt(x, z) - 0.001, z);
      s.set(sc * footprint, sc, sc * footprint);
      im.setMatrixAt(n, m.compose(p, q, s));
      im.setColorAt(n, col.setScalar(shade * (0.9 + 0.2 * R())));
    });
    im.customDepthMaterial = this.mat.userData.depth;
    im.castShadow = true; im.receiveShadow = true;
    im.layers.enable(1);
    im.frustumCulled = false;
    this.group.add(im);
    c.mesh = im;
  }
  coverage(c) {
    let s = 0; for (const v of c.grid) s += v / 255;
    return s * 0.0001;          // m² (1 cm cells)
  }
}
