// Life in the water of a planted tank: drifting motes that glint in the light and oxygen bubbles pearling off the
// leaves (with light and CO2).
import * as THREE from 'three';
import { U, rng } from './shaders.js';

const R = rng(99);

const MOTE_VS = /* glsl */`
attribute vec4 aRnd;
uniform float uTime, uWaterY, uSize;
uniform vec3 uMin, uMax;
varying float vB;
void main() {
  vec3 span = uMax - uMin;
  // slow drift with the current, wrapped inside the water box
  vec3 p = position + vec3(uTime * 0.004 * (0.5 + aRnd.x), sin(uTime * 0.3 + aRnd.y * 6.28) * 0.004, cos(uTime * 0.21 + aRnd.z * 6.28) * 0.004);
  p = uMin + mod(p - uMin, span);
  p.y = min(p.y, uWaterY - 0.002);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + aRnd.w) / -mv.z;
  // brighter near the lamp, twinkling as they tumble
  vB = (0.35 + 0.65 * smoothstep(0.0, uWaterY, p.y)) * (0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * (1.0 + aRnd.x * 3.0) + aRnd.y * 40.0), 4.0));
}`;
const MOTE_FS = /* glsl */`
uniform float uLamp;
varying float vB;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(q));
  gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * vB * a * 0.28 * uLamp, 1.0);
}`;

const BUB_VS = /* glsl */`
attribute vec4 aBub;          // xyz position, w radius
uniform float uTime;
varying vec2 vQ;
void main() {
  vQ = position.xy;
  vec4 mv = viewMatrix * vec4(aBub.xyz, 1.0);
  mv.xy += position.xy * aBub.w;
  gl_Position = projectionMatrix * mv;
}`;
const BUB_FS = /* glsl */`
uniform float uLamp;
varying vec2 vQ;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  // an air bubble in water: dark-ish body, bright rim (total reflection), a highlight from the lamp above
  float rim = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float hi = smoothstep(0.3, 0.0, length(vQ - vec2(-0.25, 0.35)));
  vec3 c = vec3(0.75, 0.85, 0.9) * rim * 1.3 + vec3(1.0) * hi * 1.6;
  float a = clamp(rim * 0.85 + hi + 0.06, 0.0, 1.0);
  gl_FragColor = vec4(c * uLamp, a);
}`;

export class Effects {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group(); app.scene.add(this.group);
    this.lampU = { value: 1 };
    // ---- motes
    const N = 420, pos = new Float32Array(N * 3), rnd = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { pos.set([R(), R(), R()], i * 3); rnd.set([R(), R(), R(), R()], i * 4); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    this.moteU = { uTime: U.uTime, uWaterY: U.uWaterY, uMin: U.uTankMin, uMax: U.uTankMax, uSize: { value: 2.6 }, uLamp: this.lampU };
    this.motes = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.moteU, vertexShader: MOTE_VS, fragmentShader: MOTE_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    // ---- bubbles (instanced billboards)
    this.maxB = 360;
    const bg = new THREE.InstancedBufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    bg.setIndex([0, 1, 2, 0, 2, 3]);
    this.bubA = new THREE.InstancedBufferAttribute(new Float32Array(this.maxB * 4), 4);
    this.bubA.setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('aBub', this.bubA);
    bg.instanceCount = 0;
    this.bubbles = new THREE.Mesh(bg, new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime, uLamp: this.lampU }, vertexShader: BUB_VS, fragmentShader: BUB_FS,
      transparent: true, depthWrite: false }));
    this.bubbles.frustumCulled = false;
    this.bubbles.layers.enable(1);
    this.group.add(this.bubbles);
    this.bub = [];
    this.pearlSrc = []; this.pearlT = 0;
    this.co2 = true;
    this.equip = new THREE.Group(); app.scene.add(this.equip);
  }

  /** per tank: nothing to build any more (the filter pipes and the CO2 diffuser were taken out); clears bubbles */
  build() {
    while (this.equip.children.length) { const c = this.equip.children.pop(); c.geometry?.dispose(); }
    this.bub.length = 0;
  }
  setBackground() {}

  update(dt, t) {
    const app = this.app, wy = U.uWaterY.value, lamp = app.tank.lampOn;
    this.lampU.value = Math.min(1.4, 0.15 + lamp);
    // pearling: oxygen bubbles let go from the upper leaves now and then (needs light + CO2)
    this.pearlT -= dt;
    if (this.pearlT < 0) { this.pearlT = 3; this._pearlSources(); }
    if (this.co2 && lamp > 0.3 && this.pearlSrc.length && Math.random() < dt * Math.min(12, this.pearlSrc.length * 0.08)) {
      const p = this.pearlSrc[Math.floor(Math.random() * this.pearlSrc.length)];
      if (this.bub.length < this.maxB) this.bub.push({ p: p.clone(), r: 0.0009 + Math.random() * 0.0011, vy: 0.05 + Math.random() * 0.04, ph: Math.random() * 6, hold: 0.6 + Math.random() * 1.5 });
    }
    const A = this.bubA.array;
    let k = 0;
    for (const b of this.bub) {
      if (b.hold > 0) { b.hold -= dt; }
      else {
        b.p.y += b.vy * dt;
        b.p.x += (Math.sin(t * 9 + b.ph) * 0.004 + 0.002) * dt;
        b.p.z += Math.cos(t * 7 + b.ph) * 0.004 * dt;
      }
      if (b.p.y > wy - b.r) b.dead = true;
      else { A[k * 4] = b.p.x; A[k * 4 + 1] = b.p.y; A[k * 4 + 2] = b.p.z; A[k * 4 + 3] = b.r; k++; }
    }
    this.bub = this.bub.filter((b) => !b.dead);
    this.bubbles.geometry.instanceCount = k;
    this.bubA.needsUpdate = true;
  }

  _pearlSources() {
    const out = [];
    const v = new THREE.Vector3();
    for (const { item, mesh } of this.app.layout.items.values()) {
      if (item.kind !== 'plant') continue;
      const P = mesh.geometry.attributes.position, L = mesh.geometry.attributes.aLeaf;
      if (!L) continue;
      mesh.updateMatrixWorld(true);
      for (let n = 0; n < 6; n++) {
        const i = Math.floor(Math.random() * P.count);
        if (L.getX(i) > 0.5 && L.getZ(i) < 0.4) continue;         // stems / procedural base parts
        out.push(v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld).clone());
      }
    }
    for (const c of this.app.plants.carpets.values()) {
      if (!c.mesh) continue;
      const m = new THREE.Matrix4();
      for (let n = 0; n < 10; n++) { c.mesh.getMatrixAt(Math.floor(Math.random() * c.mesh.count), m); out.push(new THREE.Vector3().setFromMatrixPosition(m).add(new THREE.Vector3(0, c.def.h * 0.8, 0))); }
    }
    this.pearlSrc = out;
  }
}
