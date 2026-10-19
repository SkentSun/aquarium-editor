import * as THREE from 'three';

// Preserve each generated clump's geometry and edit target while sharing the GPU submission.
// WEBGL_multi_draw is required; browsers without it keep the original editable meshes.
export class PlantBatches {
  constructor(app, layout, plants) {
    this.app = app; this.layout = layout; this.plants = plants;
    this.supported = app.renderer.extensions.has('WEBGL_multi_draw');
    this.entries = []; this.mesh = null;
  }
  dispose() {
    if (this.mesh) { this.mesh.parent?.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
    for (const e of this.entries) e.source.visible = true;
    this.entries = [];
  }
  update() {
    if (!this.supported) return;
    const sources = [...this.layout.items.values()].filter(o => o.item.kind === 'plant').map(o => o.mesh);
    if (sources.length !== this.entries.length || sources.some((m,i) => m !== this.entries[i]?.source)) {
      this.dispose();
      if (sources.length < 2) return;
      const vertices = sources.reduce((s,m) => s + m.geometry.attributes.position.count, 0);
      const indices = sources.reduce((s,m) => s + (m.geometry.index?.count || 0), 0);
      const indexed = !!sources[0].geometry.index;
      if (sources.some(m => !!m.geometry.index !== indexed)) return;
      const batch = new THREE.BatchedMesh(sources.length, vertices, indices, this.plants.mat);
      batch.customDepthMaterial = this.plants.mat.userData.depth;
      batch.castShadow = true; batch.receiveShadow = true; batch.layers.enable(1);
      batch.frustumCulled = false; batch.perObjectFrustumCulled = false; batch.sortObjects = false;
      batch.userData.plantBatch = true;
      for (const source of sources) {
        const geometryId = batch.addGeometry(source.geometry);
        const id = batch.addInstance(geometryId);
        this.entries.push({ source, id, previous: new THREE.Matrix4().makeScale(0,0,0), shown: null });
      }
      this.mesh = batch; this.app.scene.add(batch);
    }
    if (!this.mesh) return;
    let triangles = 0, count = 0;
    for (const e of this.entries) {
      const source = e.source;
      source.updateWorldMatrix(true, false);
      // Highlighted / selected / dragged plants retain their ordinary mesh and material.
      const included = source.material === this.plants.mat;
      source.visible = !included;
      if (included !== e.shown) { this.mesh.setVisibleAt(e.id, included); e.shown = included; }
      if (!source.matrixWorld.equals(e.previous)) {
        this.mesh.setMatrixAt(e.id, source.matrixWorld); e.previous.copy(source.matrixWorld);
      }
      if (included) { triangles += (source.geometry.index?.count ?? source.geometry.attributes.position.count) / 3; count++; }
    }
    this.mesh.userData.activeTriangles = triangles;
    this.mesh.userData.activePlants = count;
    this.mesh.visible = count > 0;
  }
}
