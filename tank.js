// The tank (rimless glass box, silicone seams), the lamp, the cabinet, the background screen and a dim room.
// Interior floor = y 0, x/z centred. Glass panes are drawn in a separate overlay scene after the water pass.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { U } from './shaders.js';

export const BACKGROUNDS = [
  { id: 'white', name: '白色（背光）' },
  { id: 'black', name: '黑色' },
  { id: 'blue', name: '蓝色渐变' },
  { id: 'none', name: '无（显示房间）' },
];

const glassVS = /* glsl */`
varying vec3 vN, vW, vO;
void main() {
  vN = normalize(mat3(modelMatrix) * normal); vO = normal;
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const glassFS = /* glsl */`
uniform vec3 uAxis;          // the pane's thin axis (object space)
uniform vec3 uOut;           // outward direction of the pane (world)
uniform float uLamp;
varying vec3 vN, vW, vO;
// dim room seen in the glass: dark walls, a soft ceiling glow, a bright strip where the lamp is
vec3 roomEnv(vec3 r) {
  vec3 c = mix(vec3(0.012, 0.012, 0.014), vec3(0.04, 0.042, 0.046), smoothstep(-0.2, 0.6, r.y));
  c += vec3(0.25, 0.26, 0.27) * smoothstep(0.92, 0.99, r.y) * uLamp;
  c += vec3(0.06) * smoothstep(0.6, 0.0, abs(r.x)) * smoothstep(0.3, 0.8, r.y);
  return c;
}
void main() {
  vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
  float edge = abs(dot(normalize(vO), uAxis)) < 0.5 ? 1.0 : 0.0;
  if (edge > 0.5) {
    // looking into the glass edge-on: the iron in float glass turns it deep green
    float f = pow(1.0 - abs(dot(n, v)), 2.0);
    gl_FragColor = vec4(vec3(0.05, 0.11, 0.09) * 0.6 + roomEnv(reflect(-v, n)) * 0.4, 0.82 - 0.2 * f);
    return;
  }
  // inner faces (seen from inside through the water) are left to the water pass
  if (dot(n, uOut) < 0.0) discard;
  float cosT = abs(dot(n, v));
  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  vec3 refl = roomEnv(reflect(-v, n)) * F;
  // a faint green cast that grows at grazing angles (longer path through the glass)
  float a = F + 0.03 + 0.06 * (1.0 - cosT);
  gl_FragColor = vec4(refl + vec3(0.0, 0.004, 0.003), a);
}`;

// Solid charcoal cabinet with a soft matte finish.
function cabinetMaterial(width) {
  return new THREE.MeshStandardMaterial({ color: 0x202529, roughness: 0.68, metalness: 0 });
}

export class Tank {
  constructor(scene, overlayScene) {
    this.scene = scene; this.overlay = overlayScene;
    this.group = new THREE.Group(); scene.add(this.group);
    this.glassGroup = new THREE.Group(); overlayScene.add(this.glassGroup);
    this.room = new THREE.Group(); scene.add(this.room);
    this.bgMode = 'white';
    this.lampOn = 1;
    this.light = new THREE.DirectionalLight(0xfff4e6, 3.2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0006;
    this.light.shadow.normalBias = 0.002;
    this.light.shadow.radius = 6;
    scene.add(this.light, this.light.target);
    this.hemi = new THREE.HemisphereLight(0xe8f2f0, 0x3a3226, 0.35);
    scene.add(this.hemi);
    this._buildRoom();
  }

  _buildRoom() {
    const wallM = new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.95, envMapIntensity: 0.3 });
    const floorM = new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 0.7 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), wallM);
    wall.position.set(0, 1.5, -1.1);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), floorM);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.75;
    wall.receiveShadow = floor.receiveShadow = true;
    this.room.add(wall, floor);
    this.wall = wall;
  }

  build(def) {
    this.def = def;
    const g = def.glass;
    for (const grp of [this.group, this.glassGroup]) while (grp.children.length) { const c = grp.children.pop(); c.geometry?.dispose(); }
    const W = def.w, D = def.d, H = def.h;
    this.inner = { x0: -W / 2 + g, x1: W / 2 - g, z0: -D / 2 + g, z1: D / 2 - g, y0: 0, top: H - g };
    this.waterY = H - g - Math.min(0.025, H * 0.07);
    U.uWaterY.value = this.waterY;
    U.uTankMin.value.set(this.inner.x0, 0, this.inner.z0);
    U.uTankMax.value.set(this.inner.x1, this.waterY, this.inner.z1);

    // glass panes (overlay): front, back, left, right, bottom
    const mk = (sx, sy, sz, x, y, z, axis) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uAxis: { value: axis }, uOut: { value: new THREE.Vector3(Math.sign(x) * axis.x, 0, Math.sign(z) * axis.z) }, uLamp: { value: 1 } }, vertexShader: glassVS, fragmentShader: glassFS,
        transparent: true, depthWrite: false, depthTest: false, side: THREE.FrontSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
      mesh.position.set(x, y, z);
      this.glassGroup.add(mesh);
      return mesh;
    };
    const yc = (H - g) / 2 - g / 2, hh = H;
    mk(W, hh, g, 0, yc, D / 2 - g / 2, new THREE.Vector3(0, 0, 1));
    mk(W, hh, g, 0, yc, -D / 2 + g / 2, new THREE.Vector3(0, 0, 1));
    mk(g, hh, D - 2 * g, -W / 2 + g / 2, yc, 0, new THREE.Vector3(1, 0, 0));
    mk(g, hh, D - 2 * g, W / 2 - g / 2, yc, 0, new THREE.Vector3(1, 0, 0));
    // bottom pane: opaque-ish, sits on the cabinet
    const bot = new THREE.Mesh(new THREE.BoxGeometry(W, g, D), new THREE.MeshStandardMaterial({ color: 0x0d1512, roughness: 0.2 }));
    bot.position.y = -g / 2; bot.receiveShadow = true;
    this.group.add(bot);

    // silicone seams along the inner vertical corners and the floor edges (dark, slightly glossy)
    const sil = new THREE.MeshStandardMaterial({ color: 0x0a0b0b, roughness: 0.35, transparent: true, opacity: 0.85 });
    const s = 0.0035;
    for (const [x, z] of [[this.inner.x0, this.inner.z0], [this.inner.x1, this.inner.z0], [this.inner.x0, this.inner.z1], [this.inner.x1, this.inner.z1]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, H - g, s), sil);
      m.position.set(x - Math.sign(x) * s * 0.3, (H - g) / 2, z - Math.sign(z) * s * 0.3);
      this.group.add(m);
    }

    // cabinet: solid charcoal finish
    const cabM = cabinetMaterial(W + 0.06);
    const cab = new THREE.Mesh(new RoundedBoxGeometry(W + 0.06, 0.75 - g, D + 0.08, 3, 0.006), cabM);
    cab.position.set(0, -g - (0.75 - g) / 2, 0);
    cab.receiveShadow = true;
    this.group.add(cab);
    const mat = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, 0.004, D + 0.002), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }));
    mat.position.y = -g - 0.002;
    this.group.add(mat);

    // lamp: slim anodised aluminium LED bar on two arms resting on the side glass; rows of LED chips behind a
    // frosted diffuser strip. Hidden while looking straight down from above (it would cover the tank).
    const lampY = H + 0.11;
    this.lampY = lampY;
    this.lampGroup = new THREE.Group();
    this.group.add(this.lampGroup);
    const alu = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.4 });
    const LW = W * 0.92, LD = Math.min(0.12, D * 0.45);
    const body = new THREE.Mesh(new RoundedBoxGeometry(LW, 0.016, LD, 3, 0.005), alu);
    body.position.set(0, lampY, 0);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(LW * 0.97, 0.004, LD * 0.6), new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.8 }));
    fin.position.set(0, lampY + 0.009, 0);                       // heat-sink ridge on top
    const led = new THREE.Mesh(new THREE.PlaneGeometry(LW * 0.95, LD * 0.8), this._ledMaterial(LW * 0.95, LD * 0.8));
    led.rotation.x = Math.PI / 2; led.position.set(0, lampY - 0.0082, 0);
    this.ledMesh = led;
    this.lampGroup.add(body, fin, led);
    // a leg at each end: from an end cap on the bar, angled out and down to a rubber foot on the side glass
    const capM = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.55 });
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new RoundedBoxGeometry(0.016, 0.02, LD * 0.55, 2, 0.004), capM);
      cap.position.set(sx * (LW / 2 + 0.004), lampY, 0);
      const top = new THREE.Vector3(sx * (LW / 2 + 0.006), lampY - 0.006, 0), bot = new THREE.Vector3(sx * (W / 2 - g / 2), H + 0.012, 0);
      const len = top.distanceTo(bot);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, len, 12), alu);
      arm.position.copy(top).add(bot).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bot.clone().sub(top).normalize());
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.024, 0.014, 0.03, 2, 0.003), capM);
      foot.position.set(sx * (W / 2 - g / 2), H + 0.006, 0);
      this.lampGroup.add(cap, arm, foot);
    }

    // background screen behind the back glass
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this._bgMaterial());
    this.bg.position.set(0, H / 2 - g, -D / 2 - 0.004);
    this.bg.layers.enable(1);
    this.group.add(this.bg);
    this.setBackground(this.bgMode);

    // lamp: shadow camera hugs the tank
    const L = this.light, dir = U.uLightDir.value;
    L.target.position.set(0, 0, 0);
    L.position.copy(dir).multiplyScalar(-1.2);
    const sc = L.shadow.camera;
    const R = Math.max(W, D) * 0.62 + 0.05;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.3; sc.far = 2.4;
    sc.updateProjectionMatrix();
    L.shadow.needsUpdate = true;
  }

  _ledMaterial(w, d) {
    return new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(1, 0.97, 0.92) }, uOn: { value: 1 }, uSize: { value: new THREE.Vector2(w, d) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform vec3 uCol; uniform float uOn; uniform vec2 uSize;
        void main(){
          // LED chips every 12 mm in 3 rows, each a hot core with a soft halo in the frosted cover
          vec2 p = vUv * uSize;
          vec2 cell = vec2(0.012, uSize.y / 3.0);
          vec2 q = mod(p, cell) - cell * 0.5;
          float r = length(q / vec2(1.0, 1.4));
          float chip = exp(-r * r / 0.0000035) * 14.0 + exp(-r * r / 0.00004) * 3.0;
          float edge = smoothstep(0.0, 0.004, min(min(p.x, uSize.x - p.x), min(p.y, uSize.y - p.y)));
          vec3 c = uCol * (2.2 + chip) * edge * uOn;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
  }

  /** per frame: hide the lamp while the camera looks down from right above it */
  update(camera) {
    if (!this.lampGroup || !this.def) return;
    const p = camera.position, d = this.def;
    const over = p.y > this.lampY - 0.02 && Math.abs(p.x) < d.w * 0.6 && Math.abs(p.z) < d.d * 0.5 + 0.25;
    this.lampGroup.visible = !over;
  }

  _bgMaterial() {
    const m = new THREE.ShaderMaterial({
      uniforms: { uMode: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uMode;
        void main(){
          vec3 c;
          if (uMode < 0.5) {           // frosted white screen lit from behind: brighter in the middle and higher up
            float g = smoothstep(-0.1, 1.0, vUv.y) * 0.6 + 0.4;
            float m = 1.0 - 0.35 * pow(abs(vUv.x - 0.5) * 2.0, 2.0);
            c = vec3(0.86, 0.93, 0.98) * g * m * 1.25;
          } else if (uMode < 1.5) c = vec3(0.006);
          else c = mix(vec3(0.0, 0.03, 0.08), vec3(0.18, 0.5, 0.85), pow(vUv.y, 1.3)) * 0.9;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    return m;
  }

  setBackground(id) {
    this.bgMode = id;
    this.onBg?.(id);
    if (!this.bg) return;
    this.bg.visible = id !== 'none';
    this.bg.material.uniforms.uMode.value = { white: 0, black: 1, blue: 2 }[id] ?? 0;
  }

  /** lamp colour: white (6500K-ish), warm, or RGB plant light (pushes reds and greens) */
  setLampColor(id) {
    this.lampColorId = id;
    this.lampColor = { white: [1, 0.97, 0.92], warm: [1, 0.86, 0.68], rgb: [1, 0.9, 1.0], blue: [0.8, 0.92, 1.0] }[id] || [1, 0.97, 0.92];
    this.setLamp(this.lampOn);
  }
  setLamp(on) {
    this.lampOn = on;
    const c = this.lampColor || [1, 0.97, 0.92];
    this.light.intensity = 3.2 * on;
    this.light.color.setRGB(c[0], c[1] * 0.98, c[2] * 0.94);
    this.ledMesh.material.uniforms.uCol.value.setRGB(c[0], c[1], c[2]);
    this.ledMesh.material.uniforms.uOn.value = on;
    this.glassGroup.children.forEach((m) => { if (m.material.uniforms) m.material.uniforms.uLamp.value = on; });
  }
}
