// 流畅魚（1メッシュ・1マテリアル・頂点シェーダーで泳ぐ glb）の読み込みと泳ぎシェーダー
// glb の中身: 頂点属性 _FIN = (部位, 重み, 畳む角度), _PIV = 旋转の中心（Blender の Z 上向き座標のまま）
//              胸鰭・腹鰭 → 付け根, 背鰭・臀鰭・尾鰭 → その頂点が乗る鰭条の根元, 眼 → 眼球の中心（0 なら動かさない）
//            ノードの extras.swim = { snout, length, lambda, freq, amp, env:[c0,c1,c2], flat, pect_rest(胸鰭が体に沿う角度) }
// 部位: 0 胴, 1 背鰭など正中の鰭, 2 臀鰭, 3 尾鰭, 4 胸鰭, 5 腹鰭, 6 眼, 7 鰓蓋
// 1匹ごとの状態（FishMotion が毎フレーム作る）:
//   swim = (尾の位相[周期], 尾の振幅倍率, 体のしなり[1/m], 胸鰭の開き[rad])
//   fin  = (胸鰭の羽ばたき位相[周期], 羽ばたきの振れ[rad], 背鰭・臀鰭の立ち 0..1, 腹鰭の開き 0..1)
//   インスタンス描画では属性 aSwim / aFin、1匹だけの Mesh では uniform uSwim / uFin
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// pectSwim: how much the species swims slowly with its pectoral fins (labriform) instead of the tail
export const FISH = [
  { id: 'madai_lite', label: '真鲷', file: 'madai_lite.glb', cm: 50, pectSwim: 1 },
  { id: 'isaki', label: '鸡鱼', file: 'isaki.glb', cm: 35, pectSwim: 0.9 },
  { id: 'tachiuo', label: '带鱼', file: 'tachiuo.glb', cm: 100, pectSwim: 0 },
  { id: 'suzuki', label: '海鲈', file: 'suzuki.glb', cm: 60, pectSwim: 0.6 },
  { id: 'hirame', label: '牙鲆', file: 'hirame.glb', cm: 60, pectSwim: 0 },
  { id: 'kamasu', label: '梭鱼', file: 'kamasu.glb', cm: 35, pectSwim: 0.2 },
  { id: 'buri', label: '鰤鱼', file: 'buri.glb', cm: 80, pectSwim: 0.15 },
  { id: 'aji', label: '竹荚鱼', file: 'aji.glb', cm: 25, pectSwim: 0.5 },
  { id: 'saba', label: '鲭鱼', file: 'saba.glb', cm: 35, pectSwim: 0.15 },
];

const SWIM_HEAD = /* glsl */`
uniform float uTime, uSnout, uLen, uLam, uBreath, uSwimAmp, uPectRest, uLookAt;
uniform vec3 uEnv;
attribute vec3 _fin;
attribute vec3 _piv;
#ifdef USE_INSTANCING
attribute vec4 aSwim;
attribute vec4 aFin;
#else
uniform vec4 uSwim, uFin;
#endif
// travelling body wave; envelope A(s) = c0 + c1 s + c2 s^2 (s = 0 snout .. 1 tail tip); cyc in beat cycles
float fishH(float s, float cyc, float amp) {
  float A = uEnv.x + uEnv.y * s + uEnv.z * s * s;
  return uLen * amp * A * sin(6.2831853 * (s / uLam - cyc));
}
mat3 rotAxis(vec3 a, float t) {             // rotation by t about the unit axis a (right-handed)
  float c = cos(t), s = sin(t), k = 1.0 - c;
  return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
              a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
              a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}
float fishHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
// eye saccades: hold a random gaze, then jump to the next one in ~80 ms; each eye keeps its own rhythm
vec2 eyeGaze(float id) {
  float T = 0.8 + 1.6 * fishHash(id);
  float k = uTime / T + fishHash(id + 1.0) * 7.0, seg = floor(k);
  vec2 g0 = vec2(fishHash(seg * 1.7 + id), fishHash(seg * 2.3 + id + 11.0));
  vec2 g1 = vec2(fishHash(seg * 1.7 - 1.7 + id), fishHash(seg * 2.3 - 2.3 + id + 11.0));
  return mix(g1, g0, smoothstep(0.0, 0.08 / T, fract(k))) - 0.5;
}
`;
const SWIM_BODY = /* glsl */`
#ifdef USE_INSTANCING
vec4 sw = aSwim, fs4 = aFin; float seed = float(gl_InstanceID);
#else
vec4 sw = uSwim, fs4 = uFin; float seed = 0.0;
#endif
float cyc = sw.x, amp = sw.y * uSwimAmp, bend = sw.z;
vec3 fishP = position;
vec3 objectNormal = normal;
float part = floor(_fin.x + 0.5);
float fw = _fin.y;
vec3 piv = vec3(_piv.x, _piv.z, -_piv.y);   // custom attributes stay Blender Z-up
bool hasPiv = dot(_piv, _piv) > 1e-10;
mat3 R = mat3(1.0);
if (part == 4.0) {
  // pectorals: sw.w = how far they stand off the flank (0 = flush); a flap swings them out and back about the (near vertical)
  // fin base; the outer rays lag the base a little, like a flexible fin
  float sd = sign(piv.z);
  float ang = uPectRest + sw.w + fs4.y * (0.5 - 0.5 * cos(6.2831853 * fs4.x - fw * 0.9));
  R = rotAxis(normalize(vec3(0.2, 1.0, 0.0)), sd * fw * ang);
} else if (part == 5.0) {
  // pelvics: pressed to the belly when closed, spread out and forward when braking / hovering
  float sd = sign(piv.z);
  float ang = mix(-0.12, 0.55, fs4.w) + 0.04 * sin(4.4 * uTime + seed);
  R = rotAxis(vec3(1.0, 0.0, 0.0), -sd * fw * ang);
} else if ((part == 1.0 || part == 2.0) && hasPiv) {
  // dorsal / anal: every ray folds back about its own base, like a fan, until it lies along the body
  R = rotAxis(vec3(0.0, 0.0, 1.0), _fin.z * (1.0 - fs4.z));
} else if (part == 3.0 && hasPiv) {
  // tail: the lobes close a little while the tail is still (gliding) and spread while it beats
  R = rotAxis(vec3(0.0, 0.0, 1.0), _fin.z * 0.22 * (1.0 - clamp(amp * 1.5, 0.0, 1.0)));
} else if (part == 6.0 && hasPiv) {
  // eyes: independent saccades + both eyes glance into a turn; with uLookAt the eye that can see the camera
  // turns to look straight into it (small saccades stay on top so it doesn't stare like glass)
  float sd = sign(piv.z);
  vec2 g = eyeGaze(seed * 7.13 + (sd > 0.0 ? 0.0 : 3.7));
  float fwd = g.x * 0.6, up = g.y * 0.3, lw = 0.0;
  if (uLookAt > 0.0) {
    mat4 M = modelMatrix;
    #ifdef USE_INSTANCING
    M = modelMatrix * instanceMatrix;
    #endif
    vec3 d = (inverse(M) * vec4(cameraPosition, 1.0)).xyz - piv;    // camera in fish space, from the eye
    float side = d.z * sd, hz = length(vec2(d.x, side));
    // only the eye on the camera's side looks; fade out as the camera passes in front / behind the head
    lw = uLookAt * smoothstep(0.0, 0.35, side / max(length(d), 1e-4));
    fwd = mix(fwd, clamp(atan(d.x, side), -0.65, 0.65) + g.x * 0.12, lw);
    up = mix(up, clamp(atan(d.y, hz), -0.45, 0.45) + g.y * 0.06, lw);
  }
  float yaw = sd * fwd + clamp(bend * uLen, -1.0, 1.0) * 0.3 * (1.0 - lw);
  R = rotAxis(vec3(0.0, 1.0, 0.0), yaw) * rotAxis(vec3(1.0, 0.0, 0.0), -sd * up);
} else if (part == 7.0) {
  fishP.z += sign(fishP.z) * fw * uBreath * (0.5 + 0.5 * sin(4.712 * uTime + seed));
}
if (part >= 1.0 && part <= 6.0) { fishP = piv + R * (fishP - piv); objectNormal = R * objectNormal; }
float fs = (uSnout - fishP.x) / uLen;
float fd = (fishH(fs + 0.002, cyc, amp) - fishH(fs - 0.002, cyc, amp)) / 0.004 * (-1.0 / uLen);
// turning: the whole body curves into an arc around its centre of mass (~35% back from the snout)
float bx = (fs - 0.35) * uLen;
fishP.z += fishH(fs, cyc, amp) + 0.5 * bend * bx * bx;
fd += bend * bx * (-1.0);
objectNormal = normalize(vec3(objectNormal.x - fd * objectNormal.z, objectNormal.y, objectNormal.z));
`;

function makeUniforms(swim) {
  const env = swim.env || [0.02, -0.08, 0.16];
  return {
    uTime: { value: 0 }, uSnout: { value: swim.snout }, uLen: { value: swim.length }, uLam: { value: swim.lambda },
    uSwimAmp: { value: swim.amp }, uEnv: { value: new THREE.Vector3(...env) }, uBreath: { value: 0.004 * swim.length }, uPectRest: { value: swim.pect_rest ?? 0 }, uLookAt: { value: 1 },
    uSwim: { value: new THREE.Vector4(0, 1, 0, 0.1) }, uFin: { value: new THREE.Vector4(0, 0, 0.3, 0.2) },
  };
}
/** Standard material + swimming vertex shader. extra(sh) may patch the shader further (fog, caustics...). */
export function makeSwimMaterial(map, swim, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: opts.roughness ?? 0.4, metalness: 0,
                                             side: THREE.DoubleSide, alphaToCoverage: true });
  if (opts.normalMap) setNormalMap(m, opts.normalMap, opts.normalScale ?? 1);
  const u = makeUniforms(swim);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SWIM_HEAD)
      .replace('#include <beginnormal_vertex>', SWIM_BODY)
      .replace('#include <begin_vertex>', 'vec3 transformed = fishP;');
    opts.extra?.(sh);
  };
  m.customProgramCacheKey = () => 'swim' + (opts.key || '');
  m.userData.u = u;
  return m;
}

/** Tangent-space normal map (OpenGL / +Y up, same layout as the atlas). The glb UVs run top-down (flipY false),
 *  so the green axis is negated like GLTFLoader does for meshes without tangents. */
export function setNormalMap(m, tex, strength = 1) {
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  m.normalMap = tex;
  m.normalScale.set(strength, -strength);
  m.needsUpdate = true;
}

/** Depth material for shadows that bends exactly like the swimming body and cuts the fins by alpha. */
export function makeSwimDepthMaterial(map, u) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SWIM_HEAD)
      .replace('#include <begin_vertex>', SWIM_BODY + '\nvec3 transformed = fishP;');
  };
  m.customProgramCacheKey = () => 'swimdepth';
  return m;
}

const loader = new GLTFLoader();
const cache = new Map();
/** -> { geometry, material, depthMaterial, swim, bytes, tex:'w×h', tris } (clone geometry to add instancing) */
export async function loadFish(url, opts = {}) {
  const key = url + (opts.key || '');
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const response = await fetch(url + '.b64.txt');
    if (!response.ok) throw new Error(`Fish model load failed: ${response.status}`);
    const s = atob((await response.text()).trim());
    const buf = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i);
    const gltf = await loader.parseAsync(buf.buffer, url.replace(/[^/]*$/, ''));
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    const swim = mesh.userData.swim;
    const map = mesh.material.map;
    map.anisotropy = 4;
    const material = makeSwimMaterial(map, swim, opts);
    const depthMaterial = makeSwimDepthMaterial(map, material.userData.u);
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    return { geometry: g, material, depthMaterial, swim, bytes: buf.byteLength, tex: `${map.image.width}×${map.image.height}`, tris };
  })();
  cache.set(key, p);
  try { return await p; }
  catch (error) { if (cache.get(key) === p) cache.delete(key); throw error; }
}

/** Per-instance swim + fin state attributes for n instances: geometry.setAttribute('aSwim'/'aFin', ...). */
export function swimAttributes(n) {
  const mk = (init) => {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) a.set(init, i * 4);
    const attr = new THREE.InstancedBufferAttribute(a, 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
  };
  return { swim: mk([0, 1, 0, 0.1]), fin: mk([0, 0, 0.3, 0.2]) };
}

// ---------- behaviour: how a fish moves its body, fins and when ----------
// Targets per gait (speeds in body lengths / s). tail = [freq x species freq, amplitude]; pect = [rest open rad,
// flap amp rad, flap Hz]; dorsal / pelvic 0 = folded / closed .. 1 = raised / spread.
const GAITS = {
  hover:  { speed: 0.05, tail: [0.45, 0.10], pect: [0.22, 0.30, 1.6], dorsal: 0.75, pelvic: 0.8 },
  slow:   { speed: 0.5,  tail: [0.55, 0.12], pect: [0.06, 0.6, 2.2], dorsal: 0.15, pelvic: 0.15 },
  cruise: { speed: 1.5,  tail: [1.25, 0.85], pect: [0.03, 0, 2], dorsal: 0.0, pelvic: 0.0 },
  kick:   { speed: 2.5,  tail: [2.2, 1.35],  pect: [0.02, 0, 2], dorsal: 0.0, pelvic: 0.0 },
  glide:  { speed: 1.2,  tail: [0.3, 0.0],   pect: [0.04, 0, 2], dorsal: 0.0, pelvic: 0.0 },
  brake:  { speed: 0.2,  tail: [0.6, 0.25],  pect: [0.95, 0.15, 1.5], dorsal: 1.0, pelvic: 1.0 },
  turn:   { speed: 0.8,  tail: [1.6, 0.9],   pect: [0.35, 0.2, 2], dorsal: 0.9, pelvic: 0.7 },
};
export const GAIT_LABELS = { hover: '悬停', slow: '胸鳍划水', cruise: '尾鳍巡游', kick: '尾鳍加速', glide: '滑行',
                             brake: '制动（展开鱼鳍）', turn: '转向' };
export const MODES = { auto: '自动', hover: '悬停', slow: '慢游（胸鳍）', cruise: '巡游（尾鳍）',
                       burst: '冲刺→滑行', turn: '转向与制动' };

/** Drives one fish: pick a gait from the mode (auto = a natural mix), ease every value toward it and integrate
 *  the beat phases. write() / apply() hand the result to the shader. speed (body lengths / s) moves the fish. */
export class FishMotion {
  constructor(swim, { pectSwim = 0.5, mode = 'auto', seed = Math.random() } = {}) {
    this.swim = swim; this.pectSwim = pectSwim; this.mode = mode;
    let r = (seed * 2 ** 31) | 0 || 1;
    this.rnd = () => ((r = (r * 16807) % 2147483647) & 0x7fffffff) / 2147483647;
    this.tail = this.rnd() * 4; this.flap = this.rnd(); this.amp = 0.3; this.freq = 1; this.bend = 0;
    this.open = 0.1; this.flapAmp = 0; this.flapHz = 2; this.dorsal = 0.3; this.pelvic = 0.2; this.speed = 0.5;
    this.gait = 'slow'; this.timer = 0; this.plan = []; this.turnDir = 1; this.wander = this.rnd() * 10;
  }
  setMode(m) { this.mode = m; this.plan = []; this.timer = 0; }
  // a mode is a looping plan of [gait, seconds, turn direction]
  _plan() {
    const r = this.rnd, beat = 1 / this.swim.freq;
    switch (this.mode) {
      case 'hover': return [['hover', 4 + r() * 3]];
      case 'slow': return [['slow', 5 + r() * 4]];
      case 'cruise': return [['cruise', 5 + r() * 4]];
      case 'burst': return [['kick', beat / 2.2 * (2 + Math.floor(r() * 3))], ['glide', 1.2 + r() * 1.2]];
      case 'turn': { const d = r() < 0.5 ? -1 : 1;
        return [['slow', 1.5 + r()], ['brake', 0.7], ['turn', 0.9, d], ['glide', 0.8], ['slow', 1.5 + r()]]; }
      default: {                                  // auto: mostly pectoral cruising, with pauses, bursts and turns
        const k = r(), d = r() < 0.5 ? -1 : 1;
        if (k < 0.3) return [['slow', 4 + r() * 4]];
        if (k < 0.45) return [['brake', 0.6], ['hover', 2 + r() * 3]];
        if (k < 0.7) return [['kick', beat / 2.2 * 3], ['glide', 1.4 + r()], ['kick', beat / 2.2 * 2], ['glide', 1.5 + r()]];
        if (k < 0.85) return [['brake', 0.5], ['turn', 0.9, d], ['glide', 1.0]];
        return [['cruise', 3 + r() * 3]];
      }
    }
  }
  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      if (!this.plan.length) this.plan = this._plan();
      const [g, sec, dir] = this.plan.shift();
      this.gait = g; this.timer = sec; this.turnDir = dir ?? 0;
    }
    const G = GAITS[this.gait], ps = this.pectSwim;
    const ease = (v, t, rate) => v + (t - v) * Math.min(1, dt * rate);
    // a fish that does not row with its pectorals swims slowly with small tail beats instead
    const slowTail = this.gait === 'slow' || this.gait === 'hover';
    const tailAmp = G.tail[1] + (slowTail ? (1 - ps) * 0.55 : 0);
    const flapAmp = G.pect[1] * (this.gait === 'slow' ? ps : Math.max(ps, 0.4));
    this.amp = ease(this.amp, tailAmp, this.gait === 'glide' ? 2.5 : 5);
    this.freq = ease(this.freq, G.tail[0], 4);
    this.open = ease(this.open, G.pect[0], 5);
    this.flapAmp = ease(this.flapAmp, flapAmp, 3);
    this.flapHz = ease(this.flapHz, G.pect[2], 3);
    this.dorsal = ease(this.dorsal, G.dorsal, G.dorsal > this.dorsal ? 7 : 2);   // raised fast, folded slowly
    this.pelvic = ease(this.pelvic, G.pelvic, 4);
    this.speed = ease(this.speed, G.speed, this.gait === 'glide' ? 0.8 : 2);
    this.wander += dt * 0.3;
    const bendT = this.turnDir * 0.7 / this.swim.length + Math.sin(this.wander) * 0.08 / this.swim.length;
    this.bend = ease(this.bend, bendT, 4);
    this.tail += this.swim.freq * this.freq * dt;
    this.flap += this.flapHz * dt;
    return this;
  }
  /** Copy the state into instance i of swimAttributes(). */
  write(attrs, i) {
    attrs.swim.setXYZW(i, this.tail, this.amp, this.bend, this.open);
    attrs.fin.setXYZW(i, this.flap, this.flapAmp, this.dorsal, this.pelvic);
  }
  /** Copy the state into a (non-instanced) swim material. */
  apply(material) {
    const u = material.userData.u;
    u.uSwim.value.set(this.tail, this.amp, this.bend, this.open);
    u.uFin.value.set(this.flap, this.flapAmp, this.dorsal, this.pelvic);
  }
}

/** Orientation for an instance heading along `yaw` (radians about +Y). Flatfish lie on their blind side. */
const _q = new THREE.Quaternion(), _qf = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _up = new THREE.Vector3(0, 1, 0);
export function fishQuat(yaw, flat, out = new THREE.Quaternion(), pitch = 0, roll = 0) {
  out.setFromAxisAngle(_up, yaw);
  if (pitch || roll) out.multiply(_q.setFromEuler(new THREE.Euler(roll, 0, pitch)));
  if (flat) out.multiply(_qf);
  return out;
}
