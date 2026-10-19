// Procedural driftwood: recursive branching tubes (spiderwood-like "branch", a gnarled single log, a root stump),
// merged into one mesh with a water-worn wood photo along the grain. Origin = base point on the soil.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchUnder, rng, makeNoise, TRIPLANAR_GLSL, NATURE_GLSL } from './shaders.js';
import { surfaceTex, onTex } from './textures.js';

const TILE_M = 0.09;        // metres of real wood per photo tile along the grain

function tube(points, r0, r1, rnd, noise) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const len = curve.getLength();
  const segs = Math.max(6, Math.ceil(len / 0.018));
  const rad = Math.max(6, Math.min(16, Math.round(8 + r0 * 160)));
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], uv = [], col = [], idx = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), tan = new THREE.Vector3();
  const seed = rnd() * 100;
  // water-worn wood: a few deep flutes that twist along the grain, fine ridges, knots, a flattened section
  const flutes = 2 + Math.floor(rnd() * 3), twist = (rnd() - 0.5) * 5, flat = 0.12 * rnd(), flatA = rnd() * Math.PI;
  const knots = Array.from({ length: Math.floor(rnd() * 3) }, () => ({ t: 0.15 + rnd() * 0.7, a: rnd() * Math.PI * 2, k: 0.15 + rnd() * 0.25 }));
  const broken = r1 > 0.018;                        // thick ends snap off, thin ones taper to a point
  const circRaw = Math.PI * (r0 + r1);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    curve.getTangentAt(t, tan);
    const N = frames.normals[i], B = frames.binormals[i];
    let r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    r *= 1 + 0.16 * noise(seed, t * len * 14, 0) + 0.07 * noise(seed + 5, t * len * 41, 1);
    if (!broken && t > 0.9) r *= Math.sqrt(Math.max(0, (1 - t) / 0.1)) * 0.9 + 0.1;
    if (broken && t > 0.97) r *= 0.55;
    for (let j = 0; j <= rad; j++) {
      const a = (j % rad) / rad * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      let g = 1 - 0.2 * Math.pow(Math.abs(Math.sin(a * flutes * 0.5 + twist * t + seed)), 3);
      g += 0.055 * noise(seed + ca * 3, sa * 3, t * len * 5);                  // ridges running with the grain
      g *= 1 - flat * Math.abs(Math.cos(a - flatA));
      for (const k of knots) {
        const dt = (t - k.t) * len / Math.max(r0, 0.01);
        g += k.k * Math.exp(-dt * dt * 3) * Math.max(0, Math.cos(a - k.a)) ** 3;
      }
      n.set(0, 0, 0).addScaledVector(N, ca).addScaledVector(B, sa).normalize();
      let ox = 0;
      if (broken && t > 0.97) ox = (noise(seed + a * 2, 7, 3) + 0.4) * r0 * 0.6;    // a jagged snapped end
      pos.push(p.x + n.x * r * g + tan.x * ox, p.y + n.y * r * g + tan.y * ox, p.z + n.z * r * g + tan.z * ox);
      uv.push(j / rad * circRaw, t * len);
      // grooves are darker than the ridges between them
      const ao = THREE.MathUtils.clamp(0.55 + (g - 0.8) * 2.2, 0.45, 1.05);
      col.push(ao, ao, ao);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);         // outward winding (the other way round drew the log inside-out: half missing)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the u seam of every ring so it doesn't show as a crease
  const Nn = g.attributes.normal;
  for (let i = 0; i <= segs; i++) {
    const a = i * (rad + 1), b = a + rad;
    n.set(Nn.getX(a) + Nn.getX(b), Nn.getY(a) + Nn.getY(b), Nn.getZ(a) + Nn.getZ(b)).normalize();
    Nn.setXYZ(a, n.x, n.y, n.z); Nn.setXYZ(b, n.x, n.y, n.z);
  }
  // close both ends (an open end let you look into the tube, so a thick snapped-off log read as hollow):
  // a fan of darker end grain from the ring's centre, facing out along the tube
  const caps = [g];
  for (const [ring, out] of [[0, -1], [segs, 1]]) {
    const base = ring * (rad + 1);
    const P = g.attributes.position, c = new THREE.Vector3();
    for (let j = 0; j < rad; j++) c.add(new THREE.Vector3().fromBufferAttribute(P, base + j));
    c.divideScalar(rad);
    const dir = frames.tangents[ring].clone().multiplyScalar(out);
    const cp = [c.x, c.y, c.z], cuv = [0, 0], cc = [0.42, 0.42, 0.42], ci = [];
    const r0v = new THREE.Vector3().fromBufferAttribute(P, base);
    for (let j = 0; j <= rad; j++) {
      const v = new THREE.Vector3().fromBufferAttribute(P, base + (j % rad));
      // rings toward the middle of the cut: slightly lifted centre, growth rings in the vertex colour
      cp.push(v.x, v.y, v.z);
      const d = v.clone().sub(c);
      cuv.push(d.dot(r0v.clone().sub(c).normalize()), d.length() * 0.3);
      cc.push(0.5, 0.5, 0.5);
    }
    for (let j = 1; j <= rad; j++) ci.push(0, j, j + 1);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    cg.setIndex(ci);
    cg.computeVertexNormals();
    // make the fan face outward whichever way the ring winds
    const n0 = new THREE.Vector3().fromBufferAttribute(cg.attributes.normal, 0);
    if (n0.dot(dir) < 0) {
      const I = cg.index.array;
      for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
      cg.computeVertexNormals();
    }
    caps.push(cg);
  }
  const merged = mergeGeometries(caps, false);
  caps.forEach((x) => x.dispose());
  return merged;
}

// a wandering polyline: start, direction, length; bends by noise + gravity-free upward bias
function path(p0, dir, len, rnd, noise, wiggle = 0.35, up = 0.0, n = 6) {
  const pts = [p0.clone()];
  const d = dir.clone().normalize(), p = p0.clone();
  const s = rnd() * 50;
  for (let i = 1; i <= n; i++) {
    d.x += noise(s, i * 0.7, 0) * wiggle; d.y += noise(s, i * 0.7, 3) * wiggle * 0.7 + up; d.z += noise(s, i * 0.7, 6) * wiggle;
    d.normalize();
    p.addScaledVector(d, len / n);
    pts.push(p.clone());
  }
  return pts;
}

function branchOut(parts, pts, r0, depth, rnd, noise, opt) {
  if (depth <= 0) return;
  const curve = new THREE.CatmullRomCurve3(pts);
  const len = curve.getLength();
  const kids = Math.round(opt.kids[0] + rnd() * (opt.kids[1] - opt.kids[0]));
  for (let k = 0; k < kids; k++) {
    const t = 0.25 + 0.7 * (k + rnd() * 0.8) / kids;
    const p = curve.getPointAt(Math.min(t, 0.98)), tan = curve.getTangentAt(Math.min(t, 0.98));
    const side = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
    const ang = opt.spread * (0.6 + 0.6 * rnd());
    const dir = tan.clone().multiplyScalar(Math.cos(ang)).addScaledVector(side, Math.sin(ang));
    dir.y += opt.lift;
    const rr = r0 * (1 - t * 0.6) * (0.55 + 0.2 * rnd());
    const L = len * opt.lenK * (0.6 + 0.5 * rnd());
    const kp = path(p, dir, L, rnd, noise, opt.wiggle, opt.up, 5);
    parts.push(tube(kp, Math.max(rr, 0.0025), Math.max(rr * 0.18, 0.0012), rnd, noise));
    branchOut(parts, kp, rr, depth - 1, rnd, noise, opt);
  }
}

/** Geometry for a driftwood type, normalised so the largest extent is 1 (base at the origin). */
export function woodGeometry(shape, seed) {
  const rnd = rng(seed * 13 + 5), noise = makeNoise(seed + 3);
  const parts = [];
  const nz = (a, b, c) => noise(a, b, c);
  if (shape === 'branch') {
    // a knot on the soil with 2-3 slender limbs rising and splitting into fine twigs
    const stems = 2 + Math.floor(rnd() * 2);
    const az0 = rnd() * Math.PI * 2;
    for (let s = 0; s < stems; s++) {
      const az = az0 + s * (Math.PI * 2 / stems) * 0.45 + (rnd() - 0.5) * 0.6;
      const el = 0.45 + rnd() * 0.5;
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const pts = path(new THREE.Vector3((rnd() - 0.5) * 0.04, 0.0, (rnd() - 0.5) * 0.04), dir, 0.55 + rnd() * 0.35, rnd, nz, 0.4, 0.04, 7);
      const r0 = 0.03 + rnd() * 0.012;
      parts.push(tube(pts, r0, r0 * 0.25, rnd, nz));
      branchOut(parts, pts, r0, 4, rnd, nz, { kids: [2, 4], spread: 0.75, lift: 0.18, lenK: 0.5, wiggle: 0.45, up: 0.03 });
    }
    parts.push(tube([new THREE.Vector3(-0.04, 0.01, 0), new THREE.Vector3(0, 0.025, 0.01), new THREE.Vector3(0.05, 0.012, -0.01)], 0.045, 0.03, rnd, nz));
  } else if (shape === 'single') {
    // one thick gnarled log lying at an angle, rising from the soil, a couple of broken stubs
    const az = rnd() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(az), 0.55 + rnd() * 0.35, Math.sin(az));
    const pts = path(new THREE.Vector3(0, 0.02, 0), dir, 1.0, rnd, nz, 0.5, 0.02, 9);
    pts.unshift(new THREE.Vector3(-dir.x * 0.12, -0.02, -dir.z * 0.12));
    parts.push(tube(pts, 0.075, 0.03, rnd, nz));
    branchOut(parts, pts, 0.06, 2, rnd, nz, { kids: [1, 3], spread: 0.9, lift: 0.25, lenK: 0.35, wiggle: 0.5, up: 0.04 });
  } else {
    // root stump: a short trunk with roots spreading over the soil and a few limbs reaching up
    const trunk = path(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3((rnd() - 0.5) * 0.4, 1, (rnd() - 0.5) * 0.4), 0.55 + rnd() * 0.2, rnd, nz, 0.25, 0.0, 6);
    parts.push(tube(trunk, 0.08, 0.035, rnd, nz));
    const roots = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < roots; i++) {
      const az = (i / roots + rnd() * 0.12) * Math.PI * 2;
      const pts = [new THREE.Vector3(0, 0.08 + rnd() * 0.05, 0)];
      const p = new THREE.Vector3(Math.cos(az) * 0.05, 0.05, Math.sin(az) * 0.05); pts.push(p.clone());
      const L = 0.3 + rnd() * 0.25;
      for (let k = 1; k <= 5; k++) {
        const f = k / 5;
        pts.push(new THREE.Vector3(Math.cos(az + nz(i, f, 1) * 0.5) * (0.05 + L * f), 0.045 * (1 - f) - 0.012 * f + nz(i, f * 3, 4) * 0.015, Math.sin(az + nz(i, f, 1) * 0.5) * (0.05 + L * f)));
      }
      const rr = 0.026 + rnd() * 0.014;
      parts.push(tube(pts, rr, rr * 0.2, rnd, nz));
      if (rnd() < 0.6) branchOut(parts, pts, rr * 0.8, 1, rnd, nz, { kids: [1, 2], spread: 0.8, lift: -0.05, lenK: 0.4, wiggle: 0.4, up: -0.02 });
    }
    branchOut(parts, trunk, 0.06, 2, rnd, nz, { kids: [2, 3], spread: 0.65, lift: 0.3, lenK: 0.6, wiggle: 0.4, up: 0.03 });
  }
  let g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const s = 1 / Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  const P = g.attributes.position, C = g.attributes.color, UV = g.attributes.uv, Nn = g.attributes.normal;
  const ymin = bb.min.y;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i);
    P.setXYZ(i, P.getX(i) * s, (y - ymin) * s, P.getZ(i) * s);
    UV.setXY(i, UV.getX(i) * s, UV.getY(i) * s);              // uv in units of the piece size (shader makes them metres)
    // darker where it rests on / near the soil and on the undersides
    const ao = C.getX(i) * (0.62 + 0.38 * THREE.MathUtils.smoothstep((y - ymin) * s, 0.0, 0.12)) * (0.82 + 0.18 * (Nn.getY(i) * 0.5 + 0.5));
    C.setXYZ(i, ao, ao, ao);
  }
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// Driftwood shading: the water-worn wood photo along the grain at a metric scale (per piece), crevices darker than
// the ridges, soaked reddish-brown tone, biofilm on the upper sides, soil dust where it sits; normal map with a
// derivative tangent frame (no tangents in the merged tubes).
const WOOD_HEAD = TRIPLANAR_GLSL + NATURE_GLSL + /* glsl */`
uniform sampler2D tMap, tNor; uniform float uHi, uScale, uSeed; uniform vec3 uHiCol, uTint;
varying vec2 vWUv;
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x, B = dp2perp * duv1.y + dp1perp * duv2.y;
  float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  return mat3(T * im, B * im, N);
}`;
let woodBase = null;
const woodTex = { map: null, normal: null };
function woodShared() {
  if (woodBase) return woodBase;
  woodBase = { uni: { tMap: { value: null }, tNor: { value: null }, uTint: { value: new THREE.Vector3(0.78, 0.6, 0.47) } } };
  onTex(surfaceTex('w_drift', [0.5, 0.42, 0.34]), (x) => { woodBase.uni.tMap.value = x.map; woodBase.uni.tNor.value = x.normal; });
  return woodBase;
}
export function woodMaterial(own) {
  const base = woodShared();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  patchUnder(m, {
    key: 'wood2', uniforms: { ...base.uni, ...own },
    vhead: 'varying vec2 vWUv;',
    vertex: 'vWUv = uv;',
    fhead: WOOD_HEAD,
    map: `
      vec2 wuv = vWUv * (uScale / ${TILE_M.toFixed(3)});
      vec4 wt = texture2D(tMap, wuv);
      float wl = dot(wt.rgb, vec3(0.3, 0.59, 0.11));
      float wa = dot(texture2D(tMap, wuv, 4.0).rgb, vec3(0.3, 0.59, 0.11));
      float wCav = smoothstep(-0.12, 0.08, wl - wa);
      vec3 wc = wt.rgb * mix(0.5, 1.08, wCav) * uTint;
      vec3 wP = vAqO * uScale;
      wc = aqWeather(wc, wP, aqUpness(aqObjToView(normalize(vAqN))), 1.0 - smoothstep(0.004, 0.03, wP.y), 0.3, uSeed);
      diffuseColor.rgb *= wc;`,
    rough: `float roughnessFactor = roughness * mix(1.12, 0.7, wCav * smoothstep(0.25, 0.7, wl));`,
    normal: `
      {
        vec3 tn = texture2D(tNor, wuv).xyz * 2.0 - 1.0;
        tn.xy *= 1.6;
        normal = normalize(cotangentFrame(normal, -vViewPosition, wuv) * tn);
      }`,
    extra: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uHiCol * uHi;'); },
  });
  m.userData.uni = { ...base.uni, ...own };
  return m;
}

const geoCache = new Map();
export function makeWood(def, item) {
  const key = def.shape + ':' + item.seed;
  let g = geoCache.get(key);
  if (!g) { g = woodGeometry(def.shape, item.seed); geoCache.set(key, g); }
  const own = { uHi: { value: 0 }, uHiCol: { value: new THREE.Vector3(0.05, 0.12, 0.09) }, uScale: { value: item.size || 0.26 }, uSeed: { value: (item.seed % 991) * 0.41 } };
  const mesh = new THREE.Mesh(g, woodMaterial(own));
  mesh.onBeforeRender = function () { own.uScale.value = this.matrixWorld.getMaxScaleOnAxis(); };
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.layers.enable(1);
  return mesh;
}
