// Fish in the tank: photo-skinned glbs (side-photo fishgen) drawn instanced per species, swimming with the shared
// swim shader (web/fish/fishlib.js). Behaviour per species:
//   schooling tetras / rasboras : boids (separation / alignment / cohesion) around a roaming school goal
//   loners (angel, betta, gourami, guppy) : slow wander with hovering pauses, fins spread
//   corydoras : hop along the substrate in short bursts, now and then a dash to the surface for air
//   otocinclus : graze while stuck to the front glass, stones or wood, then move to another spot
// Food (エサ) flakes sink from the surface and every fish goes for the nearest one.
import * as THREE from 'three';
import { loadFish, swimAttributes, FishMotion, fishQuat } from './fishlib.js';
import { patchUnder, U, rng } from './shaders.js';

const MAXN = 80;
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(1, 1, 1), _V = new THREE.Vector3(), _A = new THREE.Vector3();
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const R = rng(77);

export class Fishes {
  constructor(scene, ctx) {
    this.scene = scene; this.ctx = ctx;           // ctx: { soil, tank, obstacles: [{ c: Vector3, r }] }
    this.schools = new Map();
    this.food = [];
    this.foodMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.0022, 0), new THREE.MeshStandardMaterial({ color: 0x9a5a2a, roughness: 0.8 }), 200);
    this.foodMesh.count = 0; this.foodMesh.layers.enable(1); this.foodMesh.frustumCulled = false;
    scene.add(this.foodMesh);
  }

  async ensure(def) {
    if (this.schools.has(def.id)) return this.schools.get(def.id);
    const s = { def, members: [], loading: null, im: null };
    this.schools.set(def.id, s);
    s.loading = (async () => {
      const d = await loadFish(`fish/${def.id}.glb`, { key: 'aq', roughness: 0.38 });
      patchUnder(d.material, { key: 'fishaq', noTime: true });
      const g = d.geometry.clone();
      s.a = swimAttributes(MAXN);
      g.setAttribute('aSwim', s.a.swim); g.setAttribute('aFin', s.a.fin);
      const im = new THREE.InstancedMesh(g, d.material, MAXN);
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      im.customDepthMaterial = d.depthMaterial;
      im.layers.enable(1);
      this.scene.add(im);
      s.im = im; s.swim = d.swim; s.L = d.swim.length;
    })();
    await s.loading;
    return s;
  }

  async setCount(def, n) {
    const s = await this.ensure(def);
    n = Math.min(n, MAXN);
    while (s.members.length < n) s.members.push(this._spawn(s));
    s.members.length = n;
    s.im.count = n;
  }
  count(id) { return this.schools.get(id)?.members.length || 0; }

  _bounds() {
    const I = this.ctx.tank.inner;
    return { x0: I.x0, x1: I.x1, z0: I.z0, z1: I.z1, top: U.uWaterY.value };
  }
  _zoneY(def, x, z, f) {
    const b = this._bounds(), floor = this.ctx.soil.heightAt(x, z);
    return THREE.MathUtils.lerp(floor + 0.02, b.top - 0.015, f);
  }
  _randPoint(def, out = new THREE.Vector3()) {
    const b = this._bounds(), m = 0.03;
    const x = THREE.MathUtils.lerp(b.x0 + m, b.x1 - m, R()), z = THREE.MathUtils.lerp(b.z0 + m, b.z1 - m, R());
    return out.set(x, this._zoneY(def, x, z, THREE.MathUtils.lerp(def.zone[0], def.zone[1], R())), z);
  }
  /** a height (fraction of def.zone) away from the heights the other free-swimming fish are at or heading to */
  _freeHeight(def, self) {
    let best = R(), bestScore = -1;
    for (let k = 0; k < 5; k++) {
      const f = R(), y = THREE.MathUtils.lerp(def.zone[0], def.zone[1], f);
      let score = 1;
      for (const o of this._loose || []) {
        if (o.m === self) continue;
        const oy = THREE.MathUtils.lerp(o.def.zone[0], o.def.zone[1], o.m.hpref);
        score = Math.min(score, Math.abs(oy - y));
      }
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }
  _spawn(s) {
    const def = s.def;
    const p = this._randPoint(def);
    const yaw = R() * Math.PI * 2;
    return {
      p, v: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(0.02), yaw, pitch: 0, roll: 0, yawRate: 0, bend: 0,
      goal: this._randPoint(def), timer: R() * 3, mode: 'swim', ph: R() * 6.28, spd: 0.8 + R() * 0.4,
      motion: new FishMotion(s.swim, { pectSwim: def.bottom || def.grazer ? 0.3 : 0.6, mode: 'slow', seed: R() }),
      cling: null, eat: 0,
      slot: new THREE.Vector3(), slotT: 0, burst: 0, glide: 0, burstT: 1 + R() * 3, flee: 0,
      hpref: R(), sub: 0,
    };
  }

  feed(n = 24) {
    const b = this._bounds();
    const cx = THREE.MathUtils.lerp(b.x0, b.x1, 0.3 + R() * 0.4), cz = THREE.MathUtils.lerp(b.z0, b.z1, 0.4 + R() * 0.3);
    for (let i = 0; i < n; i++) {
      this.food.push({ p: new THREE.Vector3(cx + (R() - 0.5) * 0.06, b.top - 0.002, cz + (R() - 0.5) * 0.04), vy: -0.004 - R() * 0.006, t: R() * 3, ph: R() * 6 });
    }
  }

  /** the filter current: out of the lily pipe (left back, near the top) across to the right, back low down */
  flowAt(p, out = new THREE.Vector3()) {
    const b = this._bounds(), H = Math.max(b.top, 0.1);
    const yk = (p.y / H) * 2 - 1;                       // -1 bottom .. 1 top
    const near = Math.exp(-((p.x - b.x0) ** 2 + (p.z - b.z0) ** 2) / 0.02);
    return out.set(0.012 * yk + 0.02 * near * Math.max(yk, 0), 0, 0.004 * Math.sin(p.x * 9 + 1.3) + 0.01 * near);
  }
  /** a tap on the glass / in the water: fish nearby bolt away, shoals tighten for a while */
  startle(point) {
    for (const s of this.schools.values()) {
      let hit = false;
      for (const m of s.members) {
        const d = m.p.distanceTo(point);
        if (d > 0.16) continue;
        hit = true;
        _V.subVectors(m.p, point).setY((m.p.y - point.y) * 0.4);
        if (_V.lengthSq() < 1e-8) _V.set(R() - 0.5, 0, R() - 0.5);
        m.flee = 0.5 + 0.4 * (1 - d / 0.16);
        m.fleeDir = _V.clone().normalize();
        m.burst = 0.3; m.glide = 0; m.cling = null;
      }
      if (hit) s.alarm = 3;
    }
  }

  update(dt, t) {
    dt = Math.min(dt, 0.05);
    const plantObs = this.ctx.plantObs ? this.ctx.plantObs() : [];
    const flow = new THREE.Vector3();
    const b = this._bounds(), soil = this.ctx.soil, obst = this.ctx.obstacles;
    // ---- food sinks with a little flutter; lands on the soil and lingers
    for (const f of this.food) {
      f.t += dt;
      const floor = soil.heightAt(f.p.x, f.p.z) + 0.002;
      if (f.t < 2.5) f.p.y = b.top - 0.002;             // floats a moment before soaking up
      else if (f.p.y > floor) { f.p.y = Math.max(floor, f.p.y + f.vy * dt); f.p.x += Math.sin(t * 2 + f.ph) * 0.004 * dt; }
    }
    this.food = this.food.filter((f) => f.t < 40 && !f.eaten);
    this.foodMesh.count = this.food.length;
    this.food.forEach((f, i) => { _M.makeTranslation(f.p.x, f.p.y, f.p.z); this.foodMesh.setMatrixAt(i, _M); });
    this.foodMesh.instanceMatrix.needsUpdate = true;

    // everyone who is not holding a place in a school: they keep apart from each other in 3D, across species
    this._loose = [];
    for (const s of this.schools.values()) {
      if (!s.im || (s.def.school > 0.5 && !s.def.patrol) || s.def.bottom || s.def.grazer) continue;
      for (const m of s.members) this._loose.push({ m, def: s.def, L: s.L });
    }
    for (const s of this.schools.values()) {
      if (!s.im || !s.members.length) continue;
      const def = s.def, L = s.L;
      // a big school splits into a few sub-shoals, each roaming its own band of the zone (they meet and part again)
      const nSub = def.school > 0.5 && !def.patrol && !def.bottom ? Math.max(1, Math.min(5, Math.round(s.members.length / 12))) : 1;
      if (!s.subs || s.subs.length !== nSub) {
        s.subs = Array.from({ length: nSub }, (_, k) => ({ goal: null, goalTo: null, t: 0, band: nSub > 1 ? k / (nSub - 1) : 0.5 }));
        s.members.forEach((m, k) => { m.sub = k % nSub; });
      }
      for (const sb of s.subs) {
        sb.t -= dt;
        if (!sb.goalTo || sb.t < 0) {
          sb.goalTo = this._randPoint(def, sb.goalTo || new THREE.Vector3());
          if (nSub > 1) {
            // each sub-shoal favours its own stretch of the tank (with overlap, so they still meet and mix)
            const k = s.subs.indexOf(sb), wx = (b.x1 - b.x0) / nSub;
            sb.goalTo.x = THREE.MathUtils.clamp(b.x0 + wx * (k + 0.5 + (R() - 0.5) * 1.6), b.x0 + 0.04, b.x1 - 0.04);
            // stay in this sub-shoal's height band (with overlap), so the school is layered rather than one slab
            const z0 = def.zone[0], z1 = def.zone[1], w = (z1 - z0) / nSub;
            const f = THREE.MathUtils.clamp(z0 + w * (sb.band * (nSub - 1) + 0.5 + (R() - 0.5) * 1.2), z0, z1);
            sb.goalTo.y = this._zoneY(def, sb.goalTo.x, sb.goalTo.z, f);
          }
          sb.t = 5 + R() * 8;
        }
        if (!sb.goal) sb.goal = sb.goalTo.clone();
        sb.goal.lerp(sb.goalTo, Math.min(1, dt * 0.35));
      }
      // school goal roams
      s.goalT = (s.goalT ?? 0) - dt;
      if (!s.goalTo || s.goalT < 0) { s.goalTo = this._randPoint(def, s.goalTo || new THREE.Vector3()); s.goalT = 5 + R() * 8; }
      if (!s.goal) s.goal = s.goalTo.clone();
      s.goal.lerp(s.goalTo, Math.min(1, dt * 0.35));
      s.alarm = Math.max(0, (s.alarm || 0) - dt);
      // body lengths per second, but a 13 cm river fish in a 60 cm tank can't cruise at 25 cm/s: cap the speed and
      // keep the school's spacing to a share of the tank
      const cruise = Math.min(L * (def.bottom ? 1.2 : def.school > 0.5 ? 1.5 : 0.9), 0.075) * def.speed;
      const room = Math.min(b.x1 - b.x0, (b.z1 - b.z0) * 2);
      const Ls = Math.min(L, room * 0.08);                // spacing length: body length, or less in a cramped tank
      s.members.forEach((m, i) => {
        const acc = _A.set(0, 0, 0);
        m.timer -= dt;
        let target = null, maxV = cruise * m.spd, hover = false;
        // ---- food: nearest flake within reach
        let food = null, fd = 1e9;
        for (const f of this.food) { if (f.eaten || f.t < 0.5) continue; const d = f.p.distanceToSquared(m.p); if (d < fd) { fd = d; food = f; } }
        if (food && fd < 0.35 * 0.35 && !(def.bottom && food.p.y > soil.heightAt(food.p.x, food.p.z) + 0.02)) {
          target = food.p; maxV = cruise * 2.2;
          if (fd < (L * 0.6) ** 2) { food.eaten = true; m.eat = 0.4; }
        }
        if (!target && def.grazer) {
          // otocinclus: stay stuck to a surface for a while, then pick another spot
          if (m.cling) {
            m.timer -= 0;
            if (m.timer < 0) { m.cling = null; m.goal = this._clingSpot(def, m.goal); m.timer = 6 + R() * 6; }
            else { m.v.multiplyScalar(0.8); this._pose(s, m, i, dt, t, true); return; }
          }
          target = m.goal;
          if (m.p.distanceTo(m.goal) < L * 0.4) { m.cling = { n: m.goal.userData?.n || new THREE.Vector3(0, 1, 0) }; m.timer = 5 + R() * 10; }
          else if (m.timer < -15) { m.goal = this._clingSpot(def, m.goal); m.timer = 6; }
        } else if (!target && def.bottom) {
          // corydoras: hop between spots on the soil, sometimes a dash to the surface for a gulp of air
          if (m.mode === 'air') { target = _V.set(m.p.x, b.top - 0.005, m.p.z); maxV = cruise * 2.5; if (m.p.y > b.top - 0.02) { m.mode = 'swim'; m.timer = 1; } }
          else {
            if (m.timer < 0) {
              if (R() < 0.04 && !def.perch) m.mode = 'air';
              else { m.goal.set(THREE.MathUtils.clamp(m.p.x + (R() - 0.5) * 0.15, b.x0 + 0.02, b.x1 - 0.02), 0, THREE.MathUtils.clamp(m.p.z + (R() - 0.5) * 0.1, b.z0 + 0.02, b.z1 - 0.02)); }
              if (def.perch) { m.pause = 1.5 + R() * 4; m.timer = m.pause + 0.5 + R() * 0.7; }    // sit, then one dart
              else { m.timer = 1.5 + R() * 4; m.pause = R() < 0.5 ? 1 + R() * 2 : 0; }
            }
            m.goal.y = soil.heightAt(m.goal.x, m.goal.z) + 0.01;
            target = m.goal;
            if (m.pause > 0) { m.pause -= dt; hover = true; m.forage = !def.perch; } else m.forage = false;
            // goby (perch): sits level on its fused pelvic fins, then darts to the next spot
            if (def.perch && m.pause <= 0) maxV = cruise * 2.4;
            else if (def.perch) m.v.multiplyScalar(Math.exp(-dt * 6));
          }
        } else if (!target && def.patrol) {
          // big river fish (oikawa, kawamutsu...): no fixed places in a school, they patrol the tank in long smooth
          // curves; a slowly drifting wander angle bends the course, the walls and the group do the rest
          m.wa = THREE.MathUtils.clamp((m.wa || 0) + (R() - 0.5) * dt * 4 - (m.wa || 0) * dt * 0.3, -1, 1);
          const a = m.yaw + m.wa * 0.9;
          target = _V.set(m.p.x + Math.cos(a) * L * 2, 0, m.p.z - Math.sin(a) * L * 2).clone();
          if (target.x < b.x0 + 0.05 || target.x > b.x1 - 0.05 || target.z < b.z0 + 0.04 || target.z > b.z1 - 0.04) {
            // the glass is coming up: start the turn toward open water early
            const toC = Math.atan2(-((b.z0 + b.z1) / 2 - m.p.z), (b.x0 + b.x1) / 2 - m.p.x);
            m.wa = THREE.MathUtils.clamp(m.wa + Math.sign(wrapPi(toC - m.yaw)) * dt * 3, -1, 1);
          }
          // each fish holds its own depth (re-chosen now and then where it is least crowded), not the zone's middle
          m.hT = (m.hT ?? R() * 10) - dt;
          if (m.hT < 0) { m.hpref = this._freeHeight(def, m); m.hT = 8 + R() * 10; }
          const hf = THREE.MathUtils.lerp(def.zone[0], def.zone[1], m.hpref) + Math.sin(t * 0.13 + m.ph) * 0.08 * (def.zone[1] - def.zone[0]);
          target.y = THREE.MathUtils.lerp(m.p.y, this._zoneY(def, m.p.x, m.p.z, hf), 0.5);
          maxV = cruise * (0.75 + 0.35 * Math.sin(t * 0.4 + m.ph * 3) ** 2) * m.spd;
        } else if (!target && def.school > 0.5) {
          m.slotT -= dt;
          if (m.slotT < 0) {
            const nIn = s.members.length / s.subs.length;
            const spread = Ls * (s.alarm > 0 ? 2.5 : (4 + 4 * (1 - def.school)) * (0.8 + 0.25 * Math.sqrt(nIn)));
            m.slot.set((R() - 0.5) * 2 * spread, (R() - 0.5) * spread * (0.45 + 0.04 * Math.min(nIn, 12)), (R() - 0.5) * 2 * spread * 0.7);
            m.slotT = 2 + R() * 4;
          }
          target = _A.copy((s.subs[m.sub] || s.subs[0]).goal).add(m.slot).clone();
          const tm = Math.min(L * 0.7, 0.05) + 0.01;      // keep the place inside the glass
          target.x = THREE.MathUtils.clamp(target.x, b.x0 + tm, b.x1 - tm);
          target.z = THREE.MathUtils.clamp(target.z, b.z0 + tm, b.z1 - tm);
          // arrived: take the next place in the school rather than circle the point (a fish can't stop on a dime)
          if (m.p.distanceToSquared(target) < (Ls * 1.2) ** 2) m.slotT = Math.min(m.slotT, 0.15);
          acc.set(0, 0, 0);
        } else if (!target) {
          // loner: wander between points in its zone, pausing to hover
          if (m.timer < 0 || m.p.distanceTo(m.goal) < L) {
            this._randPoint(def, m.goal);
            m.hpref = this._freeHeight(def, m);
            m.goal.y = this._zoneY(def, m.goal.x, m.goal.z, THREE.MathUtils.lerp(def.zone[0], def.zone[1], m.hpref));
            m.timer = 4 + R() * 8; m.pause = R() < 0.5 ? 1.5 + R() * 3 : 0;
          }
          target = m.goal;
          if (m.pause > 0) { m.pause -= dt; hover = true; }
        }
        // species habits
        m.act = null;
        if (def.id === 'betta' || def.id === 'apisto' || def.id === 'ram' || def.id === 'dwarfgourami' || def.id === 'pearlgourami') {
          // flaring: now and then a male stops near another fish (or its reflection in the glass) and spreads every fin
          m.flareT = (m.flareT ?? 6 + R() * 10) - dt;
          if (m.flareT < 0) { m.flare = 2.5 + R() * 2; m.flareT = 10 + R() * 14; }
          if (m.flare > 0) { m.flare -= dt; hover = true; m.act = 'flare'; }
        }
        if (def.id === 'molly' || def.id === 'platy' || def.id === 'siamese' || def.id === 'endlers' || def.id === 'guppy') {
          // pecking at algae on leaves, wood and the glass: short head-down nibbles
          m.pickT = (m.pickT ?? 3 + R() * 6) - dt;
          if (m.pickT < 0) { m.pick = 1.2 + R() * 1.6; m.pickT = 5 + R() * 8; }
          if (m.pick > 0) { m.pick -= dt; hover = true; m.act = 'pick'; }
        }
        if (def.id === 'dwarfpuffer' || def.id === 'honey' || def.id === 'betta') {
          // hovers and looks around in little turns instead of cruising
          if (R() < dt * 0.6) m.yawKick = (R() - 0.5) * 1.6;
        }
        // small fish swim in pulses: a quick burst of tail beats, then a short glide
        m.burstT -= dt;
        // (big fish cruise steadily instead)
        if (m.burstT < 0 && !hover && !def.grazer && !def.patrol) { m.burst = 0.18 + R() * 0.2; m.burstT = (def.school > 0.5 ? 1.2 : 2.5) + R() * 3; }
        if (m.burst > 0) { m.burst -= dt; if (m.burst <= 0) m.glide = 0.3 + R() * 0.5; maxV *= 1.8; }
        else if (m.glide > 0) { m.glide -= dt; }
        // seek
        _V.subVectors(target, m.p);
        const dist = _V.length();
        let want = hover ? 0.12 * cruise : Math.min(maxV, dist * 1.5 + cruise * 0.25);
        if (m.burst > 0) want = Math.max(want, maxV * 0.8);
        if (dist > 1e-4) acc.addScaledVector(_V.divideScalar(dist), want).sub(m.v).multiplyScalar(def.school > 0.5 && !food && !def.bottom ? 0.9 : 1.6);
        if (m.glide > 0) acc.multiplyScalar(0.15);          // coasting: hardly any thrust
        if (m.flee > 0) { m.flee -= dt; acc.addScaledVector(m.fleeDir, cruise * 14); maxV = cruise * 3.5; }
        if (def.bottom && m.mode !== 'air' && !food) acc.y += (soil.heightAt(m.p.x, m.p.z) + 0.008 - m.p.y) * 60 * cruise / L;
        // boids within the school
        if (def.school > 0.3) {
          const sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3(); let nb = 0;
          // a real shoal keeps ~1.5-2.5 body lengths between neighbours, more when relaxed, tighter when alarmed
          const personal = Math.max(Ls, L * 0.45) * (s.alarm > 0 ? 1.5 : 2.7);
          for (const o of s.members) {
            if (o === m) continue;
            const dx = m.p.x - o.p.x, dy = m.p.y - o.p.y, dz = m.p.z - o.p.z, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > (Ls * 6) ** 2) continue;
            nb++; ali.add(o.v); coh.add(o.p);
            if (d2 < personal * personal && d2 > 1e-10) {
              const d = Math.sqrt(d2), k = (1 - d / personal) * cruise * 3.2;
              sep.x += dx / d * k; sep.y += dy / d * k * 1.3; sep.z += dz / d * k;
            }
          }
          if (nb) {
            const alarm = s.alarm > 0 ? 2.2 : 1;
            const big = 1 / (1 + s.members.length / 25);         // big schools hold together more loosely
            ali.divideScalar(nb).sub(m.v).multiplyScalar(1.0 * def.school * alarm);
            coh.divideScalar(nb).sub(m.p);
            const far = coh.length();
            coh.multiplyScalar(far > personal * 1.5 ? 0.7 * def.school * alarm * (s.alarm > 0 ? 1 : big) : 0.1 * def.school);
            if (def.bottom) { coh.y = 0; ali.y = 0; }
            acc.add(ali).add(coh);
          }
          acc.add(sep);
        } else {
          for (const o of s.members) {
            if (o === m) continue;
            const dx = m.p.x - o.p.x, dz = m.p.z - o.p.z, d2 = dx * dx + dz * dz;
            if (d2 < (L * 1.8) ** 2 && d2 > 1e-8) acc.add(_V.set(dx, 0, dz).multiplyScalar(0.02 / d2));
          }
        }
        if (!(def.school > 0.5 && !def.patrol) && !def.bottom && !def.grazer) {
          for (const o of this._loose) {
            if (o.m === m) continue;
            const dx = m.p.x - o.m.p.x, dy = m.p.y - o.m.p.y, dz = m.p.z - o.m.p.z;
            // (spacing lengths capped by the tank: with raw body lengths two 13 cm river fish would want 36 cm and,
            // in a 60 cm tank, every big fish would be shoved sideways all the time and stall)
            const R2 = ((Ls + Math.min(o.L, Ls)) * 1.4) ** 2, d2 = dx * dx + dy * dy * 0.6 + dz * dz;
            if (d2 < R2 && d2 > 1e-8) {
              const k = (1 - d2 / R2) * cruise * 2.2;
              const inv = 1 / Math.sqrt(d2);
              acc.x += dx * inv * k; acc.z += dz * inv * k;
              acc.y += (dy === 0 ? (m.ph > 3 ? 1 : -1) * 0.3 : dy * inv) * k * 1.8;
            }
          }
        }
        // obstacles (stones, driftwood) and the tank walls
        // (clearance grows with the body only up to a few cm: a big fish inside a dozen overlapping zones of a branchy
        // driftwood would just spin on the spot; the summed push is capped for the same reason)
        const avoid = new THREE.Vector3();
        for (const o of obst) {
          const dx = m.p.x - o.c.x, dy = m.p.y - o.c.y, dz = m.p.z - o.c.z, d = Math.hypot(dx, dy, dz), rr = o.r + Math.min(L * 0.6, 0.025);
          // bottom dwellers slip around obstacles sideways instead of being lifted off the soil
          if (d < rr * 1.5 && d > 1e-5) avoid.addScaledVector(_V.set(dx, def.bottom ? 0 : dy * 0.6, dz).divideScalar(d), (rr * 1.5 - d) / rr * cruise * 6);
        }
        for (const pl of plantObs) {
          if (m.p.y > pl.top || def.bottom) continue;
          const dx = m.p.x - pl.x, dz = m.p.z - pl.z, d = Math.hypot(dx, dz), rr = pl.r + Math.min(L * 0.4, 0.016);
          if (d < rr && d > 1e-5) avoid.addScaledVector(_V.set(dx, 0, dz).divideScalar(d), (rr - d) / rr * cruise * 3);
        }
        if (avoid.length() > cruise * 6) avoid.setLength(cruise * 6);
        acc.add(avoid);
        const mg = Math.min(L * 0.7, 0.05), wall = (v, lo, hi) => (v < lo + mg ? (lo + mg - v) : 0) - (v > hi - mg ? (v - hi + mg) : 0);
        acc.x += wall(m.p.x, b.x0, b.x1) * 40 * cruise / mg * 0.7; acc.z += wall(m.p.z, b.z0, b.z1) * 40 * cruise / mg * 0.7;
        const floor = soil.heightAt(m.p.x, m.p.z) + (def.bottom ? 0.006 : 0.015);
        acc.y += wall(m.p.y, floor, b.top - 0.008) * 40 * cruise / mg * 0.7;
        // depth: a gentle seek of its own toward the target's height (the horizontal seek alone barely moves a fish up
        // or down when the target is mostly sideways, so everyone stayed at the height they were dropped in at)
        if (!def.bottom && !def.grazer && target) acc.y += THREE.MathUtils.clamp((target.y - m.p.y) * 2.2, -1, 1) * cruise * 1.4;
        // fish don't climb or dive steeply for long
        acc.y -= m.v.y * 0.8;
        // integrate
        const amax = cruise * (food ? 8 : 4);
        if (acc.length() > amax) acc.setLength(amax);
        m.v.addScaledVector(acc, dt);
        const vmax = maxV * 1.1;
        if (m.v.length() > vmax) m.v.setLength(vmax);
        // a fish goes where its head points: sideways slip and backing up bleed off (the longer the body, the faster),
        // so a change of mind becomes a turn instead of a skid
        {
          const fx = Math.cos(m.yaw), fz = -Math.sin(m.yaw), fwd = m.v.x * fx + m.v.z * fz;
          const k = Math.exp(-dt * (2 + 45 * L)), kb = fwd < 0 ? k : 1;
          const lx = m.v.x - fwd * fx, lz = m.v.z - fwd * fz;
          m.v.x = fwd * kb * fx + lx * k; m.v.z = fwd * kb * fz + lz * k;
        }
        (m.steer || (m.steer = new THREE.Vector3())).copy(acc);
        m.p.addScaledVector(m.v, dt);
        if (!def.bottom) m.p.addScaledVector(this.flowAt(m.p, flow), dt * 0.8);
        m.p.x = THREE.MathUtils.clamp(m.p.x, b.x0 + L * 0.3, b.x1 - L * 0.3);
        m.p.z = THREE.MathUtils.clamp(m.p.z, b.z0 + L * 0.3, b.z1 - L * 0.3);
        m.p.y = THREE.MathUtils.clamp(m.p.y, floor - 0.004, b.top - 0.004);
        this._pose(s, m, i, dt, t, false, hover);
      });
      s.im.instanceMatrix.needsUpdate = true;
      s.a.swim.needsUpdate = true; s.a.fin.needsUpdate = true;
      s.im.material.userData.u.uTime.value = t;
    }
  }

  _clingSpot(def, out = new THREE.Vector3()) {
    const b = this._bounds(), soil = this.ctx.soil;
    const k = R();
    if (k < 0.45) {        // front glass, low to mid height
      const x = THREE.MathUtils.lerp(b.x0 + 0.03, b.x1 - 0.03, R());
      out.set(x, THREE.MathUtils.lerp(soil.heightAt(x, b.z1) + 0.02, b.top - 0.04, R() * 0.8), b.z1 - 0.003);
      out.userData = { n: new THREE.Vector3(0, 0, -1), glass: true };
    } else if (k < 0.75 && this.ctx.obstacles.length) {
      const o = this.ctx.obstacles[Math.floor(R() * this.ctx.obstacles.length)];
      out.set(o.c.x, o.c.y + o.r, o.c.z);
      out.userData = { n: new THREE.Vector3(0, 1, 0) };
    } else {
      const x = THREE.MathUtils.lerp(b.x0 + 0.03, b.x1 - 0.03, R()), z = THREE.MathUtils.lerp(b.z0 + 0.03, b.z1 - 0.03, R());
      out.set(x, soil.heightAt(x, z) + 0.004, z);
      out.userData = { n: new THREE.Vector3(0, 1, 0) };
    }
    return out;
  }

  /** orientation + body/fin animation from the motion; still = clinging to a surface */
  _pose(s, m, i, dt, t, still, hover = false) {
    const def = s.def, L = s.L, mo = m.motion, sw = mo.swim;
    const ease = (v, tg, r) => v + (tg - v) * Math.min(1, dt * r);
    const hs = Math.hypot(m.v.x, m.v.z);
    // head toward where the fish is going AND where it is being pushed (velocity alone lags behind a turn)
    let headV = m.steer ? _V.copy(m.steer).multiplyScalar(0.25).add(m.v) : m.v;
    if (!still && hs < L * 0.35 && !def.bottom && Math.hypot(headV.x, headV.z) < L * 0.35) {
      // holding station (nowhere to go): face upstream into the filter current
      const f = this.flowAt(m.p);
      headV = new THREE.Vector3(-f.x, 0, -f.z).multiplyScalar(0.6).add(headV);
    }
    if (m.yawKick) { m.yaw = wrapPi(m.yaw + m.yawKick * dt * 3); m.yawKick *= Math.max(0, 1 - dt * 3); if (Math.abs(m.yawKick) < 0.02) m.yawKick = 0; }
    if (!still && Math.hypot(headV.x, headV.z) > L * 0.12) {
      const want = Math.atan2(-headV.z, headV.x);
      const err = wrapPi(want - m.yaw);
      const kmax = (def.school > 0.5 ? 9 : 4) * Math.min(1, 0.05 / L);      // long bodies turn more slowly
      m.yawRate = THREE.MathUtils.clamp(m.yawRate + (err * 30 - m.yawRate * 9) * dt, -kmax, kmax);
      m.yaw = wrapPi(m.yaw + m.yawRate * dt);
    } else m.yawRate *= 0.9;
    // (a long body changes depth on a level keel rather than nosing up and down)
    m.pitch = ease(m.pitch, still ? 0 : THREE.MathUtils.clamp(Math.atan2(m.v.y, Math.max(hs, L * 0.3)), -0.5, 0.5) * Math.min(1, 0.06 / L), 4);
    m.roll = ease(m.roll, THREE.MathUtils.clamp(-m.yawRate * 0.05, -0.3, 0.3), 4);
    const bls = m.v.length() / L;
    const turnK = Math.min(1, Math.abs(m.yawRate) / 6);
    const coast = m.glide > 0 ? 0.15 : 1;
    mo.amp = ease(mo.amp, still ? 0.12 : coast * Math.min(1.6, 0.35 + 0.5 * Math.min(bls, 2) + 0.5 * turnK + m.eat + (m.burst > 0 ? 0.5 : 0)), m.burst > 0 ? 10 : 4);
    mo.freq = ease(mo.freq, still ? 0.3 : 0.35 + 0.45 * Math.min(bls, 2.5) + 0.4 * turnK, 4);
    mo.tail += sw.freq * mo.freq * dt;
    const holding = 1 - THREE.MathUtils.smoothstep(bls, 0.3, 1.0);
    mo.open = ease(mo.open, 0.05 + 0.3 * holding, 5);
    mo.flapAmp = ease(mo.flapAmp, 0.5 * holding + 0.1 * turnK, 3);
    mo.flapHz = ease(mo.flapHz, 2.2 + 1.5 * holding, 3);
    mo.flap += mo.flapHz * dt;
    mo.dorsal = ease(mo.dorsal, (hover || still ? 0.9 : 0.25) + 0.4 * turnK + (m.act === 'flare' ? 0.8 : 0), 3);
    mo.pelvic = ease(mo.pelvic, 0.2 + 0.6 * holding + (m.act === 'flare' ? 0.7 : 0), 4);
    if (m.act === 'flare') { mo.open = ease(mo.open, 0.8, 6); mo.amp = ease(mo.amp, 0.45, 6); mo.freq = ease(mo.freq, 1.1, 6); }
    const bendT = THREE.MathUtils.clamp(m.yawRate / Math.max(m.v.length(), L * 0.5), -0.9 / L, 0.9 / L) + Math.sin(t * 0.7 + m.ph) * 0.04 / L;
    m.bend = ease(m.bend, bendT, 6);
    mo.bend = m.bend;
    mo.write(s.a, i);
    m.eat = Math.max(0, m.eat - dt);
    if (still && m.cling?.n && m.goal.userData?.glass) {
      // stuck to the front glass, head up, belly to the glass
      const f = new THREE.Vector3(Math.sin(m.ph) * 0.3, 1, 0).normalize(), n = m.goal.userData.n;
      const up = n.clone().negate();                   // back away from the glass
      const z = new THREE.Vector3().crossVectors(f, up).normalize();
      up.crossVectors(z, f);
      _M.makeBasis(f, up, z);
      _Q.setFromRotationMatrix(_M);
      // rasping algae off the glass: the head sways a little and the fish inches along
      _Q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin((t + m.ph) * 5) * 0.08));
      m.p.addScaledVector(f, Math.max(0, Math.sin((t + m.ph) * 0.7)) * L * 0.02 * dt);
    } else {
      // body attitude per habit: nose-down to the soil (foraging catfish / loaches) or to a leaf (nibblers),
      // the penguin tetra's head-up slant, a flaring fish holding level with a slight roll toward its rival
      let pitch = m.pitch, roll = m.roll;
      const t2 = t + m.ph;
      if (m.forage) { pitch = -0.55 + Math.sin(t2 * 9) * 0.06; m.p.y += Math.sin(t2 * 9) * L * 0.004; }
      else if (m.act === 'pick') pitch = -0.35 + Math.max(0, Math.sin(t2 * 7)) * 0.12;
      else if (s.def.id === 'penguin') pitch += 0.3;
      if (m.act === 'flare') roll = Math.sin(t2 * 1.3) * 0.18;
      fishQuat(m.yaw, false, _Q, pitch, roll);
    }
    s.im.setMatrixAt(i, _M.compose(m.p, _Q, _S));
  }
}
