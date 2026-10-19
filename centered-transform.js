import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// A scene-space proxy keeps the pivot on the selected geometry, even when its
// authored origin is at the base or its parent is another hardscape object.
export class CenteredTransform {
  constructor(app, layout, commit) {
    this.app = app; this.layout = layout; this.commit = commit;
    app.controls.mouseButtons.LEFT = null;
    app.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    app.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.proxy = new THREE.Object3D(); app.scene.add(this.proxy);
    this.controls = new TransformControls(app.camera, app.renderer.domElement);
    this.controls.setSize(.85); this.controls.setSpace('world');
    this.group = this.controls.getHelper(); app.overlay.add(this.group);
    // Three r170 separates drag guides from the bounded, interactive gizmo.
    // Clone guide materials so suppressing them never hides shared axis handles.
    for (const guides of Object.values(this.controls._gizmo.helper)) {
      guides.traverse(node => {
        if (!node.material) return;
        const hide = material => { const copy = material.clone(); copy.visible = false; return copy; };
        node.material = Array.isArray(node.material) ? node.material.map(hide) : hide(node.material);
      });
    }
    this.center = new THREE.Vector3(); this.mode = 'translate';
    this.controls.addEventListener('mouseDown', () => this.begin());
    this.controls.addEventListener('objectChange', () => this.apply());
    this.controls.addEventListener('mouseUp', () => this.finish());
    this.controls.addEventListener('dragging-changed', e => { app.controls.enabled = !e.value; });
    const snap = e => {
      this.controls.setTranslationSnap(e.ctrlKey ? .01 : null);
      this.controls.setRotationSnap(e.ctrlKey ? Math.PI/12 : null);
      this.controls.setScaleSnap(e.ctrlKey ? .1 : null);
    };
    window.addEventListener('keydown',snap); window.addEventListener('keyup',snap);
    const el = app.renderer.domElement;
    el.addEventListener('pointermove', e => {
      this.pointer = {x:e.clientX,y:e.clientY};
      if (!this.modal) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.moveModal(e);
    }, true);
    el.addEventListener('pointerdown', e => {
      if (!this.modal) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.finish(e.button === 2);
    }, true);
  }
  pick() { return null; } // Replaces the legacy ground-ring pick interface.
  get busy() { return !!this.start; }
  attach(mesh) {
    if (this.busy) this.finish(true);
    this.mesh = mesh;
    if (!mesh) { this.controls.detach(); return; }
    this.refresh(); this.controls.attach(this.proxy); this.setMode(this.mode);
  }
  refresh() {
    if (!this.mesh || this.busy) return;
    this.mesh.updateWorldMatrix(true, false);
    const box = this.mesh.geometry ? (this.mesh.geometry.computeBoundingBox(), this.mesh.geometry.boundingBox.clone().applyMatrix4(this.mesh.matrixWorld)) : new THREE.Box3().setFromObject(this.mesh);
    box.getCenter(this.center);
    this.proxy.position.copy(this.center); this.proxy.quaternion.identity(); this.proxy.scale.setScalar(1); this.proxy.updateMatrixWorld(true);
  }
  update() { this.controls.enabled = !!this.mesh && !this.modal && !document.body.classList.contains('view'); }
  setMode(mode) {
    this.mode = mode; this.controls.setMode(mode); this.controls.axis = null;
    document.querySelectorAll('[data-transform]').forEach(b => b.classList.toggle('on', b.dataset.transform === mode));
  }
  begin() {
    if (!this.mesh || this.start) return;
    this.mesh.updateWorldMatrix(true, false); this.proxy.updateMatrixWorld(true);
    const item = this.layout.items.get(this.mesh.userData.uid)?.item;
    if (!item) return;
    this.start = { world:this.mesh.matrixWorld.clone(), local:this.mesh.matrix.clone(), proxy:this.proxy.matrixWorld.clone(), item:structuredClone(item), parent:this.mesh.parent, position:this.proxy.position.clone() };
    this.app.controls.enabled = false;
  }
  apply() {
    if (!this.start || !this.mesh) return;
    this.proxy.updateMatrixWorld(true);
    const world = this.proxy.matrixWorld.clone().multiply(this.start.proxy.clone().invert()).multiply(this.start.world);
    this.mesh.parent.updateWorldMatrix(true, false);
    const local = this.mesh.parent.matrixWorld.clone().invert().multiply(world);
    local.decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
    this.mesh.quaternion.normalize();
    this.mesh.updateMatrix();
    // World-axis non-uniform scale can introduce shear; Object3D stores TRS.
    // Preserve the exact geometric pivot after decomposition into that format.
    if (this.mesh.geometry) {
      this.mesh.geometry.computeBoundingBox();
      const center = this.mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
      const expected = center.clone().applyMatrix4(local);
      const actual = center.applyMatrix4(this.mesh.matrix);
      this.mesh.position.add(expected.sub(actual));
    }
    this.mesh.updateMatrixWorld(true);
    const item = this.layout.items.get(this.mesh.userData.uid).item;
    item.transform = this.mesh.matrix.toArray();
    if (!item.host) { item.x = this.mesh.position.x; item.z = this.mesh.position.z; }
  }
  finish(cancel = false) {
    if (!this.start) return;
    const o = this.layout.items.get(this.mesh?.userData.uid);
    if (cancel && o) {
      for (const key of Object.keys(o.item)) delete o.item[key];
      Object.assign(o.item, this.start.item); this.layout.place(o.item.uid);
      this.start.local.decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale); this.mesh.updateMatrixWorld(true);
    }
    this.start = null; this.modal = null; this.controls.enabled = true;
    this.controls.dragging = false; this.controls.axis = null; this.app.controls.enabled = true;
    this.refresh();
    if (!cancel) {
      this.layout.rebuildObstacles();
      for (const c of this.app.plants.carpets.values()) c.dirty = true;
      this.layout.changed(); this.commit();
    }
  }
  keyDown(e) {
    if (!this.mesh || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,[contenteditable=true]')) return false;
    const key = e.key.toLowerCase();
    if (this.busy && ['escape','enter'].includes(key)) { e.preventDefault(); this.finish(key === 'escape'); return true; }
    if (this.modal && ['x','y','z'].includes(key)) { e.preventDefault(); this.modal.axis = this.modal.axis === key ? null : key; return true; }
    if (!['w','e','r'].includes(key)) return false;
    e.preventDefault(); if (this.busy) this.finish();
    this.setMode({w:'translate',e:'rotate',r:'scale'}[key]); this.begin();
    if (!this.start) return true;
    const el = this.app.renderer.domElement, rect = el.getBoundingClientRect();
    this.modal = { pointer:this.pointer || {x:rect.left+rect.width/2,y:rect.top+rect.height/2}, axis:null };
    this.controls.enabled = false; return true;
  }
  moveModal(e) {
    const {camera,renderer} = this.app, m = this.modal;
    const dx = e.clientX-m.pointer.x, dy = e.clientY-m.pointer.y, fine = e.shiftKey ? .1 : 1;
    const right = new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    const axis = m.axis ? new THREE.Vector3(...({x:[1,0,0],y:[0,1,0],z:[0,0,1]}[m.axis])) : null;
    this.proxy.position.copy(this.start.position); this.proxy.quaternion.identity(); this.proxy.scale.setScalar(1);
    if (this.mode === 'translate') {
      const units = 2*camera.position.distanceTo(this.center)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/renderer.domElement.clientHeight;
      const delta = right.multiplyScalar(dx*units).addScaledVector(up,-dy*units);
      if (axis) {
        const screenX = new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion).dot(axis);
        const screenY = new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).dot(axis);
        const lengthSq = screenX*screenX+screenY*screenY;
        const distance = lengthSq > .02 ? (dx*screenX-dy*screenY)*units/lengthSq : -dy*units;
        delta.copy(axis.clone().multiplyScalar(distance));
      }
      delta.multiplyScalar(fine);
      if (e.ctrlKey) { delta.x=Math.round(delta.x/.01)*.01; delta.y=Math.round(delta.y/.01)*.01; delta.z=Math.round(delta.z/.01)*.01; }
      this.proxy.position.add(delta);
    } else if (this.mode === 'rotate') {
      const projected = this.center.clone().project(camera), rect = renderer.domElement.getBoundingClientRect();
      const cx=rect.left+(projected.x+1)*rect.width/2, cy=rect.top+(1-projected.y)*rect.height/2;
      let angle = (Math.atan2(m.pointer.y-cy,m.pointer.x-cx)-Math.atan2(e.clientY-cy,e.clientX-cx))*fine;
      if (e.ctrlKey) angle=Math.round(angle/(Math.PI/12))*(Math.PI/12);
      this.proxy.quaternion.setFromAxisAngle(axis || camera.getWorldDirection(new THREE.Vector3()).negate(),angle);
    } else {
      let scale = Math.max(.05,Math.min(20,Math.exp((dx-dy)*.008*fine)));
      if (e.ctrlKey) scale=Math.max(.1,Math.round(scale*10)/10);
      if (axis) this.proxy.scale.set(1+axis.x*(scale-1),1+axis.y*(scale-1),1+axis.z*(scale-1));
      else this.proxy.scale.setScalar(scale);
    }
    this.apply();
  }
}
