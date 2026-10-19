// Procedural aquascaping stones: a displaced, faceted sphere per stone type (seiryu = sharp ridges + vertical
// fluting + planar cuts, ryuoh = lumpy with holes, lava = porous rounded, kasei = layered column), flat buried base,
// concavity AO in vertex colours, photo texture triplanar in object space. Origin = centre of the base.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchUnder, TRIPLANAR_GLSL, NATURE_GLSL, rng, makeNoise } from './shaders.js';
import { surfaceTex, onTex } from './textures.js';

const SHAPES = {
  seiryu: { aspect: [[0.75, 1.1], [0.9, 1.55], [0.55, 0.8]], fbm: 0.16, ridge: 0.14, flute: 0.06, cuts: [4, 8], cutK: 0.9, holes: 0, layer: 0 },
  ryuoh: { aspect: [[0.9, 1.15], [0.65, 1.05], [0.75, 0.95]], fbm: 0.26, ridge: 0.08, flute: 0, cuts: [1, 3], cutK: 0.5, holes: 0.2, layer: 0, bumps: 0.03, pores: 0.03 },
  lava: { aspect: [[0.85, 1.1], [0.6, 0.95], [0.75, 0.95]], fbm: 0.26, ridge: 0.12, flute: 0, cuts: [1, 3], cutK: 0.5, holes: 0.12, layer: 0, bumps: 0.06, pores: 0.05 },
  kasei: { aspect: [[0.5, 0.75], [1.2, 1.8], [0.45, 0.65]], fbm: 0.1, ridge: 0.02, flute: 0, cuts: [2, 4], cutK: 0.95, holes: 0, layer: 0.09 },
};
const TEX_SCALE = { seiryu: 4.5, ryuoh: 4, lava: 5, kasei: 4 };

/** Unit-ish stone geometry (largest horizontal extent = 1) for a stone type and seed. */
export function stoneGeometry(shape, seed, detail = 5) {
  const S = SHAPES[shape] || SHAPES.seiryu;
  const r = rng(seed * 31 + 7), noise = makeNoise(seed + 11), noise2 = makeNoise(seed + 97);
  const lerp = (a, b) => a + (b - a) * r();
  const ax = lerp(...S.aspect[0]), ay = lerp(...S.aspect[1]), az = lerp(...S.aspect[2]);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const P = g.attributes.position;
  // planar cuts: random planes that shave the stone into facets (normals biased to the sides and the top)
  const cuts = [];
  const nCuts = Math.round(lerp(S.cuts[0], S.cuts[1] + 0.99));
  for (let i = 0; i < nCuts; i++) {
    const th = r() * Math.PI * 2, el = (r() - 0.35) * 1.2;
    cuts.push({ n: new THREE.Vector3(Math.cos(th) * Math.cos(el), Math.sin(el), Math.sin(th) * Math.cos(el)), c: lerp(0.5, 0.82) });
  }
  // a lean: stones look better slightly tilted along their long axis
  const lean = (r() - 0.5) * 0.5, flutePh = r() * 10, fluteK = 7 + r() * 6;
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  const holeCenters = Array.from({ length: 9 }, () => new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize());
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const dir = v.clone();
    let d = 1;
    const f = (x, y, z, o) => noise(x * o, y * o, z * o);
    d += S.fbm * (f(v.x, v.y, v.z, 1.3) + 0.5 * f(v.x, v.y, v.z, 2.7) + 0.25 * f(v.x, v.y, v.z, 5.5));
    if (S.ridge) { const rr = 1 - Math.abs(noise2(v.x * 3.1, v.y * 2.2, v.z * 3.1)); d += S.ridge * (rr * rr - 0.4); }
    if (S.flute) {
      // vertical grooves of seiryu: sharp valleys running down the faces
      const a = Math.atan2(v.z, v.x) * fluteK + noise(v.x * 2, v.y * 1.2, v.z * 2) * 3 + flutePh;
      d -= S.flute * Math.pow(Math.abs(Math.sin(a)), 6) * (0.6 + 0.4 * v.y);
    }
    if (S.holes) {
      for (const h of holeCenters) {
        const k = 1 - dir.distanceTo(h) / 0.42;
        if (k > 0) d -= S.holes * k * k * (0.6 + 0.4 * noise(v.x * 6, v.y * 6, v.z * 6));
      }
      d -= S.holes * 0.5 * Math.max(0, noise2(v.x * 7, v.y * 7, v.z * 7) - 0.25);
    }
    if (S.bumps) d += S.bumps * (noise2(v.x * 11, v.y * 11, v.z * 11) + 0.5 * noise(v.x * 23, v.y * 23, v.z * 23));
    if (S.pores) { const pn = noise2(v.x * 17 + 3, v.y * 17, v.z * 17); d -= S.pores * Math.max(0, pn - 0.35) * 3; }
    if (S.layer) d += S.layer * noise(v.x * 9, v.y * 0.9, v.z * 9) + S.layer * 0.4 * Math.sin(v.y * 22 + noise(v.x * 3, v.y, v.z * 3) * 2);
    v.multiplyScalar(d);
    v.set(v.x * ax, v.y * ay, v.z * az);
    for (const c of cuts) {
      const s = c.n.x * v.x / ax + c.n.y * v.y / ay + c.n.z * v.z / az;
      if (s > c.c) v.addScaledVector(q.set(c.n.x * ax, c.n.y * ay, c.n.z * az), -(s - c.c) * S.cutK);
    }
    // lean
    const x = v.x, y = v.y;
    v.x = x * Math.cos(lean) - y * Math.sin(lean); v.y = x * Math.sin(lean) + y * Math.cos(lean);
    P.setXYZ(i, v.x, v.y, v.z);
  }
  // flat base: squash everything below the base level (the stone is half sunk into the soil anyway)
  g.computeBoundingBox();
  const bb = g.boundingBox, base = bb.min.y + (bb.max.y - bb.min.y) * 0.22;
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i);
    if (y < base) P.setY(i, base - (base - y) * 0.12);
  }
  g.computeBoundingBox();
  const b2 = g.boundingBox;
  const cx = (b2.min.x + b2.max.x) / 2, cz = (b2.min.z + b2.max.z) / 2;
  const s = 1 / Math.max(b2.max.x - b2.min.x, b2.max.z - b2.min.z);
  for (let i = 0; i < P.count; i++) P.setXYZ(i, (P.getX(i) - cx) * s, (P.getY(i) - b2.min.y) * s, (P.getZ(i) - cz) * s);
  g.computeVertexNormals();
  // concavity AO: vertices that sit below the average of their neighbours (along the normal) are crevices
  const idx = g.index.array, n = P.count;
  const sum = new Float32Array(n * 3), cnt = new Uint16Array(n);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3];
    sum[a * 3] += P.getX(b); sum[a * 3 + 1] += P.getY(b); sum[a * 3 + 2] += P.getZ(b); cnt[a]++;
  }
  const N = g.attributes.normal, col = new Float32Array(n * 3);
  const edge = 2.4 / Math.pow(2, detail) / 1.0;
  for (let i = 0; i < n; i++) {
    const c = cnt[i] || 1;
    const dx = sum[i * 3] / c - P.getX(i), dy = sum[i * 3 + 1] / c - P.getY(i), dz = sum[i * 3 + 2] / c - P.getZ(i);
    const conc = (dx * N.getX(i) + dy * N.getY(i) + dz * N.getZ(i)) / (edge * 0.12);
    let ao = THREE.MathUtils.clamp(1 - conc * 0.55, 0.35, 1.08);
    ao *= 0.72 + 0.28 * THREE.MathUtils.smoothstep(P.getY(i), 0.0, 0.15);     // darker near the soil
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  // smooth the AO once
  const col2 = col.slice();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3];
    col2[a * 3] += col[b * 3] * 0.5;
  }
  for (let i = 0; i < n; i++) { const c = col2[i * 3] / (1 + 0.5 * (cnt[i] || 1)); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingBox();            // after the normalisation above (the earlier box is in raw units)
  g.computeBoundingSphere();
  g.userData.volume = meshVolume(g);
  return g;
}

export function meshVolume(g) {
  const P = g.attributes.position, idx = g.index.array;
  let v = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(P, idx[t]); b.fromBufferAttribute(P, idx[t + 1]); c.fromBufferAttribute(P, idx[t + 2]);
    v += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(v);
}

const materials = new Map();
// photo tiles per metre (a tile covers ~15 cm of real stone), biofilm amount, overall tone
const LOOK = { seiryu: [6.5, 0.22, 0.9], ryuoh: [5.5, 0.28, 0.95], lava: [7, 0.18, 0.95], kasei: [5.5, 0.2, 0.9] };
export function stoneMaterial(def) {
  if (materials.has(def.id)) return materials.get(def.id);
  const [ts, bio, tone] = LOOK[def.shape] || LOOK.seiryu;
  const uni = { tMap: { value: null }, tNor: { value: null }, uTS: { value: ts }, uBio: { value: bio }, uTone: { value: tone } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  patchUnder(m, {
    key: 'stone', uniforms: uni,
    fhead: TRIPLANAR_GLSL + NATURE_GLSL + `uniform sampler2D tMap, tNor; uniform float uTS, uBio, uTone, uHi, uScale, uSeed; uniform vec3 uHiCol;`,
    map: `
      vec3 oN = normalize(vAqN);
      vec3 sP = vAqO * uScale;                         // object space in metres: texture scale independent of the stone size
      vec4 tc = triTex(tMap, sP, oN, uTS);
      float sLum = dot(tc.rgb, vec3(0.3, 0.59, 0.11));
      float sAvg = dot(triTexB(tMap, sP, oN, uTS, 4.0).rgb, vec3(0.3, 0.59, 0.11));
      float sCav = smoothstep(-0.14, 0.08, sLum - sAvg);                       // darker than the neighbourhood = crevice
      vec3 sc = tc.rgb * mix(0.55, 1.08, sCav);
      float sUp = aqUpness(aqObjToView(oN));
      sc = aqWeather(sc, sP, sUp, 1.0 - smoothstep(0.004, 0.035, sP.y), uBio, uSeed);
      diffuseColor.rgb *= sc * uTone;`,
    rough: `
      // polished ridges catch the light, crevices stay matt
      float roughnessFactor = roughness * mix(1.15, 0.72, smoothstep(0.2, 0.9, sCav * sLum * 1.6));`,
    normal: `
      {
        vec3 on = triNormal(tNor, sP, oN, uTS, 1.5);
        on = normalize(on + triNormal(tNor, sP, on, uTS * 3.7, 0.9) - on * 0.98);
        normal = aqObjToView(on);
      }`,
    extra: (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uHiCol * uHi;'); },
  });
  onTex(surfaceTex(def.tex, def.tint), (t) => { uni.tMap.value = t.map; uni.tNor.value = t.normal; });
  m.userData.uni = uni;
  materials.set(def.id, m);
  return m;
}

const geoCache = new Map();
/** A stone mesh: item = { type, seed, size }. Per-mesh material clone (shares textures + program) so the highlight,
 *  the metric texture scale and the weathering pattern are per stone. */
export function makeStone(def, item) {
  const key = def.shape + ':' + item.seed;
  let g = geoCache.get(key);
  if (!g) { g = stoneGeometry(def.shape, item.seed, 6); geoCache.set(key, g); }
  const base = stoneMaterial(def);
  const mat = base.clone();
  const own = { uHi: { value: 0 }, uHiCol: { value: new THREE.Vector3(0.05, 0.12, 0.09) }, uScale: { value: item.size || 0.1 }, uSeed: { value: (item.seed % 997) * 0.37 } };
  mat.userData.uni = { ...base.userData.uni, ...own };
  mat.onBeforeCompile = (sh, r) => { base.onBeforeCompile(sh, r); Object.assign(sh.uniforms, own); };
  mat.customProgramCacheKey = base.customProgramCacheKey;
  const mesh = new THREE.Mesh(g, mat);
  mesh.onBeforeRender = function () { own.uScale.value = this.matrixWorld.getMaxScaleOnAxis(); };
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.layers.enable(1);
  return mesh;
}
