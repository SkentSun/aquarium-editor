// Layout state: every placed thing as plain data (so it can be saved, shared, undone), and the scene objects built
import * as THREE from 'three';
import { TANKS, SOILS, STONES, WOODS, PLANTS, FISH } from './catalog.js?v=names1';
import { makeStone } from './rocks.js';
import { makeWood } from './wood.js';
import { chunkB64, unB64 } from './soil.js';
import { INVERTS } from './invert.js?v=names1';

const byId = (arr, id) => arr.find((x) => x.id === id);
let uidN = 1;
export const newUid = () => `${Date.now().toString(36)}${(uidN++).toString(36)}`;

export class Layout {
  constructor(app, plants, fishes) {
    this.app = app; this.plants = plants; this.fishes = fishes;
    this.items = new Map();             // uid -> { item, mesh }
    this.settings = { tank: '60p', soil: 'aquasoil', bg: 'white', lamp: 0.6, lampColor: 'white', co2: true, stand: true };
    this.fishCounts = {};
    this.obstacles = [];
    this.listeners = [];
  }
  changed() { this.listeners.forEach((f) => f()); }

  // ---------- items ----------
  add(item, { silent } = {}) {
    item.uid ||= newUid();
    let mesh;
    if (item.kind === 'stone') mesh = makeStone(byId(STONES, item.type), item);
    else if (item.kind === 'wood') mesh = makeWood(byId(WOODS, item.type), item);
    else {
      // stems / ribbons that reach the surface bend over and lie along it
      const top = item.host ? 1 : this.app.tank.waterY - this.app.soil.heightAt(item.x, item.z) - 0.004;
      const I = this.app.tank.inner, m = 0.006;
      const box = item.host ? null : [I.x0 + m - item.x, I.x1 - m - item.x, I.z0 + m - item.z, I.z1 - m - item.z];
      mesh = this.plants.buildClump(byId(PLANTS, item.type), item, top, box);
    }
    mesh.userData.uid = item.uid;
    this.items.set(item.uid, { item, mesh });
    this.place(item.uid);
    if (!silent) { this.rebuildObstacles(); this.changed(); }
    return item;
  }
  remove(uid, { silent } = {}) {
    const o = this.items.get(uid);
    if (!o) return;
    // epiphytes tied to this object go with it
    for (const [u, p] of [...this.items]) if (p.item.host === uid) this.remove(u, { silent: true });
    o.mesh.parent?.remove(o.mesh);
    if (o.item.kind === 'plant') o.mesh.geometry.dispose();
    else o.mesh.material.dispose();
    this.items.delete(uid);
    if (!silent) { this.rebuildObstacles(); this.changed(); }
  }
  clear() {
    for (const uid of [...this.items.keys()]) this.remove(uid, { silent: true });
    this.plants.resetCarpets();
  }
  /** put the mesh where its item says (soil height follows the substrate) */
  place(uid) {
    const o = this.items.get(uid);
    if (!o) return;
    const { item, mesh } = o, soil = this.app.soil;
    if (item.transform) {
      const parent = item.host ? this.items.get(item.host)?.mesh : this.app.scene;
      if (parent && mesh.parent !== parent) parent.add(mesh);
      new THREE.Matrix4().fromArray(item.transform).decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrixWorld(true); return;
    }

    if (item.host) {
      const h = this.items.get(item.host);
      if (!h) return;
      if (mesh.parent !== h.mesh) h.mesh.add(mesh);
      mesh.position.fromArray(item.lp);
      const n = new THREE.Vector3().fromArray(item.ln).normalize();
      // grow away from the surface, leaning toward the light
      const up = n.clone().lerp(new THREE.Vector3(0, 1, 0).applyQuaternion(h.mesh.quaternion.clone().invert()), 0.45).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.rot || 0));
      mesh.scale.setScalar(1 / h.mesh.scale.x);
      return;
    }
    if (mesh.parent !== this.app.scene) this.app.scene.add(mesh);
    const y = soil.heightAt(item.x, item.z);
    if (item.kind === 'stone' || item.kind === 'wood') {
      const s = item.size * (item.scale || 1);
      mesh.scale.setScalar(s);
      mesh.position.set(item.x, y - (item.sink ?? s * (item.kind === 'stone' ? 0.1 : 0.03)), item.z);
      mesh.rotation.set(item.tiltX || 0, item.rot || 0, item.tiltZ || 0, 'YXZ');
      // nothing sticks out of the water: shrink a piece that would break the surface
      mesh.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(mesh), lim = this.app.tank.waterY - 0.01;
      if (bb.max.y > lim) {
        const k = Math.max(0.3, (lim - mesh.position.y) / Math.max(bb.max.y - mesh.position.y, 1e-4));
        mesh.scale.setScalar(s * k);
      }
    } else {
      // clumps are generated already facing every way; no extra yaw so the in-tank clamp stays valid
      mesh.position.set(item.x, y - 0.002, item.z);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.setScalar(1);
    }
    mesh.updateMatrixWorld(true);
  }
  placeAll() { for (const uid of this.items.keys()) if (!this.items.get(uid).item.host) this.place(uid); for (const uid of this.items.keys()) if (this.items.get(uid).item.host) this.place(uid); this.rebuildObstacles(); }
  pickables() { return [...this.items.values()].map((o) => o.mesh); }
  hosts() { return [...this.items.values()].filter((o) => o.item.kind !== 'plant').map((o) => o.mesh); }

  /** spheres around stones and driftwood for the fish to swim around (vertex clusters on a 3 cm grid) */
  rebuildObstacles() {
    const out = [];
    const v = new THREE.Vector3();
    for (const { item, mesh } of this.items.values()) {
      if (item.kind === 'plant') continue;
      mesh.updateMatrixWorld(true);
      const P = mesh.geometry.attributes.position, cells = new Map();
      const step = Math.max(1, Math.floor(P.count / 1500));
      for (let i = 0; i < P.count; i += step) {
        v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
        const k = `${Math.floor(v.x / 0.03)},${Math.floor(v.y / 0.03)},${Math.floor(v.z / 0.03)}`;
        const c = cells.get(k) || cells.set(k, { s: new THREE.Vector3(), n: 0 }).get(k);
        c.s.add(v); c.n++;
      }
      for (const c of cells.values()) out.push({ c: c.s.divideScalar(c.n), r: 0.012 });
    }
    this.obstacles.length = 0;
    this.obstacles.push(...out);
    this.app.soil.setContact(out);
    // plant bushes as soft cylinders the fish weave around
    this.plantObs = [];
    for (const { item, mesh } of this.items.values()) {
      if (item.kind !== 'plant' || item.host) continue;
      const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      this.plantObs.push({ x: mesh.position.x, z: mesh.position.z, r: Math.max(0.01, Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.35), top: mesh.position.y + bb.max.y * 0.9 });
    }
    this.rebuildCanopy();
  }

  /** top-down map of what shades each point of the floor from the room light (see shaders.js aqCanopy) */
  rebuildCanopy() {
    const I = this.app.tank.inner, C = 0.01, wy = this.app.tank.waterY, soil = this.app.soil;
    const nx = Math.max(2, Math.round((I.x1 - I.x0) / C)), nz = Math.max(2, Math.round((I.z1 - I.z0) / C));
    const occ = new Float32Array(nx * nz), top = new Float32Array(nx * nz);
    const splat = (x, z, r, k, h) => {
      const i0 = Math.max(0, Math.floor((x - r - I.x0) / C)), i1 = Math.min(nx - 1, Math.ceil((x + r - I.x0) / C));
      const j0 = Math.max(0, Math.floor((z - r - I.z0) / C)), j1 = Math.min(nz - 1, Math.ceil((z + r - I.z0) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(I.x0 + (i + 0.5) * C - x, I.z0 + (j + 0.5) * C - z) / r;
        if (d >= 1) continue;
        const n = j * nx + i, w = (1 - d * d);
        occ[n] += k * w; top[n] = Math.max(top[n], h);
      }
    };
    const dens = { stem: 0.7, rosette: 0.45, ribbon: 0.35 };
    for (const { item, mesh } of this.items.values()) {
      if (item.kind !== 'plant' || item.host) continue;
      const def = byId(PLANTS, item.type), g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, r = Math.max(0.015, Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.55);
      splat(mesh.position.x, mesh.position.z, r, dens[def.kind] ?? 0.3, mesh.position.y + bb.max.y);
    }
    for (const o of this.obstacles) splat(o.c.x, o.c.z, 0.03, 0.12, o.c.y);
    for (const c of this.plants.carpets.values()) {
      for (let j = 0; j < c.NZ; j++) for (let i = 0; i < c.NX; i++) {
        const v = c.grid[j * c.NX + i] / 255; if (v < 0.05) continue;
        const x = I.x0 + (i + 0.5) * 0.01, z = I.z0 + (j + 0.5) * 0.01;
        splat(x, z, 0.012, 0.35 * v, soil.heightAt(x, z) + c.def.h);
      }
    }
    const data = new Uint8Array(nx * nz * 4);
    for (let n = 0; n < nx * nz; n++) {
      data[n * 4] = Math.round(255 * (1 - Math.exp(-occ[n] * 1.3)));
      data[n * 4 + 1] = Math.round(255 * Math.min(1, top[n] / wy));
      data[n * 4 + 3] = 255;
    }
    const U = this.app.U;
    const old = U.tCanopy.value;
    const t = new THREE.DataTexture(data, nx, nz);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    U.tCanopy.value = t;
    U.uCanopyRect.value.set(I.x0, I.z0, I.x1 - I.x0, I.z1 - I.z0);
    if (old.image.width > 1) old.dispose();
  }

  // ---------- (de)serialise ----------
  serialize() {
    const items = [...this.items.values()].map((o) => ({ ...o.item }));
    const carpets = {};
    for (const [id, c] of this.plants.carpets) if (c.grid.some((x) => x)) carpets[id] = { NX: c.NX, NZ: c.NZ, g: chunkB64(c.grid) };
    return { v: 1, settings: { ...this.settings }, soil: this.app.soil.serialize(), items, carpets, fish: { ...this.fishCounts } };
  }
  async load(state, setTank) {
    this.clear();
    Object.assign(this.settings, state.settings || {});
    const app = this.app;
    setTank(byId(TANKS, this.settings.tank) || TANKS[2], false);
    app.soil.setSoil(byId(SOILS, this.settings.soil) || SOILS[0]);
    if (state.soil) app.soil.deserialize(state.soil);
    app.tank.setBackground(this.settings.bg);
    app.tank.setLampColor(this.settings.lampColor || 'white');
    app.tank.setLamp(this.settings.lamp ?? 0.6);
    // hosts first, then what is tied to them
    const items = state.items || [];
    for (const it of items.filter((i) => !i.host)) this.add({ ...it }, { silent: true });
    for (const it of items.filter((i) => i.host)) if (this.items.has(it.host)) this.add({ ...it }, { silent: true });
    for (const [id, c] of Object.entries(state.carpets || {})) {
      const def = byId(PLANTS, id); if (!def) continue;
      const car = this.plants.carpet(def, app.soil);
      const g = unB64(c.g);
      if (c.NX === car.NX && c.NZ === car.NZ) car.grid.set(g);
      else for (let j = 0; j < car.NZ; j++) for (let i = 0; i < car.NX; i++) car.grid[j * car.NX + i] = g[Math.min(c.NZ - 1, Math.floor(j / car.NZ * c.NZ)) * c.NX + Math.min(c.NX - 1, Math.floor(i / car.NX * c.NX))];
      car.dirty = true;
    }
    this.fishCounts = {};
    for (const f of [...FISH, ...INVERTS]) await this.setFish(f.id, state.fish?.[f.id] || 0);
    this.rebuildObstacles();
    this.changed();
  }
  async setFish(id, n) {
    const inv = byId(INVERTS, id), def = byId(FISH, id);
    if (!def && !inv) return;
    n = Math.max(0, Math.min(60, n));
    if (n) this.fishCounts[id] = n; else delete this.fishCounts[id];
    try {
      if (inv) this.inverts?.setCount(inv, n);
      else if (n || this.fishes.schools.has(id)) await this.fishes.setCount(def, n);
    } catch (e) { console.warn('livestock not available', id, e); delete this.fishCounts[id]; }
    this.changed();
  }

  // Scene measurements and compatibility advice, independent of commercial data.
  summary() {
    const app = this.app, S = this.settings;
    const tank = byId(TANKS, S.tank) || TANKS[2];
    const warns = [], plantN = {};
    const vol = app.soil.volumes();
    let rockL = 0;
    for (const { item, mesh } of this.items.values()) {
      if (item.kind === 'stone') rockL += (mesh.geometry.userData.volume || 0.3) * mesh.scale.x ** 3 * 1000;
      else if (item.kind === 'wood') rockL += mesh.scale.x ** 3 * 0.04 * 1000;
      else plantN[item.type] = (plantN[item.type] || 0) + 1;
    }
    let carpetArea = 0;
    for (const c of this.plants.carpets.values()) carpetArea += this.plants.coverage(c);
    let fishCm = 0, fishN = 0;
    for (const [id, n] of Object.entries(this.fishCounts)) {
      const def = byId(FISH, id) || byId(INVERTS, id);
      if (!def) continue;
      fishCm += def.cm * n * (def.kind ? 0.35 : 1); fishN += n;
    }
    // ---- advice
    const I = app.tank.inner;
    const waterL = Math.max(1, (I.x1 - I.x0) * (I.z1 - I.z0) * app.tank.waterY * 1000 - vol.soil - rockL);
    if (fishCm > waterL * 1.5) warns.push({ bad: true, t: `饲养生物过多（鱼类体长总和 ${Math.round(fishCm)}cm / 水量 约${Math.round(waterL)}L）。参考标准为每升水对应 1cm 鱼体总长。` });
    else if (fishCm > waterL) warns.push({ t: `饲养密度偏高（体长总和 ${Math.round(fishCm)}cm / 水量 约${Math.round(waterL)}L）。建议加强过滤。` });
    const has = (id) => (this.fishCounts[id] || 0) > 0;
    if (has('angel') && ['neon', 'cardinal', 'ember', 'guppy', 'medaka'].some(has))
      warns.push({ t: '神仙鱼长大后可能捕食红绿灯等能吞下的小型鱼。' });
    if ((this.fishCounts.betta || 0) > 1) warns.push({ bad: true, t: '雄性斗鱼会激烈争斗，每缸请只养一条。' });
    if (has('betta') && ['guppy', 'honey'].some(has)) warns.push({ t: '斗鱼与孔雀鱼、丝足鲈之间可能发生咬鳍。' });
    if (has('angel') && tank.h < 0.36) warns.push({ t: '神仙鱼体高较大，建议使用高度至少 36cm 的鱼缸。' });
    if (has('medaka') && ['angel', 'betta'].some(has)) warns.push({ t: '青鳉对水温、水质的偏好与热带鱼不同，请谨慎混养。' });
    const fishDefs = Object.keys(this.fishCounts).map((id) => byId(FISH, id)).filter(Boolean);
    const shrimp = INVERTS.filter((d) => d.kind === 'shrimp' && has(d.id));
    const cold = fishDefs.filter((d) => d.cold), warm = fishDefs.filter((d) => !d.cold);
    if (cold.length && warm.length) warns.push({ t: `${cold.map((d) => d.name).join('・')}偏好较低水温。${warm[0].name}等热带鱼混养时需注意水温管理。` });
    if (shrimp.length && fishDefs.some((d) => d.eatsShrimp || d.predator)) warns.push({ bad: true, t: `${fishDefs.filter((d) => d.eatsShrimp || d.predator).map((d) => d.name).join('・')}可能捕食虾类。` });
    if (has('dwarfpuffer') && INVERTS.some((d) => d.kind === 'snail' && has(d.id))) warns.push({ t: '巧克力娃娃也会捕食螺类。' });
    if (fishDefs.some((d) => d.eatsPlants) && (carpetArea > 0 || Object.keys(plantN).length)) warns.push({ t: '金鱼可能啃食或翻挖水草，建议选用耐养水草，或以沉木、石材为主造景。' });
    for (const d of [...fishDefs, ...INVERTS.filter((x) => has(x.id))]) if (d.expert) warns.push({ t: `${d.name}对水质、水温管理要求较高，适合有经验的饲养者。` });
    if (has('discus') && tank.h < 0.45) warns.push({ t: '七彩神仙鱼体高较大，建议使用高度至少 45cm 的鱼缸。' });
    if (has('ryukin') && tank.w < 0.6) warns.push({ t: '琉金成年体型较大，建议使用长度至少 60cm 的鱼缸。' });
    // の川魚: 大きく育つ・飛び出す・小魚を食べる・同種で争う
    const big = fishDefs.filter((d) => d.cold && d.cm >= 10 && !d.eatsPlants);
    if (big.length && tank.w < 0.6) warns.push({ t: `${big.map((d) => d.name).join('・')}成年可达 ${Math.max(...big.map((d) => d.cm))}cm 左右，游速较快，建议使用长度至少 60cm 的鱼缸。` });
    if (fishDefs.some((d) => d.jumps)) warns.push({ t: `${fishDefs.filter((d) => d.jumps).map((d) => d.name).join('・')}受惊后可能跳缸，请加盖。` });
    const eaters = fishDefs.filter((d) => d.predator && d.id !== 'angel');
    const prey = fishDefs.filter((d) => d.cm <= 4 && !eaters.includes(d));
    if (eaters.length && prey.length) warns.push({ bad: true, t: `${eaters.map((d) => d.name).join('・')}可能捕食 ${prey.map((d) => d.name).join('・')}等能吞下的小鱼。` });
    for (const d of fishDefs) if (d.fighter && d.id !== 'betta' && (this.fishCounts[d.id] || 0) > 1 && tank.w < 0.9)
      warns.push({ t: `${d.name}具有领地意识，多条饲养时请用石材、沉木提供充足躲避空间。` });
    for (const [id, n] of Object.entries(this.fishCounts)) {
      const def = byId(FISH, id) || byId(INVERTS, id);
      if (!def) continue;
      if (n > 0 && n < def.minGroup) warns.push({ t: `${def.name}以 ${def.minGroup}条以上成群饲养时更安定，群游效果更佳。` });
    }
    if (carpetArea > 0 && !S.co2) warns.push({ t: '草坪类前景草在不添加 CO2 时较难养护。' });
    if (vol.soil / Math.max(0.01, (I.x1 - I.x0) * (I.z1 - I.z0) * 1000) < 0.03 && (carpetArea > 0 || Object.keys(plantN).length))
      warns.push({ t: '底床偏薄，种植水草的位置建议至少铺设 3cm 厚。' });
    if (fishN > 0 && !['oto', 'bristlenose', 'siamese', 'amano', 'minami', 'nerite'].some(has) && (carpetArea > 0 || Object.keys(plantN).length > 3))
      warns.push({ ok: true, t: '可考虑添加小精灵鱼、大和藻虾或石卷螺辅助除藻。' });
    return { warns, waterL, fishCm, fishN, itemN: this.items.size };
  }
}
