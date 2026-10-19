// Shrimp and snails: procedural low-poly bodies (instanced per species), patterns painted in the shader, legs /
// antennae / swimmerets / tentacles animated in the vertex shader.
//   shrimp : walk over the substrate, stones and driftwood picking at biofilm, sometimes swim a short hop;
//            a startle makes them tail-flip backwards
//   snails : crawl very slowly on the front glass, stones and the soil
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchUnder, U, rng } from './shaders.js';

// photo: a studio photo exists (refs/aqua/<id>.png) -> catalogue thumb thumbs/<id>.jpg and the body texture tex/inv_<id>.webp
export const INVERTS = [
  { id: 'amano', photo: true, name: '大和藻虾', kind: 'shrimp', cm: 4, pattern: 0, opacity: 0.78, desc: '常见除藻虾，勤于清理藻类。', minGroup: 3 },
  { id: 'minami', photo: true, name: '米虾', kind: 'shrimp', cm: 2.5, pattern: 1, opacity: 0.8, desc: '耐养的淡水虾，可在缸内繁殖。', minGroup: 5 },
  { id: 'cherry', photo: true, name: '樱花虾', kind: 'shrimp', cm: 2.5, pattern: 2, opacity: 1, desc: '鲜红的小型虾，为水草缸增添色彩。', minGroup: 5 },
  { id: 'crs', photo: true, name: '红水晶虾', kind: 'shrimp', cm: 2.5, pattern: 3, opacity: 1, expert: true, desc: '红白相间的观赏虾，适合弱酸性软水。', minGroup: 5 },
  { id: 'nerite', photo: true, name: '石卷螺', kind: 'snail', cm: 2, pattern: 0, desc: '啃食玻璃及石材上的藻类，缸内不易繁殖。', minGroup: 1 },
  { id: 'ramshorn', photo: true, name: '红苹果螺', kind: 'snail', cm: 1.5, pattern: 1, desc: '红色螺旋壳水螺，可清理残饵。', minGroup: 1 },
];
const MAXN = 60;
const R = rng(313);

// ---------- geometry ----------
function partAttr(g, part, w, ph) {
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [part, w, ph][i % 3]), 3));
  return g;
}
/** shrimp of length 1 along x (head +x), standing with its feet on y = 0 */
function shrimpGeometry() {
  const parts = [];
  // body: a curved loft, carapace big, abdomen tapering and bending down to the tail fan
  const S = 28, RING = 12, pos = [], idx = [], uvs = [];
  const prof = (s) => (s < 0.06 ? 0.25 + s / 0.06 * 0.55 : s < 0.38 ? 0.8 + 0.2 * Math.sin((s - 0.06) / 0.32 * Math.PI * 0.5) : 1.0 - (s - 0.38) / 0.62 * 0.62);
  const cy = (s) => 0.2 + 0.05 * Math.sin(Math.PI * Math.min(s / 0.7, 1)) - 0.09 * Math.max(0, s - 0.55) ** 2 * 4;
  for (let i = 0; i <= S; i++) {
    const s = i / S, x = 0.5 - s, p = prof(s);
    const ry = 0.1 * p, rz = 0.072 * p;
    for (let j = 0; j <= RING; j++) {
      const a = j / RING * Math.PI * 2;
      pos.push(x, cy(s) + Math.sin(a) * ry * (Math.sin(a) > 0 ? 1.1 : 0.85), Math.cos(a) * rz);
      uvs.push(s, j / RING);
    }
  }
  for (let i = 0; i < S; i++) for (let j = 0; j < RING; j++) { const a = i * (RING + 1) + j, b = a + RING + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  body.setIndex(idx); body.computeVertexNormals();
  parts.push(partAttr(body, 0, 0, 0));
  const tube = (pts, r, part, ph, seg = 8) => {
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 5, false);
    // weight = distance along the limb (0 at the body), for the vertex shader
    const P = g.attributes.position, n = P.count, a = new Float32Array(n * 3), p0 = new THREE.Vector3(...pts[0]);
    const len = pts.reduce((L, p, i) => (i ? L + new THREE.Vector3(...p).distanceTo(new THREE.Vector3(...pts[i - 1])) : 0), 0);
    for (let i = 0; i < n; i++) { const d = new THREE.Vector3().fromBufferAttribute(P, i).distanceTo(p0) / len; a.set([part, d, ph], i * 3); }
    g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(a, 3));
    return g;
  };
  // rostrum
  parts.push(tube([[0.5, 0.21, 0], [0.62, 0.23, 0], [0.7, 0.24, 0]], 0.008, 5, 0, 4));
  // underside of the loft at x (legs and swimmerets start just inside it, so they never float below the body)
  const belly = (x) => { const s = 0.5 - x; return cy(s) - 0.1 * prof(s) * 0.85 + 0.012; };
  // five pairs of walking legs under the carapace: down and out to a knee, then the foot on the ground
  for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) {
    const x = 0.36 - k * 0.075, y0 = belly(x);
    parts.push(tube([[x, y0, sd * 0.025], [x + 0.025, y0 - 0.03, sd * 0.1], [x + 0.01, 0.05, sd * 0.14], [x - 0.012 + k * 0.006, 0.0, sd * 0.155]], 0.0055, 1, k * 1.3 + (sd > 0 ? 3.14 : 0), 8));
  }
  // swimmerets under the abdomen: thin paddles angled back
  for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) {
    const x = 0.02 - k * 0.075, y0 = belly(x);
    parts.push(tube([[x, y0, sd * 0.02], [x - 0.015, y0 - 0.035, sd * 0.035], [x - 0.03, y0 - 0.06, sd * 0.04]], 0.0065, 2, k * 0.8, 4));
  }
  // long antennae sweeping back over the body, short antennules forward
  for (const sd of [-1, 1]) {
    parts.push(tube([[0.48, 0.24, sd * 0.03], [0.62, 0.3, sd * 0.1], [0.45, 0.36, sd * 0.2], [0.0, 0.36, sd * 0.28], [-0.6, 0.3, sd * 0.32]], 0.004, 3, sd, 18));
    parts.push(tube([[0.48, 0.23, sd * 0.02], [0.62, 0.27, sd * 0.06], [0.76, 0.27, sd * 0.09]], 0.005, 3, sd + 2, 5));
  }
  // tail fan: five blades
  for (let k = -2; k <= 2; k++) {
    const a = k * 0.32, g = new THREE.PlaneGeometry(0.14, 0.045, 3, 1);
    g.translate(-0.07, 0, 0); g.rotateX(Math.PI / 2); g.rotateY(a); g.translate(-0.47, cy(1) - 0.02, 0);
    parts.push(partAttr(g, 4, 1, 0));
  }
  // eyes on short stalks
  for (const sd of [-1, 1]) { const e = new THREE.SphereGeometry(0.022, 8, 6); e.translate(0.47, 0.25, sd * 0.05); parts.push(partAttr(e, 6, 0, 0)); }
  const g = mergeGeometries(parts.map((p) => { if (!p.index) p = p.toNonIndexed ? p : p; return p; }), false);
  g.computeBoundingSphere();
  return g;
}
/** snail of size 1: nerite = low dome; ramshorn = flat coil standing on edge. Foot on y = 0, head +x */
function snailGeometry(pattern) {
  const parts = [];
  if (pattern === 0) {
    const sh = new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    sh.scale(1, 0.62, 0.85); sh.translate(-0.05, 0.06, 0);
    parts.push(partAttr(sh, 0, 0, 0));
  } else {
    // planispiral: a tube along a growing spiral in the x-y plane
    const pts = [];
    for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 5.2, r = 0.05 + a * 0.026; pts.push(new THREE.Vector3(-Math.cos(a) * r, 0.36 + Math.sin(a) * r, 0)); }   // mirrored: the aperture opens forward-down, over the foot
    const sh = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.1, 10, false);
    const P = sh.attributes.position;
    for (let i = 0; i < P.count; i++) { const k = i / P.count; P.setXYZ(i, P.getX(i), P.getY(i), P.getZ(i) * (0.6 + 1.6 * k)); }
    sh.computeVertexNormals();
    parts.push(partAttr(sh, 0, 0, 0));
  }
  const foot = new THREE.SphereGeometry(0.42, 16, 8); foot.scale(1.2, 0.18, 0.62); foot.translate(0.06, 0.03, 0);
  parts.push(partAttr(foot, 7, 0, 0));
  for (const sd of [-1, 1]) {
    const t = new THREE.CylinderGeometry(0.012, 0.02, 0.3, 5); t.rotateZ(-1.0); t.rotateX(sd * 0.5); t.translate(0.6, 0.12, sd * 0.1);
    parts.push(partAttr(t, 3, 1, sd));
  }
  for (const p of parts) { if (!p.attributes.uv) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2)); }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  g.computeBoundingSphere();
  return g;
}

// ---------- material ----------
const INV_V = /* glsl */`
attribute vec3 aPart;
attribute vec4 aAnim;          // per instance: walk phase, walk amount, swim (0..1), seed
varying vec3 vPart; varying vec2 vIUv; varying vec3 vIPos;`;
const INV_MOVE = /* glsl */`
vPart = aPart; vIUv = uv; vIPos = position;
{
  float part = floor(aPart.x + 0.5), w = aPart.y, ph = aPart.z;
  float walk = aAnim.y, swim = aAnim.z, t = uTime + aAnim.w * 10.0;
  if (part == 1.0) {                                                   // legs step
    float st = sin(aAnim.x * 6.2831853 + ph);
    transformed.x += st * 0.05 * w * (0.25 + walk);
    transformed.y += max(0.0, cos(aAnim.x * 6.2831853 + ph)) * 0.03 * w * walk;
    transformed.y += swim * w * 0.06;                                   // tucked in while swimming
  } else if (part == 2.0) {                                            // swimmerets beat (fast when swimming)
    transformed.x += sin(t * (6.0 + 14.0 * swim) + ph) * 0.03 * w * (0.4 + swim);
  } else if (part == 3.0) {                                            // antennae / tentacles feel around
    transformed.y += sin(t * 1.7 + ph + w * 3.0) * 0.06 * w * w;
    transformed.z += sin(t * 1.3 + ph * 2.0 + w * 4.0) * 0.07 * w * w;
  } else if (part == 4.0) {                                            // tail fan flicks
    transformed.y += sin(t * 2.2) * 0.012 * swim;
  }
}`;
// shell projection boxes for the snail photos (model units): nerite seen from above (x, z), ramshorn from the side
// (x, top y); the ramshorn box puts the coil centre (x = 0) where it is in the photo (36% across)
const SHELL_BOX = [new THREE.Vector4(-0.55, -0.425, 1.0, 0.85), new THREE.Vector4(-0.372, 0.878, 1.034, 0.954)];
const texLoader = new THREE.TextureLoader();
function invertMaterial(def) {
  const uni = { uKind: { value: def.kind === 'shrimp' ? 0 : 1 }, uPat: { value: def.pattern }, uTex: { value: null }, uHasTex: { value: 0 },
    uBox: { value: SHELL_BOX[def.pattern] || SHELL_BOX[0] } };
  if (def.photo) {
    // photo atlas from scripts/aqua/inv_tex.py (layout described there)
    const t = texLoader.load(`tex/inv_${def.id}.webp`, () => { uni.uHasTex.value = 1; });
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    uni.uTex.value = t;
  }
  const m = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0, transparent: (def.opacity ?? 1) < 1, opacity: def.opacity ?? 1, side: THREE.DoubleSide });
  patchUnder(m, {
    key: 'invert', uniforms: uni,
    vhead: INV_V, vertex: INV_MOVE,
    fhead: 'uniform float uKind, uPat, uHasTex; uniform sampler2D uTex; uniform vec4 uBox; varying vec3 vPart; varying vec2 vIUv; varying vec3 vIPos;\nfloat iH(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.7); }',
    map: `
      float part = floor(vPart.x + 0.5);
      vec3 c;
      if (uKind < 0.5) {
        float s = vIUv.x, ring = vIUv.y;                              // along the body, around it
        float seg = smoothstep(0.0, 0.05, abs(fract(max(s - 0.38, 0.0) * 9.0) - 0.5));   // abdomen segment lines
        if (uPat < 0.5) {             // amano: translucent grey-green, lines of red-brown dashes along the flanks
          c = vec3(0.42, 0.47, 0.42);
          float dash = step(0.62, fract(s * 34.0)) * (smoothstep(0.08, 0.0, abs(ring - 0.62)) + smoothstep(0.08, 0.0, abs(ring - 0.88)));
          c = mix(c, vec3(0.42, 0.14, 0.08), dash * step(0.08, s));
          c = mix(c, vec3(0.75, 0.74, 0.62), smoothstep(0.05, 0.0, abs(ring - 0.25)) * 0.6);   // pale dorsal stripe
        } else if (uPat < 1.5) {      // minami: translucent brown-grey with darker blotches
          c = mix(vec3(0.4, 0.37, 0.3), vec3(0.22, 0.2, 0.15), step(0.6, iH(floor(vec2(s * 24.0, ring * 8.0)))));
        } else if (uPat < 2.5) {      // cherry: solid glossy red
          c = vec3(0.62, 0.04, 0.03) * (0.85 + 0.3 * iH(floor(vec2(s * 30.0, ring * 10.0))));
        } else {                      // red bee: bold white and red bands
          float band = step(0.5, fract((s + 0.08) * 2.6));
          c = mix(vec3(0.6, 0.03, 0.03), vec3(0.92, 0.9, 0.86), band);
          if (s < 0.2) c = vec3(0.6, 0.03, 0.03);
        }
        c *= mix(0.72, 1.0, seg);
        if (part == 1.0 || part == 2.0) c = uPat > 2.5 ? vec3(0.9, 0.88, 0.84) : uPat > 1.5 ? vec3(0.6, 0.06, 0.04) : vec3(0.55, 0.55, 0.5);
        if (part == 3.0) c = uPat > 1.5 ? vec3(0.55, 0.08, 0.05) : vec3(0.5, 0.45, 0.4);
        if (uHasTex > 0.5) {
          // photo atlas: rows 0-127 body strip (s, ring), 128-175 tail fan, 176-191 leg | antenna colour
          if (part == 0.0) c = texture2D(uTex, vec2(s, 1.0 - ring * 128.0 / 192.0)).rgb * mix(0.88, 1.0, seg);
          else if (part == 4.0) c = texture2D(uTex, vec2(1.0 - vIUv.x, 1.0 - (128.0 + vIUv.y * 48.0) / 192.0)).rgb;
          else if (part == 1.0 || part == 2.0 || part == 5.0) c = texture2D(uTex, vec2(0.25, 1.0 - 184.0 / 192.0)).rgb;
          else if (part == 3.0) c = texture2D(uTex, vec2(0.75, 1.0 - 184.0 / 192.0)).rgb;
        }
        if (part == 6.0) c = vec3(0.02);
      } else {
        vec3 p = vIPos;
        if (uPat < 0.5) {             // nerite: olive-black shell with fine dark zigzags
          float z = sin(p.x * 70.0 + sin(p.z * 40.0) * 2.5);
          c = mix(vec3(0.16, 0.14, 0.07), vec3(0.03, 0.03, 0.02), smoothstep(0.3, 0.9, z));
        } else {                      // red ramshorn: translucent pink-red, growth lines
          c = vec3(0.55, 0.12, 0.1) * (0.8 + 0.25 * sin(atan(p.y - 0.36, p.x) * 40.0));
        }
        if (part == 7.0 || part == 3.0) c = uPat < 0.5 ? vec3(0.32, 0.3, 0.26) : vec3(0.7, 0.18, 0.15);
        if (uHasTex > 0.5) {
          // photo of the shell projected flat (rows 0-239), foot colour in rows 240-255
          vec2 q = uPat < 0.5 ? vec2((p.x - uBox.x) / uBox.z, (p.z - uBox.y) / uBox.w) : vec2((p.x - uBox.x) / uBox.z, (uBox.y - p.y) / uBox.w);
          if (part == 0.0) c = texture2D(uTex, vec2(clamp(q.x, 0.01, 0.99), 1.0 - clamp(q.y, 0.01, 0.99) * 240.0 / 256.0)).rgb;
          else if (part == 7.0 || part == 3.0) c = uPat < 0.5 ? c : texture2D(uTex, vec2(0.5, 1.0 - 248.0 / 256.0)).rgb;
        }
      }
      diffuseColor.rgb *= c;`,
  });
  return m;
}

const SHRIMP_G = { g: null }, SNAIL_G = [null, null];
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(), _V = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** a single static mesh of a species (catalogue thumbnails) */
export function makeInvertMesh(def) {
  const geo = (def.kind === 'shrimp' ? (SHRIMP_G.g ||= shrimpGeometry()) : (SNAIL_G[def.pattern] ||= snailGeometry(def.pattern))).clone();
  geo.setAttribute('aAnim', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 4), 4));
  return new THREE.Mesh(geo, invertMaterial(def));
}

export class Inverts {
  constructor(scene, ctx) { this.scene = scene; this.ctx = ctx; this.groups = new Map(); }
  _ensure(def) {
    if (this.groups.has(def.id)) return this.groups.get(def.id);
    let geo;
    if (def.kind === 'shrimp') geo = SHRIMP_G.g ||= shrimpGeometry();
    else geo = SNAIL_G[def.pattern] ||= snailGeometry(def.pattern);
    const g = geo.clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAnim', anim);
    const im = new THREE.InstancedMesh(g, invertMaterial(def), MAXN);
    im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
    im.layers.enable(1);
    this.scene.add(im);
    const grp = { def, im, anim, members: [] };
    this.groups.set(def.id, grp);
    return grp;
  }
  setCount(def, n) {
    const g = this._ensure(def);
    n = Math.min(n, MAXN);
    while (g.members.length < n) g.members.push(this._spawn(def));
    g.members.length = n;
    g.im.count = n;
  }
  count(id) { return this.groups.get(id)?.members.length || 0; }

  // a resting spot: on the soil, the top of a stone / driftwood cluster, or (snails) the front glass
  _spot(def, out = { p: new THREE.Vector3(), n: new THREE.Vector3(0, 1, 0) }) {
    const I = this.ctx.tank.inner, soil = this.ctx.soil, obs = this.ctx.obstacles;
    const k = R();
    if (def.kind === 'snail' && k < 0.5) {
      const x = THREE.MathUtils.lerp(I.x0 + 0.02, I.x1 - 0.02, R());
      out.p.set(x, THREE.MathUtils.lerp(soil.heightAt(x, I.z1) + 0.01, U.uWaterY.value - 0.03, R()), I.z1 - 0.001);
      out.n.set(0, 0, -1); out.glass = true;
    } else if (k < 0.75 && obs.length) {
      const o = obs[Math.floor(R() * obs.length)];
      out.p.set(o.c.x, o.c.y + o.r * 0.8, o.c.z); out.n.set(0, 1, 0); out.glass = false;
    } else {
      const x = THREE.MathUtils.lerp(I.x0 + 0.02, I.x1 - 0.02, R()), z = THREE.MathUtils.lerp(I.z0 + 0.02, I.z1 - 0.02, R());
      out.p.set(x, soil.heightAt(x, z), z); soil.normalAt(x, z, out.n); out.glass = false;
    }
    return out;
  }
  _spawn(def) {
    const s = this._spot(def);
    return { def, p: s.p.clone(), n: s.n.clone(), glass: s.glass, goal: this._spot(def), yaw: R() * 6.28, walk: 0, phase: R(), swim: 0,
             timer: R() * 3, mode: 'graze', seed: R(), hop: null, flee: 0 };
  }
  startle(point) {
    for (const g of this.groups.values()) {
      if (g.def.kind !== 'shrimp') continue;
      for (const m of g.members) if (m.p.distanceTo(point) < 0.1 && !m.hop) {
        // tail flip: shoot backwards and up, then settle somewhere else
        const back = new THREE.Vector3(-Math.cos(m.yaw), 0, Math.sin(m.yaw)).multiplyScalar(0.06 + R() * 0.05);
        const to = this._spot(g.def);
        to.p.copy(m.p).add(back); to.p.x = THREE.MathUtils.clamp(to.p.x, this.ctx.tank.inner.x0 + 0.01, this.ctx.tank.inner.x1 - 0.01);
        to.p.z = THREE.MathUtils.clamp(to.p.z, this.ctx.tank.inner.z0 + 0.01, this.ctx.tank.inner.z1 - 0.01);
        to.p.y = this.ctx.soil.heightAt(to.p.x, to.p.z); to.n.set(0, 1, 0);
        m.hop = { from: m.p.clone(), to, t: 0, dur: 0.45, flip: true };
      }
    }
  }
  update(dt, t) {
    dt = Math.min(dt, 0.05);
    for (const g of this.groups.values()) {
      if (!g.members.length) continue;
      const def = g.def, L = def.cm / 100;
      const A = g.anim.array;
      g.members.forEach((m, i) => {
        if (def.kind === 'shrimp') this._shrimp(m, L, dt, t); else this._snail(m, L, dt);
        A.set([m.phase, m.walk, m.swim, m.seed], i * 4);
        // orientation: up = surface normal (body level while swimming), forward = yaw projected on the surface
        const up = m.hop ? _up : m.n;
        const f = new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
        if (Math.abs(up.y) < 0.5) f.set(0, 1, 0).applyAxisAngle(up, m.yaw);           // on the glass: yaw is the heading on it
        f.addScaledVector(up, -f.dot(up)).normalize();
        const z = new THREE.Vector3().crossVectors(f, up).normalize();
        _M.makeBasis(f, up, z);
        _Q.setFromRotationMatrix(_M);
        if (m.hop?.flip) _Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(m.hop.t / m.hop.dur * Math.PI) * 0.5));
        _S.setScalar(L);
        g.im.setMatrixAt(i, _M.compose(m.p, _Q, _S));
      });
      g.im.instanceMatrix.needsUpdate = true;
      g.anim.needsUpdate = true;
    }
  }
  _shrimp(m, L, dt) {
    if (m.hop) {
      m.hop.t += dt;
      const k = Math.min(1, m.hop.t / m.hop.dur), e = k * k * (3 - 2 * k);
      m.p.lerpVectors(m.hop.from, m.hop.to.p, e);
      m.p.y += Math.sin(k * Math.PI) * (m.hop.flip ? 0.03 : 0.05);
      m.swim = 1; m.walk = 0;
      if (k >= 1) { m.n.copy(m.hop.to.n); m.hop = null; m.swim = 0; m.timer = 1 + R() * 3; }
      return;
    }
    m.timer -= dt;
    if (m.timer < 0) {
      if (R() < 0.18) {       // swim a short hop to another spot
        const to = this._spot(m.def);
        if (to.p.distanceTo(m.p) < 0.25) { m.hop = { from: m.p.clone(), to, t: 0, dur: 0.8 + to.p.distanceTo(m.p) * 6 }; m.yaw = Math.atan2(-(to.p.z - m.p.z), to.p.x - m.p.x); return; }
      }
      m.mode = R() < 0.55 ? 'graze' : 'walk';
      m.timer = m.mode === 'graze' ? 2 + R() * 5 : 1 + R() * 2.5;
      if (m.mode === 'walk') m.yaw += (R() - 0.5) * 2.2;
    }
    const soil = this.ctx.soil, I = this.ctx.tank.inner;
    if (m.mode === 'walk') {
      const v = L * 0.9;
      m.p.x += Math.cos(m.yaw) * v * dt; m.p.z -= Math.sin(m.yaw) * v * dt;
      if (m.p.x < I.x0 + 0.01 || m.p.x > I.x1 - 0.01 || m.p.z < I.z0 + 0.01 || m.p.z > I.z1 - 0.01) {
        m.yaw += Math.PI; m.p.x = THREE.MathUtils.clamp(m.p.x, I.x0 + 0.01, I.x1 - 0.01); m.p.z = THREE.MathUtils.clamp(m.p.z, I.z0 + 0.01, I.z1 - 0.01);
      }
      // stay on whatever it stands on: the soil, or the top of a stone it walked onto
      const h = soil.heightAt(m.p.x, m.p.z);
      if (m.p.y - h < 0.012 || m.p.y < h) { m.p.y = h; soil.normalAt(m.p.x, m.p.z, m.n); }
      else { m.p.y = Math.max(h, m.p.y - dt * 0.004); }
      m.walk += (1 - m.walk) * Math.min(1, dt * 5);
      m.phase += dt * 2.6;
    } else {
      // grazing: legs pick at the surface, tiny shuffles
      m.walk += (0.25 - m.walk) * Math.min(1, dt * 3);
      m.phase += dt * 1.2;
      m.yaw += Math.sin(m.phase * 2.3) * 0.15 * dt;
    }
  }
  _snail(m, L, dt) {
    m.timer -= dt;
    if (m.timer < 0 || m.p.distanceTo(m.goal.p) < L * 0.5) { m.goal = this._spot(m.def, m.goal); m.timer = 30 + R() * 40; }
    // creep toward the goal; snails on the glass stay on the glass, others on the ground
    const v = L * 0.08;
    if (m.glass) {
      const I = this.ctx.tank.inner;
      m.yaw += Math.sin(m.seed * 9 + m.phase) * 0.05 * dt;
      m.p.x += Math.sin(m.yaw) * v * dt; m.p.y += Math.cos(m.yaw) * v * dt;
      if (m.p.y > U.uWaterY.value - 0.02 || m.p.y < this.ctx.soil.heightAt(m.p.x, I.z1) + 0.01) m.yaw += Math.PI * dt * 2;
      m.p.x = THREE.MathUtils.clamp(m.p.x, I.x0 + 0.01, I.x1 - 0.01);
      m.p.z = I.z1 - 0.001; m.n.set(0, 0, -1);
    } else {
      _V.subVectors(m.goal.p, m.p).setY(0);
      if (_V.lengthSq() > 1e-8) { const want = Math.atan2(-_V.z, _V.x); m.yaw += Math.atan2(Math.sin(want - m.yaw), Math.cos(want - m.yaw)) * Math.min(1, dt * 0.5); }
      m.p.x += Math.cos(m.yaw) * v * dt; m.p.z -= Math.sin(m.yaw) * v * dt;
      m.p.y = this.ctx.soil.heightAt(m.p.x, m.p.z); this.ctx.soil.normalAt(m.p.x, m.p.z, m.n);
    }
    m.phase += dt * 0.4; m.walk = 0.3;
  }
}
