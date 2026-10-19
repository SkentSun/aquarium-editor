// Substrate: a height field over the tank floor (5 mm cells) with skirts against the glass so the cross-section of
// the soil shows through the front pane. One substrate for the whole tank; sculpt brushes (raise / lower / smooth /
// flatten). Photo texture sampled triplanar in world space.
import * as THREE from 'three';
import { patchUnder, TRIPLANAR_GLSL, makeNoise } from './shaders.js';
import { surfaceTex, onTex } from './textures.js';

const CELL = 0.005;

export class Soil {
  constructor(scene) {
    this.scene = scene;
    this.uni = {
      tA: { value: null }, tAN: { value: null }, uScaleA: { value: 12 }, tAO: { value: null }, uAORect: { value: new THREE.Vector4(0, 0, 1, 1) },
    };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    patchUnder(m, {
      key: 'soil', uniforms: this.uni,
      vhead: 'attribute float aDep; varying float vDep;',
      vertex: 'vDep = aDep;',
      fhead: TRIPLANAR_GLSL + `
        uniform sampler2D tA, tAN, tAO; uniform float uScaleA; uniform vec4 uAORect;
        varying float vDep;
        // break up tiling: second rotated, scaled sample blended by low-frequency noise
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
        vec4 soilTex(sampler2D t, vec3 p, vec3 n, float s) {
          float k = vnoise(p.xz * 9.0);
          mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
          vec3 q = vec3((R * p.xz).x, p.y, (R * p.xz).y) * 1.37 + 0.31;
          return mix(triTex(t, p, n, s), triTex(t, q, n, s), smoothstep(0.35, 0.65, k));
        }`,
      map: `
        vec3 sN = normalize(vAqN);
        vec3 sp = vAqW;
        // granules stand up from the surface: a small parallax shift by the photo's brightness (top faces only)
        if (sN.y > 0.6) {
          vec3 vd = normalize(cameraPosition - vAqW);
          float hh = dot(triTex(tA, sp, sN, uScaleA).rgb, vec3(0.3, 0.59, 0.11));
          sp.xz -= vd.xz / max(vd.y, 0.3) * (hh - 0.35) * 0.0022;
        }
        vec3 scol = soilTex(tA, sp, sN, uScaleA).rgb;
        // broad patches: damper / drier, finer / coarser areas
        scol *= mix(0.84, 1.12, vnoise(vAqW.xz * 11.0) * 0.6 + vnoise(vAqW.xz * 31.0) * 0.4);
        // cross-section against the glass: older compacted layers darker toward the bottom, faint strata,
        // pale roots in the top layer under carpets and bushes
        if (abs(sN.y) < 0.5) {
          scol *= mix(0.6, 1.0, smoothstep(0.0, 0.06, vAqW.y)) * mix(0.88, 1.06, vnoise(vec2((vAqW.x + vAqW.z) * 50.0, vAqW.y * 380.0)));
          vec4 cn = texture2D(tCanopy, (vAqW.xz - uCanopyRect.xy) / uCanopyRect.zw);
          float rooted = smoothstep(0.12, 0.35, cn.r) * (1.0 - smoothstep(0.003, 0.02, vDep));
          float along = vAqW.x + vAqW.z;
          // fine hair roots: thin, irregular, only some of them, fading out with depth
          float w1 = abs(sin(along * 1300.0 + vnoise(vec2(along * 240.0, vDep * 500.0)) * 7.0));
          float w2 = abs(sin(along * 2100.0 + 1.7 + vnoise(vec2(along * 400.0 + 3.0, vDep * 800.0)) * 9.0));
          float root = smoothstep(0.992, 0.999, w1) * step(0.45, vnoise(vec2(along * 90.0, 1.0)))
                     + smoothstep(0.995, 0.9995, w2) * step(0.55, vnoise(vec2(along * 130.0, 5.0))) * 0.7;
          root *= 1.0 - smoothstep(0.004, 0.016, vDep) * vnoise(vec2(along * 300.0, vDep * 200.0));
          scol = mix(scol, vec3(0.58, 0.55, 0.47), clamp(root, 0.0, 1.0) * rooted * 0.55);
        }
        diffuseColor.rgb *= scol;
        // contact shadow where stones and driftwood sit on the substrate
        diffuseColor.rgb *= texture2D(tAO, (vAqW.xz - uAORect.xy) / uAORect.zw).r;
        // contact darkening near the glass edge at the bottom of the skirts
        diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 0.02, vAqW.y));
        // the cross-section against the front glass catches light scattered in the water
        totalEmissiveRadiance += diffuseColor.rgb * 0.22 * (1.0 - abs(sN.y));`,
      normal: `
        {
          vec3 sN2 = normalize(vAqN);
          vec3 nw = triNormal(tAN, vAqW, sN2, uScaleA, 1.0);
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`,
    });
    this.mat = m;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.mesh.layers.enable(1);
    this.mesh.name = 'soil';
    scene.add(this.mesh);
    this.noise = makeNoise(7);
  }

  build(tank, keep) {
    const I = tank.inner;
    this.I = I;
    const W = I.x1 - I.x0, D = I.z1 - I.z0;
    const NX = Math.max(8, Math.round(W / CELL)), NZ = Math.max(8, Math.round(D / CELL));
    const old = keep && this.h ? { h: this.h, NX: this.NX, NZ: this.NZ } : null;
    this.NX = NX; this.NZ = NZ; this.dx = W / NX; this.dz = D / NZ;
    this.h = new Float32Array((NX + 1) * (NZ + 1));
    this.maxH = tank.waterY - 0.03;
    if (old) this._resample(old);
    else this.slope(0.03, 0.085);
    this.setContact([]);
    this._geometry();
  }

  _resample(o) {
    for (let j = 0; j <= this.NZ; j++) for (let i = 0; i <= this.NX; i++) {
      const u = i / this.NX * o.NX, v = j / this.NZ * o.NZ;
      const oi = Math.min(o.NX, Math.round(u)), oj = Math.min(o.NZ, Math.round(v));
      this.h[j * (this.NX + 1) + i] = Math.min(o.h[oj * (o.NX + 1) + oi], this.maxH);
    }
  }

  /** Classic slope: front height f, back height b (m), a little natural unevenness. */
  slope(f, b) {
    const { NX, NZ } = this;
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const v = j / NZ;                                    // 0 back .. 1 front
      const x = i / NX;
      let y = b + (f - b) * Math.pow(v, 0.85);
      y += 0.004 * this.noise(x * 4, v * 3, 0.5) + 0.0015 * this.noise(x * 13, v * 11, 2.0);
      this.h[j * (NX + 1) + i] = Math.min(Math.max(y, 0.008), this.maxH);
    }
    if (this.mesh.geometry.attributes.position) this._geometry();
  }

  setSoil(def) {
    const t = surfaceTex(def.tex, def.tint);
    onTex(t, (x) => { this.uni.tA.value = x.map; this.uni.tAN.value = x.normal; });
    this.uni.uScaleA.value = 1 / THREE.MathUtils.clamp(def.grain * 26, 0.035, 0.13);
    this.soilDef = def;
  }

  /** contact occlusion on the substrate from points on stones / wood surfaces ({ c: Vector3 } list) */
  setContact(pts) {
    const I = this.I, C = 0.005;
    const nx = Math.round((I.x1 - I.x0) / C), nz = Math.round((I.z1 - I.z0) / C);
    if (!this.aoTex || this.aoTex.image.width !== nx || this.aoTex.image.height !== nz) {
      this.aoTex?.dispose();
      this.aoTex = new THREE.DataTexture(new Uint8Array(nx * nz).fill(255), nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
      this.aoTex.magFilter = this.aoTex.minFilter = THREE.LinearFilter;
      this.uni.tAO.value = this.aoTex;
      this.uni.uAORect.value.set(I.x0, I.z0, I.x1 - I.x0, I.z1 - I.z0);
    }
    const occ = new Float32Array(nx * nz);
    const R = 0.035, S2 = 0.014 * 0.014;
    for (const p of pts) {
      const gy = this.heightAt(p.c.x, p.c.z);
      const gap = p.c.y - gy;
      if (gap > 0.06 || gap < -0.03) continue;
      const w = 0.16 * (1 - Math.max(0, gap) / 0.06);
      const i0 = Math.max(0, Math.floor((p.c.x - R - I.x0) / C)), i1 = Math.min(nx - 1, Math.ceil((p.c.x + R - I.x0) / C));
      const j0 = Math.max(0, Math.floor((p.c.z - R - I.z0) / C)), j1 = Math.min(nz - 1, Math.ceil((p.c.z + R - I.z0) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = I.x0 + (i + 0.5) * C - p.c.x, dz = I.z0 + (j + 0.5) * C - p.c.z;
        occ[j * nx + i] += w * Math.exp(-(dx * dx + dz * dz) / S2);
      }
    }
    const d = this.aoTex.image.data;
    for (let n = 0; n < d.length; n++) d[n] = Math.round(255 * (1 - 0.62 * (1 - Math.exp(-occ[n] * 2.2))));
    this.aoTex.needsUpdate = true;
  }

  idx(i, j) { return j * (this.NX + 1) + i; }
  heightAt(x, z) {
    const u = THREE.MathUtils.clamp((x - this.I.x0) / this.dx, 0, this.NX - 1e-4);
    const v = THREE.MathUtils.clamp((z - this.I.z0) / this.dz, 0, this.NZ - 1e-4);
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, N = this.NX + 1, h = this.h;
    return (h[j * N + i] * (1 - fu) + h[j * N + i + 1] * fu) * (1 - fv) + (h[(j + 1) * N + i] * (1 - fu) + h[(j + 1) * N + i + 1] * fu) * fv;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.006;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  /** Sculpt. mode: raise | lower | smooth | flatten. Returns true if something changed. */
  brush(mode, x, z, r, k) {
    const { NX, NZ, h } = this;
    const i0 = Math.max(0, Math.floor((x - r - this.I.x0) / this.dx)), i1 = Math.min(NX, Math.ceil((x + r - this.I.x0) / this.dx));
    const j0 = Math.max(0, Math.floor((z - r - this.I.z0) / this.dz)), j1 = Math.min(NZ, Math.ceil((z + r - this.I.z0) / this.dz));
    if (i0 > i1 || j0 > j1) return false;
    const target = mode === 'flatten' ? this.heightAt(x, z) : 0;
    const src = mode === 'smooth' ? h.slice() : null;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = this.I.x0 + i * this.dx, pz = this.I.z0 + j * this.dz;
      const d = Math.hypot(px - x, pz - z) / r;
      if (d >= 1) continue;
      const w = (1 - d * d) * (1 - d * d) * k;
      const n = this.idx(i, j);
      if (mode === 'raise') h[n] += w * 0.03;
      else if (mode === 'lower') h[n] -= w * 0.03;
      else if (mode === 'flatten') h[n] += (target - h[n]) * Math.min(1, w * 6);
      else if (mode === 'smooth') {
        let s = 0, c = 0;
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
          const ii = i + a, jj = j + b;
          if (ii < 0 || jj < 0 || ii > NX || jj > NZ) continue;
          s += src[this.idx(ii, jj)]; c++;
        }
        h[n] += (s / c - h[n]) * Math.min(1, w * 8);
      }
      h[n] = THREE.MathUtils.clamp(h[n], 0.004, this.maxH);
    }
    this._updatePositions(i0, i1, j0, j1);
    return true;
  }

  _geometry() {
    const { NX, NZ, I } = this;
    const N = (NX + 1) * (NZ + 1);
    // skirts: 4 sides x (edge vertices) x 2 rows
    const edge = 2 * (NX + 1) + 2 * (NZ + 1);
    const pos = new Float32Array((N + edge * 2) * 3), nor = new Float32Array((N + edge * 2) * 3);
    const idx = [];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // skirt vertex lists: [grid index, outward normal]
    this.skirt = [];
    let v = N;
    const side = (list, nx, nz, flip) => {
      const start = v;
      for (const gi of list) { this.skirt.push([v, gi, nx, nz]); v += 2; }
      for (let k = 0; k < list.length - 1; k++) {
        const t0 = start + k * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
        if (flip) idx.push(t0, t1, b0, b0, t1, b1); else idx.push(t0, b0, t1, b0, b1, t1);
      }
    };
    const row = (j) => Array.from({ length: NX + 1 }, (_, i) => j * (NX + 1) + i);
    const col = (i) => Array.from({ length: NZ + 1 }, (_, j) => j * (NX + 1) + i);
    side(row(NZ), 0, 1, false);      // front
    side(row(0), 0, -1, true);       // back
    side(col(0), -1, 0, false);      // left
    side(col(NX), 1, 0, true);       // right
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aDep', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));    // depth below the surface (skirts)
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this._updatePositions(0, NX, 0, NZ);
  }

  _updatePositions(i0, i1, j0, j1) {
    const { NX, NZ, I, h } = this;
    const g = this.mesh.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array;
    const a0 = Math.max(0, i0 - 1), a1 = Math.min(NX, i1 + 1), b0 = Math.max(0, j0 - 1), b1 = Math.min(NZ, j1 + 1);
    for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
      const n = j * (NX + 1) + i;
      P[n * 3] = I.x0 + i * this.dx; P[n * 3 + 1] = h[n]; P[n * 3 + 2] = I.z0 + j * this.dz;
      const hl = h[j * (NX + 1) + Math.max(i - 1, 0)], hr = h[j * (NX + 1) + Math.min(i + 1, NX)];
      const hb = h[Math.max(j - 1, 0) * (NX + 1) + i], hf = h[Math.min(j + 1, NZ) * (NX + 1) + i];
      const nx = (hl - hr) / (2 * this.dx), nz = (hb - hf) / (2 * this.dz);
      const l = Math.hypot(nx, 1, nz);
      Nn[n * 3] = nx / l; Nn[n * 3 + 1] = 1 / l; Nn[n * 3 + 2] = nz / l;
    }
    const Dp = g.attributes.aDep.array;
    for (const [v, gi, nx, nz] of this.skirt) {
      Dp[v] = 0; Dp[v + 1] = h[gi];
      const x = P[gi * 3], z = P[gi * 3 + 2];
      P[v * 3] = x; P[v * 3 + 1] = h[gi]; P[v * 3 + 2] = z;
      P[v * 3 + 3] = x; P[v * 3 + 4] = 0; P[v * 3 + 5] = z;
      for (const o of [0, 3]) { Nn[v * 3 + o] = nx; Nn[v * 3 + o + 1] = 0; Nn[v * 3 + o + 2] = nz; }
    }
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.attributes.aDep.needsUpdate = true;
    this.version = (this.version || 0) + 1;
    g.computeBoundingSphere(); g.computeBoundingBox();
  }

  /** litres of substrate */
  volumes() {
    let a = 0;
    for (let n = 0; n < this.h.length; n++) a += this.h[n];
    return { soil: a * this.dx * this.dz * 1000 };
  }

  serialize() {
    return { NX: this.NX, NZ: this.NZ, h: chunkB64(Uint16Array.from(this.h, (v) => Math.round(v * 10000))) };
  }
  deserialize(o) {
    if (!o?.h) return;
    const h = new Uint16Array(unB64(o.h).buffer);
    this._resample({ h: Float32Array.from(h, (v) => v / 10000), NX: o.NX, NZ: o.NZ });
    this._geometry();
  }
}

export function chunkB64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
  return btoa(s);
}
export function unB64(s) {
  const b = atob(s), u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
}
