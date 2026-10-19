// Shared uniforms + shader patches for everything inside the tank (caustics on the direct light, gentle sway).
import * as THREE from 'three';

// U is shared by reference with every patched material and with the water / post passes
export const U = {
  uTime: { value: 0 },
  uWaterY: { value: 0.3 },
  uLightDir: { value: new THREE.Vector3(0.12, -1, 0.18).normalize() },   // from the lamp toward the tank
  uCaustic: { value: 1.0 },          // caustic strength (0 = off)
  uCauScale: { value: 1.0 },         // caustic cell size multiplier
  uFlow: { value: 1.0 },             // filter current strength (plant sway)
  uTankMin: { value: new THREE.Vector3(-0.3, 0, -0.15) },
  uTankMax: { value: new THREE.Vector3(0.3, 0.3, 0.15) },
  // what hangs over each point of the tank floor (plants, wood, stones, carpets): R = how much of the room / sky
  // light it takes away, G = its top height / water height. Ambient light under a bush is dimmer (layout.js fills it)
  tCanopy: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })() },
  uCanopyRect: { value: new THREE.Vector4(-0.3, -0.15, 0.6, 0.3) },
};

// Animated caustic net (after joltz0r's "water turbulence" iteration) evaluated where the lamp ray through this
// point crossed the water surface; RGB sampled at slightly different depths for a hint of dispersion.
export const CAUSTIC_GLSL = /* glsl */`
float aqCauNet(vec2 p, float t) {
  vec2 i = p; float c = 1.0; const float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 7.0);
}
vec3 aqCaustic(vec3 w) {
  float depth = max(uWaterY - w.y, 0.0);
  vec2 s = w.xz - uLightDir.xz / max(-uLightDir.y, 0.2) * depth;
  float k = 6.2831853 / (0.11 * uCauScale);
  float t = uTime * 0.55;
  vec2 p = s * k;
  float disp = 0.02 + depth * 0.25;
  vec3 c = vec3(aqCauNet(p + vec2(disp, 0.0), t), aqCauNet(p, t), aqCauNet(p - vec2(disp, 0.0), t));
  // a second, larger and slower net breaks up the regular look
  c += 0.6 * aqCauNet(p * 0.47 + 3.1, t * 0.7 + 1.3);
  float soft = mix(1.0, 0.55, smoothstep(0.0, 0.5, depth));
  c = clamp(c, 0.0, 3.0) * soft;
  float under = step(w.y, uWaterY);
  return mix(vec3(1.0), vec3(0.32) + c * 1.75, uCaustic * under);
}
`;

const HEAD_V = /* glsl */`
uniform float uWaterY, uFlow;
varying vec3 vAqW;
varying vec3 vAqO;
varying vec3 vAqN;
varying vec3 vAqX, vAqY, vAqZ;
`;
const HEAD_F = /* glsl */`
uniform float uTime, uWaterY, uCaustic, uCauScale;
uniform vec3 uLightDir;
varying vec3 vAqW;
varying vec3 vAqO;
varying vec3 vAqN;
varying vec3 vAqX, vAqY, vAqZ;
vec3 aqObjToView(vec3 n) { return normalize(vAqX * n.x + vAqY * n.y + vAqZ * n.z); }
uniform sampler2D tCanopy; uniform vec4 uCanopyRect;
// room / sky light left at this point after whatever grows above it
float aqCanopy(vec3 w) {
  vec4 c = texture2D(tCanopy, (w.xz - uCanopyRect.xy) / uCanopyRect.zw);
  float top = c.g * uWaterY;
  return 1.0 - c.r * 0.8 * clamp((top - w.y) / 0.06 + 0.15, 0.0, 1.0);
}
` + CAUSTIC_GLSL;

/**
 * Patch a MeshStandardMaterial for life under water.
 * opts.vertex(sh)  : extra vertex code (string) placed before project (may edit `transformed`)
 * opts.fragment    : { head, map, normal } snippets to replace map / normal fragments (triplanar etc.)
 * opts.uniforms    : extra uniforms
 */
export function patchUnder(m, opts = {}) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, U, opts.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + HEAD_V + (opts.noTime ? '' : 'uniform float uTime;\n') + (opts.vhead || ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAqO = position; vAqN = normal;\n' + (opts.vertex || ''))
      .replace('#include <project_vertex>', `
        vec4 aqW = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
        aqW = batchingMatrix * aqW;
        #endif
        #ifdef USE_INSTANCING
        aqW = instanceMatrix * aqW;
        #endif
        vAqW = (modelMatrix * aqW).xyz;
        {
          mat3 aqM = normalMatrix;
          #ifdef USE_BATCHING
          aqM = normalMatrix * mat3(batchingMatrix);
          #endif
          #ifdef USE_INSTANCING
          aqM = normalMatrix * mat3(instanceMatrix);
          #endif
          vAqX = aqM * vec3(1.0, 0.0, 0.0); vAqY = aqM * vec3(0.0, 1.0, 0.0); vAqZ = aqM * vec3(0.0, 0.0, 1.0);
        }
        #include <project_vertex>`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HEAD_F + (opts.fhead || ''))
      .replace('#include <lights_fragment_begin>', 'vec3 aqCau = aqCaustic(vAqW);\n#include <lights_fragment_begin>')
      .replace('#include <lights_fragment_end>', '{ float aqOcc = aqCanopy(vAqW); irradiance *= aqOcc; iblIrradiance *= aqOcc; radiance *= mix(1.0, aqOcc, 0.6); }\n#include <lights_fragment_end>')
      .replaceAll('getDirectionalLightInfo( directionalLight, directLight );',
                  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= aqCau;');
    if (opts.map) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', opts.map);
    if (opts.normal) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', opts.normal);
    if (opts.rough) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', opts.rough);
    if (opts.ao) sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', opts.ao);
    if (opts.extra) opts.extra(sh);
  };
  const key = opts.key || 'aq';
  m.customProgramCacheKey = () => key;
  return m;
}

// Triplanar sampling in object (or world) space. p = position, n = normal (same space), s = texels per metre
// Weathering helpers for stones and driftwood that have been under water a while: macro colour blotches (so a
// photo tile never reads as a repeating pattern), crevices darker than their surroundings, a faint olive biofilm on
// the faces that get the light, soil dust on the part that sits in the substrate.
export const NATURE_GLSL = /* glsl */`
float nHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nHash3(i), nHash3(i + vec3(1, 0, 0)), f.x), mix(nHash3(i + vec3(0, 1, 0)), nHash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(nHash3(i + vec3(0, 0, 1)), nHash3(i + vec3(1, 0, 1)), f.x), mix(nHash3(i + vec3(0, 1, 1)), nHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return 0.5 * vnoise3(p) + 0.25 * vnoise3(p * 2.03) + 0.125 * vnoise3(p * 4.01) + 0.0625 * vnoise3(p * 8.05); }
// world-space up-facing amount of a view-space normal
float aqUpness(vec3 nView) { return (vec4(nView, 0.0) * viewMatrix).y; }
vec3 aqWeather(vec3 c, vec3 p, float up, float low, float bio, float seed) {
  float m = fbm3(p * 7.0 + seed);
  c *= mix(0.72, 1.18, m);                                                    // light / dark blotches
  c *= mix(vec3(1.0), vec3(1.06, 0.99, 0.9), smoothstep(0.35, 0.75, fbm3(p * 3.1 + seed + 5.0)));   // warm patches
  float film = bio * smoothstep(0.15, 0.85, up) * (0.45 + 0.55 * fbm3(p * 16.0 + seed));
  c = mix(c, c * vec3(0.72, 0.84, 0.5) + vec3(0.004, 0.008, 0.0), film);
  c = mix(c, c * vec3(0.6, 0.53, 0.46), low * 0.65);
  return c;
}
`;

export const TRIPLANAR_GLSL = /* glsl */`
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec4 triTex(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = triW(n);
  return texture2D(t, p.zy * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
}
// the same with a mip bias: a blurred look at the neighbourhood (crevice detection)
vec4 triTexB(sampler2D t, vec3 p, vec3 n, float s, float b) {
  vec3 w = triW(n);
  return texture2D(t, p.zy * s, b) * w.x + texture2D(t, p.xz * s, b) * w.y + texture2D(t, p.xy * s, b) * w.z;
}
// tangent-space normal maps blended per axis (whiteout), returns a normal in the same space as n
vec3 triNormal(sampler2D t, vec3 p, vec3 n, float s, float k) {
  vec3 w = triW(n);
  vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
  tx.xy *= k; ty.xy *= k; tz.xy *= k;
  vec3 nx = vec3(tx.xy + n.zy, abs(tx.z) * n.x).zyx;
  vec3 ny = vec3(ty.xy + n.xz, abs(ty.z) * n.y).xzy;
  vec3 nz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(nx * w.x + ny * w.y + nz * w.z);
}
`;

// small deterministic RNG
export function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// 3D simplex noise (Gustavson) for CPU-side geometry
const grad3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
export function makeNoise(seed = 1) {
  const r = rng(seed), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const F3 = 1 / 3, G3 = 1 / 6;
  return function (x, y, z) {
    const s = (x + y + z) * F3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3, x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3, x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0, tt, g;
    tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { g = pm12[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (grad3[g] * x0 + grad3[g + 1] * y0 + grad3[g + 2] * z0); }
    tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (grad3[g] * x1 + grad3[g + 1] * y1 + grad3[g + 2] * z1); }
    tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (grad3[g] * x2 + grad3[g + 1] * y2 + grad3[g + 2] * z2); }
    tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (grad3[g] * x3 + grad3[g + 1] * y3 + grad3[g + 2] * z3); }
    return 32 * n;
  };
}
