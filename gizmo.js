// On-object handles for the selected stone / driftwood / plant: a ring on the ground around it with a rotate handle
// (drag around the ring) and a size handle (drag out = bigger, in = smaller). Drawn in the overlay scene so the
// tank's plants never hide them; handles keep a constant size on screen.
import * as THREE from 'three';

function iconTexture(name, bg) {
  const texture = new THREE.TextureLoader().load(`icons/gizmo-${name}.svg`);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Gizmo {
  constructor(overlay) {
    this.group = new THREE.Group(); this.group.visible = false; this.group.renderOrder = 20;
    overlay.add(this.group);
    // ring (line loop, 96 segments, unit radius; scaled per object)
    const pts = []; for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
    // the ring is a flat band (lines are 1 px wide in WebGL, too faint to notice)
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9ff5d2, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
    const rg = new THREE.RingGeometry(0.95, 1.0, 96, 1); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.renderOrder = 20;
    // dashed guide from the centre to the size handle
    this.spoke = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.006, gapSize: 0.004, transparent: true, opacity: 0.6, depthTest: false }));
    this.spoke.renderOrder = 20;
    const sprite = (glyph, bg) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(glyph, bg), depthTest: false, transparent: true }));
      s.renderOrder = 21;
      return s;
    };
    this.rotH = sprite('rotate-right', 'rgba(32,150,110,0.95)'); this.rotH.userData.handle = 'rotate';
    this.sizeH = sprite('expand', 'rgba(220,140,30,0.95)'); this.sizeH.userData.handle = 'size';
    this.group.add(this.ring, this.spoke, this.rotH, this.sizeH);
    this.center = new THREE.Vector3(); this.radius = 0.05; this.sizeOff = -Math.PI / 2; this.rotAngle = 0; this.showRotate = true;
    this.hot = null;
  }
  /** place the gizmo around a mesh (world bounds); rot = the item's current yaw */
  attach(mesh, { rotate = true } = {}) {
    if (!mesh) { this.group.visible = false; this.mesh = null; return; }
    this.mesh = mesh; this.showRotate = rotate;
    this.group.visible = true;
    this.refresh();
  }
  refresh() {
    const m = this.mesh; if (!m) return;
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
    box.getCenter(this.center); this.center.y = box.min.y + Math.min(size.y * 0.15, 0.01);
    this.baseRadius = this.radius = Math.max(0.025, Math.max(size.x, size.z) * 0.6);
    this.rotAngle = new THREE.Euler().setFromQuaternion(m.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    this.rotH.visible = this.showRotate;
    this.layoutRing();
  }
  /** ring and handles at this.radius; rotate handle follows the object's yaw, size handle sits sizeOff further round */
  layoutRing() {
    const yaw = this.rotAngle;
    this.ring.position.copy(this.center); this.ring.scale.setScalar(this.radius);
    this.rotH.position.set(this.center.x + Math.cos(-yaw) * this.radius, this.center.y, this.center.z + Math.sin(-yaw) * this.radius);
    const sa = -yaw + this.sizeOff;
    this.sizeH.position.set(this.center.x + Math.cos(sa) * this.radius, this.center.y, this.center.z + Math.sin(sa) * this.radius);
    this.spoke.position.copy(this.center);
    this.spoke.geometry.setFromPoints([new THREE.Vector3(), this.sizeH.position.clone().sub(this.center)]);
    this.spoke.computeLineDistances();
  }
  /** per frame: constant on-screen handle size, hover glow */
  update(camera, px = 36) {
    if (!this.group.visible) return;
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (innerHeight || 800);
    // small object or far camera (phones): widen the ring so the two handles never overlap (drags are ratio based)
    const rMin = camera.position.distanceTo(this.center) * h * px * 1.8;
    const r = Math.max(this.baseRadius, rMin);
    this.radius = r;
    // the size handle takes whichever spot (a quarter turn either way, or opposite) lands farthest from the rotate
    // handle on screen, so the two never stack when the ring is seen edge-on; it stays put while being dragged
    if (this.showRotate && this.hot !== 'size') {
      const scr = (a) => new THREE.Vector3(this.center.x + Math.cos(a) * r, this.center.y, this.center.z + Math.sin(a) * r).project(camera);
      const p0 = scr(-this.rotAngle), asp = camera.aspect || 1;
      const dist = (off) => { const p = scr(-this.rotAngle + off); return Math.hypot((p.x - p0.x) * asp, p.y - p0.y); };
      let best = this.sizeOff, bd = dist(best) * 1.2;
      for (const off of [-Math.PI / 2, Math.PI / 2, Math.PI]) { const d = dist(off); if (d > bd) { bd = d; best = off; } }
      this.sizeOff = best;
    }
    this.layoutRing();
    for (const s of [this.rotH, this.sizeH]) {
      const d = camera.position.distanceTo(s.position);
      s.scale.setScalar(d * h * px * (this.hot === s.userData.handle ? 1.25 : 1));
    }
    this.ringMat.opacity = this.hot ? 1 : 0.85;
  }
  /** which handle (if any) a raycaster hits */
  pick(ray) {
    if (!this.group.visible) return null;
    const list = [this.sizeH]; if (this.showRotate) list.push(this.rotH);
    const h = ray.intersectObjects(list, false)[0];
    return h ? h.object.userData.handle : null;
  }
}
