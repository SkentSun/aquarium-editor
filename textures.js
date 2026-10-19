// Texture loading with procedural stand-ins (so the page works before / without the photo textures)
import * as THREE from 'three';
import { rng } from './shaders.js';

const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 8;
export function setAniso(n) { maxAniso = n; }

function setup(t, srgb, repeat = true) {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Granular / rocky stand-in: blobs of colour around `tint`, plus its normal map. */
function fallback(name, tint = [0.4, 0.35, 0.3], normal = false) {
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const r = rng(name.length * 977 + name.charCodeAt(0));
  const h = new Float32Array(N * N);
  const grains = name.startsWith('s_') ? 900 : 260;
  for (let k = 0; k < grains; k++) {
    const cx = r() * N, cy = r() * N, rad = (name.startsWith('s_') ? 3 : 8) + r() * (name.startsWith('s_') ? 6 : 24);
    const v = 0.5 + r() * 0.5;
    for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
      const d = (x * x + y * y) / (rad * rad);
      if (d > 1) continue;
      const i = (((cy + y) | 0) & (N - 1)) * N + (((cx + x) | 0) & (N - 1));
      h[i] = Math.max(h[i], v * Math.sqrt(1 - d));
    }
  }
  const img = g.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    if (normal) {
      const x = i % N, y = (i / N) | 0;
      const dx = h[y * N + ((x + 1) & (N - 1))] - h[y * N + ((x - 1) & (N - 1))];
      const dy = h[((y + 1) & (N - 1)) * N + x] - h[((y - 1) & (N - 1)) * N + x];
      const n = new THREE.Vector3(-dx * 3, dy * 3, 1).normalize();
      img.data.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], i * 4);
    } else {
      const v = 0.35 + 0.9 * h[i];
      img.data.set([tint[0] * v * 255, tint[1] * v * 255, tint[2] * v * 255, 255], i * 4);
    }
  }
  g.putImageData(img, 0, 0);
  return setup(new THREE.CanvasTexture(cv), !normal);
}

/** Albedo + normal pair: tex/<name>.webp, tex/<name>_n.webp. Returns immediately (stand-ins until loaded). */
export function surfaceTex(name, tint) {
  if (cache.has(name)) return cache.get(name);
  const out = { map: fallback(name, tint), normal: fallback(name, tint, true), loaded: false };
  cache.set(name, out);
  const swap = (key, url, srgb) => loader.load(url, (t) => {
    setup(t, srgb);
    const old = out[key];
    out[key] = t;
    out.listeners?.forEach((f) => f(out));
    old.dispose();
    out.loaded = true;
  }, undefined, () => {});
  swap('map', `tex/${name}.webp`, true);
  swap('normal', `tex/${name}_n.webp`, false);
  return out;
}
export function onTex(t, f) { (t.listeners ||= []).push(f); f(t); }

/** Plain image (atlas etc.) -> Promise<Texture|null> */
export function loadImageTex(url, srgb = true, repeat = false) {
  return new Promise((res) => loader.load(url, (t) => res(setup(t, srgb, repeat)), undefined, () => res(null)));
}
export async function loadJSON(url) {
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch { return null; }
}
