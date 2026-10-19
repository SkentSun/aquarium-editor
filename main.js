// 水族箱造景模拟器 — bootstrap: renderer, camera, scene graph, frame loop (capped at 60 fps)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { U } from './shaders.js';
import { setAniso } from './textures.js';
import { Tank } from './tank.js?v=natural11';
import { Soil } from './soil.js';
import { createPost } from './post.js';
import { createPerformanceMonitor } from './performance.js';
import { TANKS, SOILS } from './catalog.js?v=names1';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // PCF honours shadow.radius (PCFSoft does not): soft edges like a wide LED panel
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the grade pass does the encoding
setAniso(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const overlay = new THREE.Scene();
// soft image-based light: what the inside of a lit tank bounces around (also gives fish scales their sheen)
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.02, 30);
camera.layers.enable(1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;           // only orbit + zoom around the tank (no sideways moves)
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.touches.ONE = THREE.TOUCH.ROTATE;
controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;   // pinch zooms, two-finger drag orbits
controls.minDistance = 0.15;
controls.maxDistance = 4;
controls.maxPolarAngle = Math.PI * 0.62;

const tank = new Tank(scene, overlay);
const soil = new Soil(scene);
const post = createPost(renderer);

export const app = { renderer, scene, overlay, camera, controls, tank, soil, post, U, tankDef: null, onFrame: [] };

// ---------- quality presets; default to fine quality ----------
/** true on phones / tablets: the browser's own mobile flag, a mobile user agent, an iPad that reports itself as a Mac
 *  (multi-touch "Macintosh"), or a touch screen without any mouse / trackpad. Touchscreen laptops have a fine pointer
 *  as well, so they stay on the PC defaults. */
export function isMobileDevice() {
  const ua = navigator.userAgent || '';
  if (navigator.userAgentData?.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|PlayBook|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}
export const QUALITY = {
  low: { name: '流畅', carpetDensity: 0.3, pr: 1.0, pixels: 650000, samples: 0, shadow: 512, shadowHz: 10, mirror: false, dof: false, bloomLevels: 2 },
  std: { name: '均衡', carpetDensity: 0.6, pr: 1.25, pixels: 1200000, samples: 2, shadow: 1024, shadowHz: 15, mirror: false, dof: false, bloomLevels: 3 },
  high: { name: '精细', carpetDensity: 1, pr: 1.5, pixels: 2400000, samples: 4, shadow: 2048, shadowHz: 60, mirror: true, dof: true, bloomLevels: 5 },
};
function applyResolution() {
  const q = QUALITY[app.quality] || QUALITY.std;
  const budgetScale = Math.sqrt(q.pixels / Math.max(1, innerWidth * innerHeight));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pr, budgetScale));
  renderer.setSize(innerWidth, innerHeight, false);
}
export function setQuality(id, { save = false } = {}) {
  const q = QUALITY[id] || QUALITY.std;
  app.quality = QUALITY[id] ? id : 'std';
  applyResolution();
  post.RT.samples = q.samples;
  post.W.mirror = q.mirror;
  post.RT.reflections = q.mirror;
  post.RT.depthOfField = q.dof;
  post.W.dof = q.dof;
  post.W.shadowHz = q.shadowHz;
  post.RT.bloomLevels = q.bloomLevels;
  if (app.plants && app.plants.renderDensity !== q.carpetDensity) {
    app.plants.renderDensity = q.carpetDensity;
    for (const c of app.plants.carpets.values()) c.dirty = true;
  }
  const sh = tank.light.shadow;
  if (sh.mapSize.x !== q.shadow) { sh.mapSize.set(q.shadow, q.shadow); sh.map?.dispose(); sh.map = null; }
  post.resize();
  if (save) { try { localStorage.setItem('aqua.quality', id); } catch { } }
}
{
  // ?q=low|std|high wins, then the viewer's own last choice, then fine quality
  const urlQ = new URLSearchParams(location.search).get('q');
  let saved = null; try { saved = localStorage.getItem('aqua.quality'); } catch { }
  app.mobile = isMobileDevice();
  const pick = QUALITY[urlQ] ? urlQ : QUALITY[saved] ? saved : 'high';
  app.autoQuality = !QUALITY[urlQ] && !QUALITY[saved];
  setQuality(pick);
}
window.app = app;

export function setTank(def, keep = true) {
  app.tankDef = def;
  tank.build(def);
  soil.build(tank, keep);
  app.onTank?.forEach((f) => f(def));
}
export function viewPreset(name, instant = false) {
  const d = app.tankDef, H = d.h, W = d.w;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanH = tanV * camera.aspect;
  // distance at which the tank (plus a margin) fills the free area between the side panels
  // phones: no side panels (the width can be used), the top and tab bars take ~110 px of the height
  const m = app.layoutMode === 'm', wk = m ? 0.92 : 0.9, hk = m ? 0.8 * Math.max(0.5, 1 - 110 / innerHeight) : 0.8;
  const fit = (w, h) => Math.max((w / 2) / (tanH * wk), (h / 2) / (tanV * hk)) + d.d / 2;
  const views = {
    front: { p: [0, H * 0.48, fit(W, H)], t: [0, H * 0.46, 0] },
    angle: { p: [W * 0.7, H * 0.9, fit(W, H) * 0.85], t: [0, H * 0.38, 0] },
    top: { p: [0, H + fit(W, d.d) * 0.9, 0.001 + d.d * 0.12], t: [0, 0, 0] },
    close: { p: [-W * 0.12, H * 0.32, d.d / 2 + Math.max(0.16, W * 0.3)], t: [-W * 0.05, H * 0.28, 0] },
  };
  const v = views[name] || views.front;
  app.camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...v.p), t1: new THREE.Vector3(...v.t), k: instant ? 1 : 0 };
}

function resize() {
  applyResolution();
  camera.aspect = innerWidth / innerHeight;
  applyInset();
  post.resize();
}
// phones: a sheet covers part of the screen; shift the projection so the tank is centred in what is left
app.inset = { x: 0, y: 0 };
const _bp = new THREE.Vector3();
function applyInset() {
  const { x, y } = app.inset, W = innerWidth, H = innerHeight;
  camera.clearViewOffset(); camera.updateProjectionMatrix();
  if (!x && !y) return;
  // how big the tank is on screen now; if it would not fit the free part, zoom the projection out a little
  // (0.6x at most) instead of moving the camera, so closing the sheet gives back exactly the same view
  let z = 1;
  const d = app.tankDef;
  if (d) {
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _bp.set((i & 1 ? 0.5 : -0.5) * d.w, i & 2 ? d.h : 0, (i & 4 ? 0.5 : -0.5) * d.d).project(camera);
      x0 = Math.min(x0, _bp.x); x1 = Math.max(x1, _bp.x); y0 = Math.min(y0, _bp.y); y1 = Math.max(y1, _bp.y);
    }
    const bw = Math.min(2, x1 - x0) / 2 * W, bh = Math.min(2, y1 - y0) / 2 * H;
    z = Math.min(1, (W - x) * 0.96 / bw, (H - y) * 0.96 / bh);
    z = Math.max(0.6, z || 1);
  }
  // screen pixel s shows virtual pixel off + s / z; the image centre lands in the middle of the free part
  const cx = (W - x) / 2, cy = (H - y) / 2;
  camera.setViewOffset(W, H, W / 2 - cx / z, H / 2 - cy / z, W / z, H / z);
  camera.updateProjectionMatrix();
}
app.setInset = (v) => { app.inset = { x: v.x || 0, y: v.y || 0 }; applyInset(); };
addEventListener('resize', resize);

// ---------- frame loop (60 fps cap; ?fps=N to change) ----------
const FPS = Number(new URLSearchParams(location.search).get('fps')) || 60;
const perf = createPerformanceMonitor(app);
app.performance = perf;
let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0;
const fpsEl = document.getElementById('fps');
function loop(now) {
  requestAnimationFrame(loop);
  if (app.paused) return;
  const elapsed = now - last;
  if (elapsed < 1000 / FPS - 1.5) return;
  last = now;
  frame(Math.min(elapsed / 1000, 0.05), elapsed);
  fpsN++; fpsT += elapsed;
  if (fpsT > 500) { fpsEl.textContent = `${Math.round(fpsN * 1000 / fpsT)} fps`; fpsN = 0; fpsT = 0; }
}
/** one simulation + render step (also driven by hand when rAF is stalled, e.g. a hidden tab) */
function frame(dt, intervalMs = dt * 1000) {
  if (!(dt >= 0)) dt = 1 / 60;
  perf.begin(Number.isFinite(intervalMs) ? intervalMs : dt * 1000);          // called by hand (SNAP, tests) without a step
  U.uTime.value += dt;
  if (app.camTween) {
    const c = app.camTween;
    c.k = Math.min(1, c.k + dt * 1.8);
    const e = c.k * c.k * (3 - 2 * c.k);
    camera.position.lerpVectors(c.p0, c.p1, e);
    controls.target.lerpVectors(c.t0, c.t1, e);
    if (c.k >= 1) app.camTween = null;
  }
  controls.update();
  tank.update(camera);
  updateFocus(dt);
  for (const f of app.onFrame) f(dt, U.uTime.value);
  perf.beforeRender();
  post.render(scene, camera, { tank, light: tank.light, overlay }, dt);
  perf.end();
}
app.frame = frame;
// autofocus: every few frames cast a ray through the middle of the view at the soil, stones, wood, plants and fish;
// a tap in the tank (ui.js) can pin the focus on a point for a while
const _fr = new THREE.Raycaster(), _fc = new THREE.Vector2(0, 0);
_fr.layers.enableAll();
let focusN = 0, focusTarget = 1;
function updateFocus(dt) {
  if (app.focusLock && (app.focusLock.t -= dt) > 0) focusTarget = camera.position.distanceTo(app.focusLock.p);
  else if (focusN++ % 6 === 0) {
    app.focusLock = null;
    _fr.setFromCamera(_fc, camera);
    const objs = [soil.mesh, ...(app.layout ? app.layout.pickables() : []), ...(app.fishes ? [...app.fishes.schools.values()].map((s) => s.im).filter(Boolean) : [])];
    const h = _fr.intersectObjects(objs, true)[0];
    focusTarget = h ? h.distance : camera.position.distanceTo(controls.target);
  }
  post.W.focus += (focusTarget - post.W.focus) * Math.min(1, dt * 4);
}

async function boot() {
  const bar = document.getElementById('loadbar');
  setTank(TANKS.find((t) => t.id === '60p'), false);
  soil.setSoil(SOILS[0]);
  viewPreset('front', true);
  bar.style.width = '30%';
  const mods = await Promise.allSettled([import('./ui.js?v=natural11')]);
  for (const m of mods) if (m.status === 'rejected') console.error(m.reason);
  if (mods[0].status === 'fulfilled') await mods[0].value.initUI(app, (p) => (bar.style.width = `${30 + p * 70}%`));
  bar.style.width = '100%';
  const ld = document.getElementById('loading');
  ld.style.opacity = 0; setTimeout(() => ld.remove(), 700);
  requestAnimationFrame(loop);
}
boot().catch(error => console.error('Aquarium initialization failed:', error.stack || error));

// frame capture for checking the look: SNAP('name') -> renders/aqua/name.jpg
window.SNAP = async (name = 'snap', steps = 0) => {
  for (let i = 0; i < steps; i++) frame(1 / 60);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (location.port) await fetch(`/snap?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
  return name;
};
