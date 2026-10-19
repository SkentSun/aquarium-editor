// Frame pipeline:
//   scene (MSAA HDR + depth) -> mirror of the tank interior across the water surface (half res)
//   -> WATER pass: per pixel ray through the water box: absorption, lamp in-scatter marched through the shadow map
//      with caustic modulation (light shafts), the underside of the surface (total internal reflection = mirror),
//      the surface seen from above (lamp reflection + refraction), the meniscus line at the glass
//   -> glass overlay (front faces of the panes) -> bloom -> grade (ACES, colour, vignette, grain)
import * as THREE from 'three';
import { U, CAUSTIC_GLSL } from './shaders.js';

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const WATER_FS = /* glsl */`
#include <packing>
varying vec2 vUv;
uniform sampler2D tScene, tDepth, tMirror, tShadow, tMirrorL, tMirrorR;
uniform mat4 uInvVP, uMirrorVP, uShadowM, uVP, uMirrorLVP, uMirrorRVP;
uniform float uSideOn;
uniform vec3 uCamPos, uBoxMin, uBoxMax, uLampCol, uSigma, uScatCol;
uniform float uTime, uWaterY, uShafts, uMirrorOn, uShadowOn, uCaustic, uCauScale, uLampY, uHaze, uFrame;
uniform vec2 uRes, uLampHalf;
uniform vec3 uLightDir;
${CAUSTIC_GLSL}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// cheap 2-octave version of the caustic net for the light shafts
float cauLite(vec3 w) {
  float depth = max(uWaterY - w.y, 0.0);
  vec2 s = w.xz - uLightDir.xz / max(-uLightDir.y, 0.2) * depth;
  vec2 p = s * 6.2831853 / (0.11 * uCauScale);
  float c = aqCauNet(p, uTime * 0.55) + 0.6 * aqCauNet(p * 0.47 + 3.1, uTime * 0.385 + 1.3);
  return mix(1.0, 0.35 + 1.1 * clamp(c, 0.0, 2.5), uCaustic);
}
float shadowVis(vec3 p) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowM * vec4(p, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0) return 1.0;
  float d = unpackRGBAToDepth(textureLod(tShadow, sc.xy, 0.0));
  return step(sc.z - 0.003, d);
}
// small animated ripples: gradient of a few travelling sines (m^-1)
vec2 ripple(vec2 p) {
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 95.0 + t * 2.1) * 0.6;
  g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 140.0 + t * 2.7) * 0.4;
  g += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 210.0 - t * 3.3) * 0.25;
  g += vec2(0.2, 0.98) * cos(dot(p, vec2(0.2, 0.98)) * 60.0 - t * 1.4) * 0.5;
  return g * 0.02;
}
// dim room + the LED panel above the tank, for reflections on the water surface seen from above
vec3 roomEnv(vec3 o, vec3 r) {
  vec3 c = mix(vec3(0.01), vec3(0.035), smoothstep(-0.2, 0.7, r.y));
  if (r.y > 0.01) {
    float t = (uLampY - o.y) / r.y;
    vec2 q = o.xz + r.xz * t;
    vec2 e = abs(q) - uLampHalf;
    float inside = 1.0 - smoothstep(0.0, 0.004, max(e.x, e.y));
    c += uLampCol * 0.55 * inside;
  }
  return c;
}
vec2 boxHit(vec3 o, vec3 d, out int f0, out int f1) {
  vec3 inv = 1.0 / d;
  vec3 ta = (uBoxMin - o) * inv, tb = (uBoxMax - o) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float t0 = max(max(tmin.x, tmin.y), tmin.z), t1 = min(min(tmax.x, tmax.y), tmax.z);
  f0 = tmin.x >= tmin.y && tmin.x >= tmin.z ? 0 : (tmin.y >= tmin.z ? 1 : 2);
  f1 = tmax.x <= tmax.y && tmax.x <= tmax.z ? 0 : (tmax.y <= tmax.z ? 1 : 2);
  return vec2(t0, t1);
}
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float z = texture2D(tDepth, vUv).x;
  vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); wp /= wp.w;
  vec3 o = uCamPos, d = normalize(wp.xyz - o);
  float tSc = z >= 1.0 ? 1e6 : length(wp.xyz - o);
  int f0, f1;
  vec2 th = boxHit(o, d, f0, f1);
  float tIn = max(th.x, 0.0), tOut = min(th.y, tSc);
  if (th.y <= th.x || tIn >= tSc) { gl_FragColor = vec4(col, 1.0); return; }
  vec3 pIn = o + d * tIn;
  bool fromTop = th.x > 0.0 && f0 == 1 && d.y < 0.0;           // entering through the surface (camera above)
  bool outTop = f1 == 1 && d.y > 0.0 && th.y < tSc;        // leaving through the surface from below
  // ---- surface seen from above: refraction + lamp reflection
  if (fromTop) {
    vec2 g = ripple(pIn.xz);
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec2 off = g * 0.6 * clamp((tOut - tIn) * 4.0, 0.0, 1.0);
    col = texture2D(tScene, vUv + off * vec2(uRes.y / uRes.x, 1.0)).rgb;
    float cosI = max(dot(-d, n), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
    col = col * (1.0 - F) + roomEnv(pIn, reflect(d, n)) * F;
  }
  float L = max(tOut - tIn, 0.0);
  // ---- underside of the surface: total internal reflection shows the tank interior mirrored
  if (outTop) {
    vec3 h = o + d * th.y;
    vec2 g = ripple(h.xz);
    vec3 n = normalize(vec3(-g.x, -1.0, -g.y));                // facing down into the water
    float cosI = clamp(dot(-d, n), 0.0, 1.0);
    float sinT = 1.333 * sqrt(max(1.0 - cosI * cosI, 0.0));
    float R = 1.0;
    if (sinT < 1.0) {
      float r0 = 0.02;
      R = r0 + (1.0 - r0) * pow(1.0 - sqrt(1.0 - sinT * sinT), 5.0);
      R = mix(R, 1.0, smoothstep(0.85, 1.0, sinT));
    }
    vec3 refl = col * 0.15;
    if (uMirrorOn > 0.5) {
      vec4 mc = uMirrorVP * vec4(h + vec3(g.x, 0.0, g.y) * 0.06, 1.0);
      vec2 muv = mc.xy / mc.w * 0.5 + 0.5;
      refl = texture2D(tMirror, clamp(muv, 0.001, 0.999)).rgb;
    }
    // the reflected light travelled further through the water
    refl *= exp(-uSigma * L * 0.9);
    col = mix(col, refl, R);
    L *= 1.0;
  }
  // ---- side panes seen from inside: beyond the critical angle the glass is a perfect mirror (planar mirror RTs)
  bool outSide = f1 == 0 && th.y < tSc;
  if (outSide && uSideOn > 0.5) {
    vec3 h = o + d * th.y;
    float cosI = abs(d.x);
    float R = 1.0 - smoothstep(0.6, 0.72, cosI);
    if (R > 0.0) {
      vec4 mc = d.x > 0.0 ? uMirrorRVP * vec4(h, 1.0) : uMirrorLVP * vec4(h, 1.0);
      vec2 muv = clamp(mc.xy / mc.w * 0.5 + 0.5, 0.001, 0.999);
      vec3 refl = d.x > 0.0 ? texture2D(tMirrorR, muv).rgb : texture2D(tMirrorL, muv).rgb;
      refl *= exp(-uSigma * (L + (uBoxMax.x - uBoxMin.x) * 0.5));
      col = mix(col, refl, R * 0.92);
    }
  }
  // ---- absorption + lamp light scattered toward the eye (shafts through the shadows of rocks, wood, plants)
  vec3 T = exp(-uSigma * L);
  vec3 S = vec3(0.0);
  if (L > 0.0) {
    const int N = 14;
    float j = fract(ign(gl_FragCoord.xy) + uFrame * 0.618034);
    float dt = L / float(N);
    float cosP = dot(uLightDir, -d);
    float g = 0.55;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosP, 1.5) / 12.566;
    float phase = 0.35 / 12.566 + hg * 0.65;
    for (int i = 0; i < N; i++) {
      float t = (float(i) + j) * dt;
      vec3 p = pIn + d * t;
      float down = max(uWaterY - p.y, 0.0);
      vec3 Li = uLampCol * exp(-uSigma * (down + t)) * shadowVis(p) * cauLite(p);
      S += Li * dt;
    }
    S *= phase * uShafts * 3.4 * uScatCol;
    // a little milky veil in deep water (fine suspended particles)
    S += uScatCol * uHaze * (1.0 - T.g) * 0.06 * dot(uLampCol, vec3(0.33));
  }
  col = col * T + S;
  // ---- meniscus: where the surface meets the glass, a thin silver line seen from the front
  if (th.x > 0.0 && f0 != 1) {
    float dy = pIn.y - uWaterY;
    col += vec3(0.5, 0.55, 0.56) * (1.0 - smoothstep(0.0, 0.0012, abs(dy + 0.0006))) * dot(uLampCol, vec3(0.2));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createPost(renderer) {
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene(); quadScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(quadScene, postCam); };
  const hdrRT = (w, h, o = {}) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, ...o });

  let depthTex, sceneRT, waterRT, dofRT, mirrorRT, sideRT = [], bloomRT = [];
  const RT = { samples: 2, bloomLevels: 3, reflections: false, depthOfField: false };          // MSAA samples of the scene (the light preset uses 2)
  const BLOOM_LEVELS = 5;
  function alloc() {
    [sceneRT, waterRT, dofRT, mirrorRT, ...sideRT, ...bloomRT].forEach((r) => r?.dispose());
    depthTex = new THREE.DepthTexture(size.x, size.y);
    depthTex.type = THREE.FloatType;
    sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: RT.samples, depthTexture: depthTex });
    waterRT = hdrRT(size.x, size.y);
    dofRT = hdrRT(RT.depthOfField ? size.x : 1, RT.depthOfField ? size.y : 1);
    mirrorRT = new THREE.WebGLRenderTarget(RT.reflections ? Math.max(1, size.x >> 1) : 1, RT.reflections ? Math.max(1, size.y >> 1) : 1, { type: THREE.HalfFloatType, samples: RT.reflections ? 2 : 0 });
    sideRT = [0, 1].map(() => new THREE.WebGLRenderTarget(RT.reflections ? Math.max(1, Math.round(size.x * 0.55)) : 1, RT.reflections ? Math.max(1, Math.round(size.y * 0.55)) : 1, { type: THREE.HalfFloatType, samples: RT.reflections ? 2 : 0 }));
    bloomRT = [];
    let w = size.x, h = size.y;
    for (let i = 0; i < RT.bloomLevels; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); bloomRT.push(hdrRT(w, h)); }
  }
  alloc();

  // ---------- depth of field: a lens focused at W.focus metres; blur grows with |1/focus - 1/distance| ----------
  const dofMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
                uFocus: { value: 1 }, uAperture: { value: 0.004 }, uRes: { value: size }, uMaxCoC: { value: 14 } },
    vertexShader: FS_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform mat4 uInvVP; uniform vec3 uCamPos;
      uniform float uFocus, uAperture, uMaxCoC; uniform vec2 uRes;
      float dist(vec2 uv) {
        float z = texture2D(tDepth, uv).x;
        if (z >= 1.0) return 50.0;
        vec4 w = uInvVP * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
        return length(w.xyz / w.w - uCamPos);
      }
      float coc(vec2 uv) { return min(uMaxCoC, uAperture * abs(1.0 / uFocus - 1.0 / dist(uv)) * uRes.y); }
      void main() {
        vec3 c0 = texture2D(tColor, vUv).rgb;
        float r0 = coc(vUv);
        if (r0 < 0.6) { gl_FragColor = vec4(c0, 1.0); return; }
        // golden-angle spiral gather; a sample only spreads onto this pixel as far as its own blur reaches
        vec3 acc = c0; float wsum = 1.0;
        const int N = 28;
        for (int i = 1; i <= N; i++) {
          float t = float(i) / float(N);
          float r = sqrt(t) * r0, a = float(i) * 2.39996;
          vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
          float rs = coc(uv);
          float w = clamp(rs - r + 1.0, 0.0, 1.0);
          acc += texture2D(tColor, uv).rgb * w; wsum += w;
        }
        gl_FragColor = vec4(acc / wsum, 1.0);
      }`,
  });

  const W = {
    sigma: new THREE.Vector3(0.55, 0.2, 0.26),     // absorption per metre (slightly green-blue water)
    scat: new THREE.Vector3(0.75, 0.95, 1.0),
    shafts: 1.0, haze: 1.0, mirror: false, dof: false, dofK: 1, focus: 1, shadowHz: 15,
  };
  const waterMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: null }, tDepth: { value: null }, tMirror: { value: null }, tShadow: { value: null },
      uInvVP: { value: new THREE.Matrix4() }, uVP: { value: new THREE.Matrix4() }, uMirrorLVP: { value: new THREE.Matrix4() }, uMirrorRVP: { value: new THREE.Matrix4() }, tMirrorL: { value: null }, tMirrorR: { value: null }, uSideOn: { value: 1 }, uMirrorVP: { value: new THREE.Matrix4() }, uShadowM: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() },
      uLampCol: { value: new THREE.Vector3(1, 0.97, 0.92) }, uSigma: { value: W.sigma }, uScatCol: { value: W.scat },
      uTime: U.uTime, uWaterY: U.uWaterY, uLightDir: U.uLightDir, uCaustic: U.uCaustic, uCauScale: U.uCauScale,
      uShafts: { value: 1 }, uMirrorOn: { value: 1 }, uShadowOn: { value: 1 }, uLampY: { value: 0.5 }, uLampHalf: { value: new THREE.Vector2(0.25, 0.04) },
      uHaze: { value: 1 }, uRes: { value: size }, uFrame: { value: 0 },
    },
    vertexShader: FS_VERT, fragmentShader: WATER_FS,
  });

  // ---------- bloom + grade (from the canal / forest scenes) ----------
  const downMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.2 }, uFirst: { value: 1 } },
    vertexShader: FS_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uFirst;
      vec3 S(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
      void main(){
        vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0)), f = S(vec2(2, 0));
        vec3 g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2)), j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
        vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
        if (uFirst > 0.5) {
          float br = max(o.r, max(o.g, o.b));
          float soft = clamp(br - uThreshold + 0.5, 0.0, 1.0); soft = soft * soft * 0.5;
          o *= max(soft, br - uThreshold) / max(br, 1e-4);
          o /= 1.0 + max(o.r, max(o.g, o.b)) * 0.25;
        }
        gl_FragColor = vec4(o, 1.0);
      }`,
  });
  const upMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: FS_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
      vec3 S(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
      void main(){
        vec3 o = S(vec2(0)) * 4.0 + (S(vec2(-1, 0)) + S(vec2(1, 0)) + S(vec2(0, -1)) + S(vec2(0, 1))) * 2.0
               + S(vec2(-1, -1)) + S(vec2(1, -1)) + S(vec2(-1, 1)) + S(vec2(1, 1));
        gl_FragColor = vec4(o / 16.0, 1.0);
      }`,
  });
  function bloom(src) {
    let from = src;
    for (let i = 0; i < RT.bloomLevels; i++) {
      downMat.uniforms.tSrc.value = from.texture;
      downMat.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
      downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
      pass(downMat, bloomRT[i]);
      from = bloomRT[i];
    }
    for (let i = RT.bloomLevels - 1; i > 0; i--) {
      upMat.uniforms.tSrc.value = bloomRT[i].texture;
      upMat.uniforms.uTexel.value.set(1 / bloomRT[i].width, 1 / bloomRT[i].height);
      renderer.autoClear = false; pass(upMat, bloomRT[i - 1]); renderer.autoClear = true;
    }
    return bloomRT[0];
  }
  const GRADE = { exposure: 0.98, bloom: 0.05, warm: 0.03, cool: 0.008, sat: 1.1, contrast: 0.25 };
  const grade = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: null }, tBloom: { value: null }, uTime: { value: 0 }, uExposure: { value: GRADE.exposure },
                uRes: { value: size }, uGrain: { value: 1 }, uBloom: { value: GRADE.bloom },
                uWarm: { value: GRADE.warm }, uCool: { value: GRADE.cool }, uSat: { value: GRADE.sat }, uContrast: { value: GRADE.contrast } },
    vertexShader: FS_VERT,
    fragmentShader: `varying vec2 vUv; uniform sampler2D tColor, tBloom; uniform float uTime, uExposure, uGrain, uBloom, uWarm, uCool, uSat, uContrast;
      uniform vec2 uRes;
      vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float ca = 0.0006 * dot(d, d) * 4.0;
        vec3 c;
        c.r = texture2D(tColor, vUv - d * ca).r; c.g = texture2D(tColor, vUv).g; c.b = texture2D(tColor, vUv + d * ca).b;
        vec2 px = 1.0 / uRes;
        vec3 bl = (texture2D(tColor, vUv + vec2(px.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(px.x, 0.0)).rgb +
                   texture2D(tColor, vUv + vec2(0.0, px.y)).rgb + texture2D(tColor, vUv - vec2(0.0, px.y)).rgb) * 0.25;
        c = max(c + (c - bl) * 0.3, 0.0);
        c += texture2D(tBloom, vUv).rgb * uBloom;
        c = aces(c * uExposure * 0.85);
        float lu = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(lu), c, uSat * mix(0.85, 1.0, smoothstep(0.02, 0.2, lu)));
        c += (smoothstep(0.35, 0.9, lu) * uWarm) * vec3(1.0, 0.25, -0.6) + (1.0 - smoothstep(0.0, 0.35, lu)) * uCool * vec3(-0.5, 0.0, 0.6);
        c = clamp(c, 0.0, 1.0); c = c * c * (3.0 - 2.0 * c) * uContrast + c * (1.0 - uContrast);
        c *= 1.0 - 0.3 * smoothstep(0.3, 0.9, length(d * vec2(1.0, 0.8)) * 1.25);
        c = pow(c, vec3(1.0 / 2.2));
        c += (h(vUv * uRes + fract(uTime) * 91.0) - 0.5) * 0.015 * uGrain;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });

  // mirror camera across the water plane (like three's Reflector: a proper camera + projective lookup)
  const mirrorCam = new THREE.PerspectiveCamera();
  mirrorCam.layers.set(1);
  const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _vp = new THREE.Matrix4();
  /** render the tank interior (layer 1) mirrored across the plane axis = k (axis 'y' water surface, 'x' a side pane) */
  function renderMirror(scene, camera, axis, k, target, vpOut) {
    mirrorCam.copy(camera);
    mirrorCam.layers.set(1);
    camera.getWorldPosition(_v);
    camera.getWorldDirection(_t).add(_v);
    _v[axis] = 2 * k - _v[axis]; _t[axis] = 2 * k - _t[axis];
    mirrorCam.position.copy(_v);
    mirrorCam.up.set(0, axis === 'y' ? -1 : 1, 0);
    mirrorCam.lookAt(_t);
    mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    const bg = scene.background; scene.background = null;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    // Reuse the main camera's light-space shadow map; reflection cameras do not need new shadows.
    const shadowUpdate = renderer.shadowMap.autoUpdate, shadowNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
    renderer.render(scene, mirrorCam);
    renderer.shadowMap.autoUpdate = shadowUpdate; renderer.shadowMap.needsUpdate = shadowNeeds;
    scene.background = bg;
    vpOut.multiplyMatrices(mirrorCam.projectionMatrix, mirrorCam.matrixWorldInverse);
  }

  const state = { frame: 0, t: 0, shadowT: -1 };
  /** env: { tank, light, overlay } */
  function render(scene, camera, env, dt = 1 / 60) {
    state.t += dt; state.frame++;
    const wy = U.uWaterY.value;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = !env.light.shadow.map || state.t - state.shadowT >= 1 / W.shadowHz;
    if (renderer.shadowMap.needsUpdate) state.shadowT = state.t;
    renderer.setRenderTarget(sceneRT);
    renderer.setClearColor(0x050506, 1);
    renderer.render(scene, camera);
    const shadowOff = !renderer.shadowMap.enabled;
    const camBelowSurface = camera.position.y < wy + 0.25;
    const u0 = waterMat.uniforms, I0 = env.tank.inner;
    if (W.mirror && camBelowSurface) renderMirror(scene, camera, 'y', wy, mirrorRT, u0.uMirrorVP.value);
    // a side pane is seen from inside (as a mirror) only while the camera is not beyond it
    const cx = camera.position.x;
    const sideL = W.mirror && cx > I0.x0, sideR = W.mirror && cx < I0.x1;
    if (sideL) renderMirror(scene, camera, 'x', I0.x0, sideRT[0], u0.uMirrorLVP.value);
    if (sideR) renderMirror(scene, camera, 'x', I0.x1, sideRT[1], u0.uMirrorRVP.value);
    u0.tMirrorL.value = sideRT[0].texture; u0.tMirrorR.value = sideRT[1].texture;
    u0.uSideOn.value = sideL || sideR ? 1 : 0;
    const u = waterMat.uniforms;
    u.tScene.value = sceneRT.texture; u.tDepth.value = depthTex; u.tMirror.value = mirrorRT.texture;
    u.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInvVP.value.copy(u.uVP.value).invert();
    u.uCamPos.value.copy(camera.position);
    const I = env.tank.inner;
    u.uBoxMin.value.set(I.x0, 0, I.z0); u.uBoxMax.value.set(I.x1, wy, I.z1);
    const L = env.light;
    u.uShadowOn.value = !shadowOff && L.shadow.map ? 1 : 0;
    if (L.shadow.map) { u.tShadow.value = L.shadow.map.texture; u.uShadowM.value.copy(L.shadow.matrix); }
    const k = L.intensity / 3.2;
    const lc = env.tank.lampColor || [1, 0.97, 0.92];
    u.uLampCol.value.set(lc[0], lc[1], lc[2]).multiplyScalar(k);
    grade.uniforms.uSat.value = GRADE.sat * (env.tank.lampColorId === 'rgb' ? 1.22 : 1);
    u.uLampY.value = env.tank.def.h + 0.103;
    u.uLampHalf.value.set(env.tank.def.w * 0.44, Math.min(0.05, env.tank.def.d * 0.19));
    u.uShafts.value = W.shafts; u.uHaze.value = W.haze; u.uMirrorOn.value = W.mirror && camBelowSurface ? 1 : 0;
    u.uFrame.value = state.frame % 64;
    pass(waterMat, waterRT);
    // glass panes over the water image
    renderer.autoClear = false;
    renderer.setRenderTarget(waterRT);
    renderer.render(env.overlay, camera);
    renderer.autoClear = true;
    let img = waterRT;
    if (W.dof) {
      const d = dofMat.uniforms;
      d.tColor.value = waterRT.texture; d.tDepth.value = depthTex;
      d.uInvVP.value.copy(u.uInvVP.value); d.uCamPos.value.copy(camera.position);
      d.uFocus.value = Math.max(0.05, W.focus); d.uAperture.value = 0.0045 * W.dofK;
      pass(dofMat, dofRT);
      img = dofRT;
    }
    grade.uniforms.tColor.value = img.texture;
    grade.uniforms.tBloom.value = bloom(img).texture;
    grade.uniforms.uTime.value = state.t;
    pass(grade, null);
  }
  function resize() { renderer.getDrawingBufferSize(size); alloc(); }
  return { render, resize, state, GRADE, grade, W, size, water: waterMat, RT };
}
