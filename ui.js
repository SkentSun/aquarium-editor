import * as THREE from 'three';
import { PlantBatches } from './plant-batches.js';
import { TANKS, SOILS, STONES, STONE_SIZES, WOODS, WOOD_SIZES, PLANTS, FISH, FISH_GROUPS } from './catalog.js?v=names1';
import { BACKGROUNDS } from './tank.js';
import { Plants, HI_COL } from './plants.js';
import { Fishes } from './fish.js';
import { Layout } from './layout.js?v=navigation12';
import { makeStone } from './rocks.js';
import { makeWood } from './wood.js';
import { setTank, viewPreset, setQuality, QUALITY } from './main.js?v=navigation12';
import { U } from './shaders.js';
import { PRESETS, presetState } from './presets.js?v=navigation12';
import { Effects } from './fx.js';
import { CenteredTransform } from './centered-transform.js?v=navigation12';
import { initStudioDock } from './mobile.js?v=navigation12';
import { Inverts, INVERTS, makeInvertMesh } from './invert.js?v=names1';

const $ = (s) => document.querySelector(s);
const byId = (arr, id) => arr.find((x) => x.id === id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let app, layout, plants, fishes;
const ui = {
  tab: 'soil', tool: 'select', toolArg: null, brush: { r: 0.03, k: 0.6 }, stoneSize: 'm', woodSize: 'm',
  sel: null, ghost: null, ghostSeed: 1, hist: [], fut: [], thumbs: {},
};
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
ray.layers.enableAll();

// ---------------------------------------------------------------- boot
export async function initUI(_app, progress) {
  app = _app;
  plants = new Plants(app.scene);
  plants.renderDensity = QUALITY[app.quality].carpetDensity;
  await plants.init(PLANTS);
  progress(0.3);
  fishes = new Fishes(app.scene, { soil: app.soil, tank: app.tank, obstacles: [] });
  layout = new Layout(app, plants, fishes);
  const inverts = new Inverts(app.scene, { soil: app.soil, tank: app.tank, obstacles: null });
  layout.inverts = inverts; app.inverts = inverts;
  // only list the fish whose model has been built
  ui.fishAvail = new Set(["aburahaya", "angel", "apisto", "baratanago", "betta", "blackneon", "boraras", "bristlenose", "cardinal", "cory", "discus", "dojo", "dwarfgourami", "dwarfpuffer", "ember", "endlers", "espei", "glowlight", "greenneon", "guppy", "hanabi", "harlequin", "honey", "kawabata", "kawamutsu", "kuhli", "medaka", "molly", "motsugo", "neon", "oikawa", "oto", "pearlgourami", "penguin", "platy", "ram", "redphantom", "rummynose", "ryukin", "shimadojo", "siamese", "yaritanago", "yoshinobori", "zebra"]);
  fishes.ctx.obstacles = layout.obstacles;
  inverts.ctx.obstacles = layout.obstacles;
  fishes.ctx.plantObs = () => layout.plantObs || [];
  app.layout = layout; app.plants = plants; app.fishes = fishes; app.ui = ui;
  app.plantBatches = new PlantBatches(app, layout, plants);
  ui.refreshSummary = () => refreshSummary();
  const fx = new Effects(app);
  app.fx = fx;
  app.onTank = [() => { plants.resetCarpets(); fx.build(app.tank); }];
  ui.gizmo = new CenteredTransform(app, layout, pushHist);
  fx.build(app.tank);
  app.tank.onBg = (id) => fx.setBackground(id);
  layout.listeners.push(() => { fx.co2 = !!layout.settings.co2; });
  app.onFrame.push((dt, t) => {
    if (ui.sel && !isView()) { ui.gizmo.refresh(); ui.gizmo.update(app.camera); }
    else ui.gizmo.group.visible = false;
    fishes.update(dt, t);
    inverts.update(dt, t);
    fx.update(dt, t);
    if (ui.tool !== 'brush') ring.visible = false;
    let carpetsRebuilt = false;
    for (const c of plants.carpets.values()) if (c.dirty && !ui.painting) { plants.rebuildCarpet(c, app.soil, carpetAvoid); carpetsRebuilt = true; }
    if (carpetsRebuilt) layout.rebuildCanopy();
    app.plantBatches.update();
  });
  layout.listeners.push(refreshSummary);
  buildTop();
  buildTabs();
  initStudioDock(app, ui, { setTool, toolName, select, setView });
  setupPointer();
  setupKeys();
  progress(0.5);
  await makeThumbs();
  progress(0.8);
  // start from a shared link, the last session, or the first preset
  const fromHash = await readHash();
  // ?fresh: start from the preset and never touch the autosave (for a second tab / kiosk use)
  const initialParams = new URLSearchParams(location.search);
  const previewPreset = PRESETS.find(p => p.id === initialParams.get('preview'));
  const fresh = initialParams.has('fresh') || !!previewPreset;
  let saved = null;
  try { if (!fresh) saved = JSON.parse(localStorage.getItem('aqua.autosave') || 'null'); } catch { }
  if (previewPreset) await applyPreset(previewPreset);
  else if (fromHash) await layout.load(fromHash, setTank);
  else if (saved) await layout.load(saved, setTank);
  else await applyPreset(PRESETS[0]);
  // Apply the requested initial appearance; controls remain editable afterward.
  setQuality('high', { save: true });
  layout.settings.lampColor = 'white';
  layout.settings.lamp = 0.6;
  app.tank.setLampColor('white');
  app.tank.setLamp(0.6);
  $('#tankSel').value = layout.settings.tank;
  viewPreset('front', true);
  if(previewPreset) { document.body.classList.add('preset-capture'); app.setInset({x:0,y:0}); }
  pushHist();
  renderTab();
  refreshSummary();
  hint();
  if (!fresh) setInterval(() => { try { localStorage.setItem('aqua.autosave', JSON.stringify(layout.serialize())); } catch { } }, 8000);
  if (app.mobile && app.autoQuality) setTimeout(() => toast('当前使用适合手机和平板的流畅模式（可在环境选项中修改）', 4500), 800);
}

function carpetAvoid(x, z) {
  for (const { item, mesh } of layout.items.values()) {
    if (item.kind !== 'stone') continue;
    const r = item.size * (item.scale || 1) * 0.42;
    if ((x - mesh.position.x) ** 2 + (z - mesh.position.z) ** 2 < r * r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- history
function pushHist() {
  ui.hist.push(JSON.stringify(layout.serialize()));
  if (ui.hist.length > 40) ui.hist.shift();
  ui.fut.length = 0;
  ui.updateHistory?.();
}
async function undo() {
  if (ui.hist.length < 2) return;
  ui.fut.push(ui.hist.pop());
  await layout.load(JSON.parse(ui.hist[ui.hist.length - 1]), setTank);
  select(null); renderTab(); toast('已撤销'); ui.updateHistory?.();
}
async function redo() {
  if (!ui.fut.length) return;
  const s = ui.fut.pop();
  ui.hist.push(s);
  await layout.load(JSON.parse(s), setTank);
  select(null); renderTab(); toast('已重做'); ui.updateHistory?.();
}

// ---------------------------------------------------------------- top bar
function buildTop() {
  const sel = $('#tankSel');
  sel.innerHTML = TANKS.map((t) => `<option value="${t.id}">${t.name}（${Math.round(t.w * 100)}×${Math.round(t.d * 100)}×${Math.round(t.h * 100)}）</option>`).join('');
  sel.onchange = async () => {
    const st = layout.serialize();
    st.settings.tank = sel.value;
    // keep the layout proportional to the new tank
    const a = byId(TANKS, layout.settings.tank), b = byId(TANKS, sel.value);
    const kx = (b.w - 2 * b.glass) / (a.w - 2 * a.glass), kz = (b.d - 2 * b.glass) / (a.d - 2 * a.glass), ks = Math.sqrt(kx * kz) * 0.5 + 0.5;
    for (const it of st.items) if (!it.host) { it.x *= kx; it.z *= kz; if (it.size) it.size *= ks; if (it.kind === 'plant') it.scale = (it.scale || 1) * (0.6 + 0.4 * b.h / a.h); }
    await layout.load(st, setTank);
    viewPreset('front');
    pushHist();
  };
  document.querySelectorAll('#views button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('on', x === b));
    viewPreset(b.dataset.view);
  });
  $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
  $('#viewBtn').onclick = () => setView(!isView());
  $('#presetBtn').onclick = openPresets;
  $('#newBtn').onclick = newLayout;
  $('#sceneBtn').onclick = () => { refreshSummary(); $('#sceneModal').style.display = 'flex'; };
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.style.display = 'none'; }));
  if (app.mobile) document.body.classList.add('mobile');
  for (const id of ['saveModal', 'presetModal']) $('#' + id).onclick = (e) => { if (e.target.id === id) e.target.style.display = 'none'; };
}

// ---------------------------------------------------------------- tabs
function buildTabs() {
  document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => {
    ui.tab = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    setTool('select');
    renderTab();
  });
}
function card(id, name, thumb, on, extra = '') {
  return `<button type="button" class="item${on ? ' on' : ''}" data-id="${id}" aria-pressed="${!!on}"><div class="th" style="background-image:url('${thumb}')"></div><div class="nm">${esc(name)}</div>${extra}</button>`;
}
function renderTab() {
  const P = $('#pane');
  P.className = 'catalog-' + ui.tab;
  const S = layout.settings;
  if (ui.tab === 'soil') {
    P.innerHTML = `
      <h3>选择底床</h3><div class="grid" id="soilGrid">${SOILS.map((s) => card(s.id, s.name, `tex/${s.tex}.webp`, S.soil === s.id)).join('')}</div>
      <p class="desc">${esc(byId(SOILS, S.soil).desc)}</p>
      <h3>塑造地形</h3>
      <div class="seg" id="sculpt">
        <button data-m="raise">堆高</button><button data-m="lower">降低</button><button data-m="smooth">平滑</button><button data-m="flatten">平整</button>
      </div>
      <div class="seg" style="margin-top:6px" id="slopes">
        <button data-s="slope">后高前低</button><button data-s="flat">平地</button><button data-s="mound">中央山丘</button><button data-s="valley">中央山谷</button>
      </div>
      ${brushRow()}
      <p class="desc">使用画笔时，<b>按住左键拖动</b>绘制，<b>按住右键拖动</b>旋转视角。</p>`;
    P.querySelectorAll('#soilGrid .item').forEach((el) => el.onclick = () => { S.soil = el.dataset.id; app.soil.setSoil(byId(SOILS, S.soil)); renderTab(); refreshSummary(); pushHist(); });
    P.querySelectorAll('#sculpt button').forEach((b) => {
      b.classList.toggle('on', ui.tool === 'brush' && ui.toolArg?.m === b.dataset.m);
      b.onclick = () => setTool(ui.tool === 'brush' && ui.toolArg?.m === b.dataset.m ? 'select' : 'brush', { m: b.dataset.m });
    });
    P.querySelectorAll('#slopes button').forEach((b) => b.onclick = () => { terrainPreset(b.dataset.s); pushHist(); });
  } else if (ui.tab === 'stone') {
    P.innerHTML = `<h3>选择石材</h3><div class="grid">${STONES.map((s) => card(s.id, s.name, ui.thumbs['stone:' + s.id] || '', ui.toolArg?.type === s.id)).join('')}</div>
      <label class="row" style="cursor:pointer"><input type="checkbox" class="contChk" ${ui.continuous ? 'checked' : ''}> 连续放置 <span class="desc" style="margin:0">（也可按住 Shift 并点击连续放置）</span></label>
      <h3>大小</h3><div class="seg" id="sizes">${STONE_SIZES.map((z) => `<button data-z="${z.id}" class="${ui.stoneSize === z.id ? 'on' : ''}">${z.name}（约${Math.round(z.size * 100)}cm）</button>`).join('')}</div>
      <p class="desc">放置后会自动选中石材。拖动底部圆环的 <b><img class="ui-icon" src="icons/rotate-right.svg" alt="" aria-hidden="true"></b> 旋转，向外拖动 <b><img class="ui-icon" src="icons/expand.svg" alt="" aria-hidden="true"></b> 放大，拖动石材移动。侧边面板可调整倾斜和高度。每次放置都会生成不同形状。</p>
      <p class="desc">${esc((byId(STONES, ui.toolArg?.type) || STONES[0]).desc)}</p>`;
    P.querySelectorAll('.item').forEach((el) => el.onclick = () => setTool('place', { kind: 'stone', type: el.dataset.id }));
    P.querySelectorAll('#sizes button').forEach((b) => b.onclick = () => { ui.stoneSize = b.dataset.z; renderTab(); if (ui.tool === 'place') newGhost(); });
  } else if (ui.tab === 'wood') {
    P.innerHTML = `<h3>选择沉木</h3><div class="grid">${WOODS.map((s) => card(s.id, s.name, ui.thumbs['wood:' + s.id] || '', ui.toolArg?.type === s.id)).join('')}</div>
      <label class="row" style="cursor:pointer"><input type="checkbox" class="contChk" ${ui.continuous ? 'checked' : ''}> 连续放置 <span class="desc" style="margin:0">（也可按住 Shift 并点击连续放置）</span></label>
      <h3>大小</h3><div class="seg" id="sizes">${WOOD_SIZES.map((z) => `<button data-z="${z.id}" class="${ui.woodSize === z.id ? 'on' : ''}">${z.name}（约${Math.round(z.size * 100)}cm）</button>`).join('')}</div>
      <p class="desc">拖动圆环的 <b><img class="ui-icon" src="icons/rotate-right.svg" alt="" aria-hidden="true"></b> 旋转沉木，使用 <b><img class="ui-icon" src="icons/expand.svg" alt="" aria-hidden="true"></b> 调整大小，侧边面板可调整<b>倾斜</b>。水草选项中的附生水草（小水榕、铁皇冠、爪哇莫丝）可附着在沉木或石材上。</p>`;
    P.querySelectorAll('.item').forEach((el) => el.onclick = () => setTool('place', { kind: 'wood', type: el.dataset.id }));
    P.querySelectorAll('#sizes button').forEach((b) => b.onclick = () => { ui.woodSize = b.dataset.z; renderTab(); if (ui.tool === 'place') newGhost(); });
  } else if (ui.tab === 'plant') {
    const categories = [['carpet','前景草'],['clump','中后景草'],['epiphyte','附生水草']];
    ui.plantCategory ||= 'carpet';
    P.innerHTML = `<div class="plant-category-tabs fish-category-tabs" role="tablist" aria-label="水草分类">${categories.map(([mode,title]) => `<button role="tab" id="plant-tab-${mode}" aria-controls="plant-panel" aria-selected="${ui.plantCategory === mode}" tabindex="${ui.plantCategory === mode ? 0 : -1}" data-plant-category="${mode}" class="${ui.plantCategory === mode ? 'on' : ''}">${title}</button>`).join('')}</div>
      <div class="grid plant-strip" id="plant-panel" role="tabpanel" aria-labelledby="plant-tab-${ui.plantCategory}">${PLANTS.filter(p => p.mode === ui.plantCategory).map(p => card(p.id,p.name,ui.thumbs['plant:'+p.id] || '',ui.toolArg?.type === p.id)).join('')}</div>` +
      (ui.plantCategory === 'carpet' ? `<div class="seg"><button id="carpetErase" class="${ui.toolArg?.erase ? 'on' : ''}">橡皮擦</button></div>${brushRow()}` : `<label class="row" style="cursor:pointer"><input type="checkbox" class="contChk" ${ui.continuous ? 'checked' : ''}> 连续放置</label>`);
    P.querySelectorAll('[data-plant-category]').forEach(button => {
      const activate = mode => { ui.plantCategory = mode; renderTab(); P.querySelector(`[data-plant-category="${mode}"]`).focus(); };
      button.onclick = () => activate(button.dataset.plantCategory);
      button.onkeydown = e => {
        const i = categories.findIndex(([mode]) => mode === button.dataset.plantCategory); let next;
        if (e.key === 'ArrowRight') next = (i+1)%categories.length;
        if (e.key === 'ArrowLeft') next = (i+categories.length-1)%categories.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = categories.length-1;
        if (next !== undefined) { e.preventDefault(); activate(categories[next][0]); }
      };
    });
    for (const strip of P.querySelectorAll('.plant-category-tabs,.plant-strip')) {
      strip.addEventListener('wheel', e => {
        if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
        const previous = strip.scrollLeft; strip.scrollLeft += e.deltaY;
        if (strip.scrollLeft !== previous) e.preventDefault();
      }, {passive:false});
    }
    P.querySelectorAll('.item').forEach((el) => el.onclick = () => {
      const def = byId(PLANTS, el.dataset.id);
      if (def.mode === 'carpet') setTool('brush', { m: 'carpet', type: def.id });
      else setTool('place', { kind: 'plant', type: def.id });
    });
    const er = $('#carpetErase');
    if (er) er.onclick = () => { if (ui.toolArg?.m === 'carpet') { ui.toolArg.erase = !ui.toolArg.erase; renderTab(); hint(); } else toast('请先选择前景草'); };
  } else if (ui.tab === 'fish') {
    const row = (f, th) => `<div class="fishrow" data-id="${f.id}"><div class="th" style="background-image:url('${th}')"></div>
        <div><div class="nm">${esc(f.name)}</div><div class="pr">${f.cm}cm ・ ${esc(f.desc)}</div></div>
        <div class="stepper"><button data-d="-1"><img class="ui-icon" src="icons/minus.svg" alt="" aria-hidden="true"></button><span>${layout.fishCounts[f.id] || 0}</span><button data-d="1"><img class="ui-icon" src="icons/plus.svg" alt="" aria-hidden="true"></button></div></div>`;
    const categories = [...FISH_GROUPS.map(([title, ids]) => ({ title, fish: ids.map(id => byId(FISH, id)).filter(f => f && ui.fishAvail.has(f.id)) })), { title: '虾与螺', fish: INVERTS }].filter(g => g.fish.length);
    ui.fishCategory = Math.min(ui.fishCategory || 0, categories.length - 1);
    P.innerHTML = `<div class="fish-category-tabs" role="tablist" aria-label="生物分类">${categories.map((g,i) => `<button role="tab" id="fish-tab-${i}" aria-controls="fish-panel" aria-selected="${i === ui.fishCategory}" tabindex="${i === ui.fishCategory ? 0 : -1}" data-category="${i}" class="${i === ui.fishCategory ? 'on' : ''}">${esc(g.title)}</button>`).join('')}</div><div class="fish-category-content" id="fish-panel" role="tabpanel" aria-labelledby="fish-tab-${ui.fishCategory}">${categories[ui.fishCategory].fish.map(f => row(f, f.photo || byId(FISH,f.id) ? `thumbs/${f.id}.jpg` : ui.thumbs['inv:' + f.id] || '')).join('')}</div>
      <div class="seg" style="margin-top:8px"><button id="feedBtn">喂食 (F)</button><button id="clearFish">移除所有生物</button></div>`;
    P.querySelectorAll('[data-category]').forEach(button => {
      const activate = i => { ui.fishCategory = i; renderTab(); P.querySelector(`[data-category="${i}"]`).focus(); };
      button.onclick = () => activate(Number(button.dataset.category));
      button.onkeydown = e => { const i = Number(button.dataset.category); let next;
        if (e.key === 'ArrowRight') next = (i + 1) % categories.length;
        if (e.key === 'ArrowLeft') next = (i + categories.length - 1) % categories.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = categories.length - 1;
        if (next !== undefined) { e.preventDefault(); activate(next); }
      };
    });
    P.querySelectorAll('.fishrow').forEach((row) => {
      row.querySelectorAll('button').forEach((b) => {
        let iv = null;
        const step = async () => {
          const id = row.dataset.id, f = byId(FISH, id) || byId(INVERTS, id);
          let n = (layout.fishCounts[id] || 0) + Number(b.dataset.d) * (Number(b.dataset.d) > 0 && !layout.fishCounts[id] ? Math.min(f.minGroup, 10) : 1);
          await layout.setFish(id, n);
          row.querySelector('span').textContent = layout.fishCounts[id] || 0;
        };
        b.onpointerdown = () => { step(); iv = setTimeout(function rep() { step(); iv = setTimeout(rep, 90); }, 450); };
        b.onpointerup = b.onpointerleave = () => { if (iv) { clearTimeout(iv); iv = null; pushHist(); } };
      });
    });
    $('#feedBtn').onclick = () => fishes.feed();
    $('#clearFish').onclick = async () => { for (const f of [...FISH, ...INVERTS]) await layout.setFish(f.id, 0); renderTab(); pushHist(); };
  } else if (ui.tab === 'env') {
    const W = app.post.W;
    P.innerHTML = `<h3>背景板</h3><div class="seg" id="bgs">${BACKGROUNDS.map((b) => `<button data-b="${b.id}" class="${S.bg === b.id ? 'on' : ''}">${b.name}</button>`).join('')}</div>
      <h3>照明</h3>
      <div class="seg" id="lampCols" style="margin-bottom:4px">${[['white', '白光（6500K）'], ['warm', '暖色'], ['rgb', 'RGB（鲜艳）'], ['blue', '冷白']].map(([k, n]) => `<button data-c="${k}" class="${(S.lampColor || 'white') === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="row"><label>亮度</label><input type="range" id="lamp" min="0" max="1.6" step="0.05" value="${S.lamp}"><span class="v" id="lampV">${Math.round(S.lamp * 100)}%</span></div>
      <div class="row"><label>水波光影</label><input type="range" id="caus" min="0" max="1.6" step="0.05" value="${U.uCaustic.value}"></div>
      <div class="row"><label>光束</label><input type="range" id="shafts" min="0" max="3" step="0.05" value="${W.shafts}"></div>
      <h3>水</h3>
      <div class="row"><label>透明度</label><input type="range" id="clar" min="0" max="1" step="0.02" value="${W.clarity ?? 0.6}"></div>
      <div class="row"><label>水流</label><input type="range" id="flow" min="0" max="2.5" step="0.05" value="${U.uFlow.value}"></div>
      <div class="row"><label>水面倒影</label><input type="checkbox" id="mirror" ${W.mirror ? 'checked' : ''}></div>
      <h3>场景效果</h3>
      <div class="scene-effect-toggles"><label for="co2">二氧化碳气泡<input type="checkbox" id="co2" ${S.co2 ? 'checked' : ''}></label><label for="stand">底柜<input type="checkbox" id="stand" ${S.stand ? 'checked' : ''}></label></div>
      `;
    P.querySelectorAll('#bgs button').forEach((b) => b.onclick = () => { S.bg = b.dataset.b; app.tank.setBackground(S.bg); renderTab(); pushHist(); });
    P.querySelectorAll('#lampCols button').forEach((b) => b.onclick = () => { S.lampColor = b.dataset.c; app.tank.setLampColor(S.lampColor); renderTab(); });
    $('#lamp').oninput = (e) => { S.lamp = Number(e.target.value); app.tank.setLamp(S.lamp); $('#lampV').textContent = `${Math.round(S.lamp * 100)}%`; };
    $('#caus').oninput = (e) => { U.uCaustic.value = Number(e.target.value); };
    $('#shafts').oninput = (e) => { W.shafts = Number(e.target.value); };
    $('#clar').oninput = (e) => { W.clarity = Number(e.target.value); const k = 0.25 + (1 - W.clarity) * 2.2; W.sigma.set(0.55, 0.2, 0.26).multiplyScalar(k); W.haze = 0.5 + (1 - W.clarity) * 4; };
    $('#flow').oninput = (e) => { U.uFlow.value = Number(e.target.value); };
    $('#mirror').onchange = (e) => { W.mirror = e.target.checked; app.post.RT.reflections = W.mirror; app.post.resize(); };
    $('#co2').onchange = (e) => { S.co2 = e.target.checked; refreshSummary(); };
    $('#stand').onchange = (e) => { S.stand = e.target.checked; refreshSummary(); };
  } else if (ui.tab === 'perf') {
    const W = app.post.W;
    P.innerHTML = `      <h3>相机</h3>
      <div class="row"><label>景深虚化</label><input type="checkbox" id="dof" ${W.dof ? 'checked' : ''}></div>
      <div class="row"><label>虚化强度</label><input type="range" id="dofK" min="0.3" max="3" step="0.1" value="${W.dofK}"></div>
      <p class="desc">默认对焦画面中央。轻触（点击）缸内位置，可暂时对焦到该处。</p>
      <h3>画质</h3>
      <div class="seg" id="qual"><button data-q="low">流畅</button><button data-q="std">均衡</button><button data-q="high">精细</button></div>
      <p class="desc">均衡和流畅模式降低前景草重复密度，限制绘制分辨率与阴影更新频率。种植范围保持不变，精细模式恢复完整密度并开启反射与景深。</p>

      <h3>实时监控</h3><p class="perf-settings-text">查看帧率、Draw Calls、面数、内存与实例化统计。</p><div class="seg"><button id="openMonitor">打开实时监控</button></div>`;
    $('#dof').onchange = (e) => { W.dof = e.target.checked; app.post.RT.depthOfField = W.dof; app.post.resize(); };
    $('#dofK').oninput = (e) => { W.dofK = Number(e.target.value); };
    P.querySelectorAll('#qual button').forEach((b) => {
      b.classList.toggle('on', app.quality === b.dataset.q);
      b.onclick = () => { setQuality(b.dataset.q, { save: true }); renderTab(); };
    });
    $('#openMonitor').onclick = () => { ui.closePanels?.(); app.performance.toggle(true); };
  }
  if (ui.tab === 'wood' || ui.tab === 'stone') {
    const shell = document.createElement('div'); shell.className = 'material-layout';
    const assets = document.createElement('section'); assets.className = 'material-assets';
    const controls = document.createElement('section'); controls.className = 'material-controls';
    const children = [...P.children];
    assets.append(children[0], children[1]);
    for (const child of children.slice(2)) controls.append(child);
    shell.append(assets, controls); P.append(shell);
  }
  if (ui.tab === 'soil') {
    const terrain = document.createElement('section'); terrain.className = 'terrain-tools';
    const sculpt = P.querySelector('#sculpt'), slopes = P.querySelector('#slopes');
    const heading = sculpt.previousElementSibling, brush = slopes.nextElementSibling;
    heading.before(terrain); terrain.append(heading, sculpt, slopes, brush);
  }
  if (ui.tab === 'env' || ui.tab === 'perf') {
    let group;
    for (const child of [...P.children]) {
      if (child.tagName === 'H3') { group = document.createElement('section'); group.className = 'setting-group'; P.append(group); }
      if (group) group.append(child);
    }
  }
  P.querySelectorAll('p.desc').forEach(p => {
    const d = document.createElement('details'); d.className = 'help-note';
    const summary = document.createElement('summary'); summary.textContent = '使用说明';
    p.before(d); d.append(summary, p);
  });
  P.querySelectorAll('.stepper').forEach(stepper => {
    const nm = stepper.closest('.fishrow').querySelector('.nm').textContent;
    stepper.querySelector('[data-d="-1"]').setAttribute('aria-label', '减少' + nm);
    stepper.querySelector('[data-d="1"]').setAttribute('aria-label', '添加' + nm);
  });
}
document.addEventListener('change', (e) => { if (e.target.classList?.contains('contChk')) { ui.continuous = e.target.checked; hint(); } });
function brushRow() {
  return `<div class="row"><label>画笔大小</label><input type="range" id="brushR" min="0.01" max="0.1" step="0.005" value="${ui.brush.r}"><span class="v" id="brushV">${Math.round(ui.brush.r * 200)}cm</span></div>`;
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'brushR') { ui.brush.r = Number(e.target.value); $('#brushV').textContent = `${Math.round(ui.brush.r * 200)}cm`; }
});

function terrainPreset(s) {
  const soil = app.soil, { NX, NZ } = soil;
  if (s === 'slope') soil.slope(0.03, 0.09);
  else {
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const x = i / NX - 0.5, v = j / NZ;
      let h = 0.045;
      if (s === 'mound') h = 0.035 + 0.065 * Math.exp(-((x + 0.08) ** 2 / 0.04 + (v - 0.45) ** 2 / 0.12));
      if (s === 'valley') h = 0.04 + 0.06 * Math.min(1, Math.abs(x) * 3) * (1 - v * 0.6);
      soil.h[j * (NX + 1) + i] = Math.min(h, soil.maxH);
    }
    soil._geometry();
  }
  layout.placeAll();
  for (const c of plants.carpets.values()) c.dirty = true;
  refreshSummary();
}

// ---------------------------------------------------------------- tools
function setTool(tool, arg = null) {
  ui.tool = tool; ui.toolArg = arg;
  clearGhost();
  setHover(null);
  const C = app.controls;
  if (tool === 'select') { C.mouseButtons.LEFT = null; C.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE; C.mouseButtons.RIGHT = THREE.MOUSE.PAN; C.touches.ONE = THREE.TOUCH.ROTATE; }
  else { C.mouseButtons.LEFT = null; C.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; C.touches.ONE = null; }   // one finger draws / places
  C.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  if (tool === 'place') newGhost();
  if (tool !== 'select') select(null);
  ring.visible = false;
  renderTab(); hint();
  ui.onToolChange?.();
}
/** display name of what the current place / brush tool puts down */
function toolName() {
  const a = ui.toolArg || {};
  if (ui.tool === 'brush') return { raise: '堆高', lower: '降低', smooth: '平滑', flatten: '平整' }[a.m] || ((byId(PLANTS, a.type)?.name || '') + (a.erase ? '（橡皮擦）' : ''));
  return a.kind === 'stone' ? byId(STONES, a.type).name : a.kind === 'wood' ? byId(WOODS, a.type).name : byId(PLANTS, a.type)?.name || '';
}
function hint() {
  const h = $('#hint');
  const a = ui.toolArg;
  if (ui.sel && ui.tool === 'select') {
    h.innerHTML = ui.touch ? '<b><img class="ui-icon" src="icons/rotate-right.svg" alt="" aria-hidden="true"></b> 沿圆环拖动以旋转 ・ <b><img class="ui-icon" src="icons/expand.svg" alt="" aria-hidden="true"></b> 向外拖动以放大 ・ 拖动物体以移动'
      : '<b><img class="ui-icon" src="icons/rotate-right.svg" alt="" aria-hidden="true"></b> 沿圆环拖动以旋转 ・ <b><img class="ui-icon" src="icons/expand.svg" alt="" aria-hidden="true"></b> 向外拖动以放大 ・ 拖动物体以移动 ・ <b>右键拖动</b> 旋转视角 ・ <b>Esc</b> 取消选择';
    return;
  }
  let t = ui.touch ? '<b>单指</b> 旋转视角 ・ <b>双指</b> 缩放 ・ <b>轻触</b>选择，拖动已选物体以移动'
                   : '<b>右键拖动</b>（空白处也可左键拖动） 旋转视角 ・ <b>滚轮</b> 缩放 ・ 点击物体以选择';
  if (ui.tool === 'place') {
    const nm = a.kind === 'stone' ? byId(STONES, a.type).name : a.kind === 'wood' ? byId(WOODS, a.type).name : byId(PLANTS, a.type).name;
    t = ui.touch ? `<b>${esc(nm)}</b>：${byId(PLANTS, a.type)?.mode === 'epiphyte' ? '轻触石材或沉木表面' : '轻触放置'} ・ <b>双指</b> 旋转视角・缩放`
      : `<b>${esc(nm)}</b>：${byId(PLANTS, a.type)?.mode === 'epiphyte' ? '点击石材或沉木表面' : '点击放置'}${ui.continuous ? '（连续放置）' : '（放置后返回选择模式）'} ・ <b>右键拖动</b> 旋转视角 ・ <b>Esc</b> 结束`;
  } else if (ui.tool === 'brush') {
    const nm = { raise: '堆高', lower: '降低', smooth: '平滑', flatten: '平整' }[a.m] || (byId(PLANTS, a.type)?.name + (a.erase ? '（橡皮擦）' : ''));
    t = ui.touch ? `<b>${esc(nm)}</b>：<b>单指</b>绘制 ・ <b>双指</b> 旋转视角・缩放`
      : `<b>${esc(nm)}</b>：<b>左键拖动</b>绘制 ・ <b>右键拖动</b> 旋转视角 ・ <b>[ ]</b> 画笔大小 ・ <b>Esc</b> 结束`;
  }
  h.innerHTML = t;
}

// ---------------------------------------------------------------- picking
function setNdc(e) {
  const r = app.renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, app.camera);
}
function hitSoil(e) { setNdc(e); return ray.intersectObject(app.soil.mesh, false)[0] || null; }
function hitObjects(e, list) { setNdc(e); return ray.intersectObjects(list, true)[0] || null; }
function uidOf(o) { while (o && !o.userData.uid) o = o.parent; return o?.userData.uid; }

// brush ring drawn on the soil
const ringGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3));
const ring = new THREE.LineLoop(ringGeo, new THREE.LineBasicMaterial({ color: 0x9ff5d2, transparent: true, opacity: 0.85, depthTest: false }));
ring.visible = false; ring.renderOrder = 10;
function updateRing(x, z) {
  if (!ring.parent) app.overlay.add(ring);
  const P = ringGeo.attributes.position;
  for (let i = 0; i < 65; i++) {
    const a = i / 64 * Math.PI * 2, px = x + Math.cos(a) * ui.brush.r, pz = z + Math.sin(a) * ui.brush.r;
    P.setXYZ(i, px, app.soil.heightAt(px, pz) + 0.002, pz);
  }
  P.needsUpdate = true; ringGeo.computeBoundingSphere();
  ring.visible = true;
}

// ---------------------------------------------------------------- ghost (preview of the next placement)
function clearGhost() {
  if (ui.ghost) { ui.ghost.parent?.remove(ui.ghost); if (ui.ghost.userData.own) ui.ghost.geometry.dispose(); else ui.ghost.material.dispose(); ui.ghost = null; }
}
function newGhost() {
  clearGhost();
  const a = ui.toolArg;
  ui.ghostSeed = Math.floor(Math.random() * 1e6);
  const item = ghostItem();
  let m;
  if (a.kind === 'stone') m = makeStone(byId(STONES, a.type), item);
  else if (a.kind === 'wood') m = makeWood(byId(WOODS, a.type), item);
  else { m = plants.buildClump(byId(PLANTS, a.type), item); m.userData.own = true; }
  if (m.material.userData?.uni?.uHi) m.material.userData.uni.uHi.value = 0.8;
  m.visible = false;
  m.castShadow = false;
  app.scene.add(m);
  ui.ghost = m;
  ui.ghostRot = ui.ghostRot ?? 0;
}
function ghostItem() {
  const a = ui.toolArg;
  if (a.kind === 'stone') return { kind: 'stone', type: a.type, seed: ui.ghostSeed, size: byId(STONE_SIZES, ui.stoneSize).size };
  if (a.kind === 'wood') return { kind: 'wood', type: a.type, seed: ui.ghostSeed, size: byId(WOOD_SIZES, ui.woodSize).size, sizeId: ui.woodSize };
  return { kind: 'plant', type: a.type, seed: ui.ghostSeed, scale: 1 };
}

// ---------------------------------------------------------------- highlight: selected / under the cursor / being moved
let hiPrev = new Map();
function refreshHi() {
  const want = new Map();
  if (ui.sel) want.set(ui.sel, 'sel');
  if (ui.hover) want.set(ui.hover, 'hover');
  if (ui.dragUid) want.set(ui.dragUid, 'drag');
  for (const uid of hiPrev.keys()) if (!want.has(uid)) setHi(uid, null);
  for (const [uid, st] of want) setHi(uid, st);
  hiPrev = want;
}
function setHi(uid, st) {
  const o = layout.items.get(uid);
  if (!o) return;
  if (o.item.kind === 'plant') { o.mesh.material = st ? plants.hiMat[st] : plants.mat; return; }
  const u = o.mesh.material.userData.uni;
  u.uHi.value = st ? 1 : 0;
  if (st) u.uHiCol.value.fromArray(HI_COL[st]);
}
function setHover(uid) {
  if (ui.hover === uid) return;
  ui.hover = uid;
  app.renderer.domElement.style.cursor = ui.dragUid ? 'grabbing' : uid ? 'grab' : '';
  refreshHi();
}

// ---------------------------------------------------------------- selection
function selDefs(it) {
  return it.kind === 'stone' ? { name: byId(STONES, it.type).name, max: 2.5 } : it.kind === 'wood' ? { name: byId(WOODS, it.type).name, max: 2.5 }
    : { name: byId(PLANTS, it.type).name, max: 2.2 };
}
function select(uid) {
  ui.sel = uid;
  refreshHi();
  const o = uid && layout.items.get(uid);
  const bar = $('#selbar');
  if (!o) { bar.style.display = 'none'; ui.gizmo?.attach(null); hint(); placeSelBar(); ui.onSelect?.(); return; }
  const it = o.item, isObj = it.kind !== 'plant', D = selDefs(it);
  // clumps planted in the soil are round already: turning them does nothing, so no rotate control for them
  const canRotate = isObj || !!it.host;
  ui.gizmo.attach(o.mesh, { rotate: canRotate });
  const grp = (label, inner) => `<div class="sg"><span class="sl">${label}</span>${inner}</div>`;
  bar.innerHTML = `<div class="sh"><span class="nm">${esc(D.name)}</span><button data-a="close" class="x" title="取消选择"><img class="ui-icon" src="icons/close.svg" alt="" aria-hidden="true"></button></div>
    <div class="sr">
      <div class="seg transform-modes">${[['translate','移动','move'],['rotate','旋转','rotate-right'],['scale','缩放','expand']].map(([mode,label,icon]) => `<button data-transform="${mode}" class="${ui.gizmo.mode === mode ? 'on' : ''}" title="${label}（${{translate:'W',rotate:'E',scale:'R'}[mode]}）"><img class="ui-icon" src="icons/${icon}.svg" alt="">${label}</button>`).join('')}</div>
    </div>
    <div class="sr">
      <button data-a="dup">复制</button><button data-a="new">更换形状</button><button data-a="del" class="del">删除</button>
    </div>`;
  bar.style.display = 'flex';
  bar.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => selAction(b.dataset.a));
  bar.querySelectorAll('[data-transform]').forEach(b => b.onclick = () => ui.gizmo.setMode(b.dataset.transform));
  ui.onSelect?.();
  hint();
  placeSelBar();
}
/** size of the selected item; plants are previewed by scaling the mesh and rebuilt when the drag ends */
function setSelScale(v, done) {
  const o = layout.items.get(ui.sel); if (!o) return;
  const it = o.item, D = selDefs(it);
  v = THREE.MathUtils.clamp(v, 0.4, D.max);
  if (it.kind !== 'plant') {
    it.scale = v;
    layout.place(ui.sel);
    for (const [u, p] of layout.items) if (p.item.host === ui.sel) layout.place(u);
    if (done) { layout.rebuildObstacles(); layout.changed(); pushHistSoon(); }
  } else {
    if (!o.base) o.base = { s: o.mesh.scale.x, v: it.scale || 1 };
    o.mesh.scale.setScalar(o.base.s * v / o.base.v);
    if (done) { it.scale = v; delete o.base; rebuild(it); }
  }
  const sl = $('#selSize'); if (sl && document.activeElement !== sl) { sl.value = v; $('#selSizeV').textContent = `${Math.round(v * 100)}%`; }
}
/** a fixed spot in the lower middle of the view, centred between the side panels and clear of the hint;
 *  it never follows the object, only panel toggles and resizes move it */
function placeSelBar() {
  if (document.body.classList.contains('docked')) return;      // docked above the tab bar by CSS on phones
  const bar = $('#selbar'); if (bar.style.display === 'none') return;
  const shown = (el) => getComputedStyle(el).display !== 'none';
  const lo = (shown($('#left')) ? $('#left').getBoundingClientRect().right : 0) + 8;
  const hi = innerWidth - 16;
  bar.style.left = `${(lo + hi) / 2}px`;
  bar.style.top = `${Math.max(56, Math.min(innerHeight * 0.62, innerHeight - 56 - bar.offsetHeight))}px`;
}
function selAction(a) {
  const o = layout.items.get(ui.sel);
  if (!o) return;
  const it = o.item;
  const isObj = it.kind !== 'plant';
  switch (a) {
    case 'rotL': it.rot = (it.rot || 0) + Math.PI / 12; break;
    case 'rotR': it.rot = (it.rot || 0) - Math.PI / 12; break;
    case 'tiltL': it.tiltZ = (it.tiltZ || 0) + 0.12; break;
    case 'tiltR': it.tiltZ = (it.tiltZ || 0) - 0.12; break;
    case 'tiltF': it.tiltX = (it.tiltX || 0) + 0.12; break;
    case 'tiltB': it.tiltX = (it.tiltX || 0) - 0.12; break;
    case 'close': select(null); return;
    case 'smaller': case 'bigger': {
      const k = a === 'bigger' ? 1.12 : 1 / 1.12;
      if (isObj) it.scale = THREE.MathUtils.clamp((it.scale || 1) * k, 0.4, 2.5);
      else { it.scale = THREE.MathUtils.clamp((it.scale || 1) * k, 0.4, 2.2); rebuild(it); return; }
      break;
    }
    case 'down': it.sink = (it.sink ?? it.size * (it.scale || 1) * (it.kind === 'stone' ? 0.1 : 0.03)) + 0.008; break;
    case 'up': it.sink = (it.sink ?? it.size * (it.scale || 1) * 0.1) - 0.008; break;
    case 'dup': {
      const c = structuredClone(it); c.uid = undefined;
      if (c.transform) { c.transform[12] += c.host ? .01 : .03; if (!c.host) c.transform[14] += .01; }
      if (c.host) { c.lp = [c.lp[0] + 0.01, c.lp[1], c.lp[2]]; } else { c.x += 0.03; c.z += 0.01; }
      if (c.kind !== 'stone' && c.kind !== 'wood') c.seed = Math.floor(Math.random() * 1e6);
      const n = layout.add(c);
      select(n.uid); pushHist(); return;
    }
    case 'new': it.seed = Math.floor(Math.random() * 1e6); rebuild(it); return;
    case 'del': layout.remove(ui.sel); select(null); pushHist(); return;
  }
  layout.place(ui.sel);
  for (const [u, p] of layout.items) if (p.item.host === ui.sel) layout.place(u);
  layout.rebuildObstacles();
  layout.changed();
  pushHistSoon();
}
function rebuild(it) {
  const uid = it.uid;
  const kids = [...layout.items.values()].filter((p) => p.item.host === uid).map((p) => ({ ...p.item }));
  layout.remove(uid, { silent: true });
  layout.add(it, { silent: true });
  for (const k of kids) layout.add(k, { silent: true });
  layout.rebuildObstacles(); layout.changed();
  select(uid);
  pushHistSoon();
}
let histT = null;
function pushHistSoon() { clearTimeout(histT); histT = setTimeout(pushHist, 500); }

// ---------------------------------------------------------------- viewing mode: look only, the layout can't be touched
const isView = () => document.body.classList.contains('view');
function setView(on) {
  if (on) { setTool('select'); select(null); }
  document.body.classList.toggle('view', on);
  ui.updateInset?.();
}

// ---------------------------------------------------------------- pointer
function setupPointer() {
  const el = app.renderer.domElement;
  let drag = null;
  const C = app.controls;
  // gizmo handles: rotate = drag around the ring, size = drag the handle out / in
  let gdrag = null;
  const groundPoint = (e, y) => {
    setNdc(e);
    const t = (y - ray.ray.origin.y) / ray.ray.direction.y;
    return t > 0 ? ray.ray.at(t, new THREE.Vector3()) : null;
  };
  const gizmoStart = (e) => {
    if (!ui.sel || isView()) return false;
    setNdc(e);
    const h = ui.gizmo.pick(ray);
    if (!h) return false;
    const o = layout.items.get(ui.sel), c = ui.gizmo.center.clone(), p = groundPoint(e, c.y);
    if (!o || !p) return false;
    gdrag = { h, c, a0: Math.atan2(-(p.z - c.z), p.x - c.x), r0: Math.max(0.005, Math.hypot(p.x - c.x, p.z - c.z)), rot0: o.item.rot || 0, s0: o.item.scale || 1 };
    ui.gizmo.hot = h; el.style.cursor = h === 'rotate' ? 'grabbing' : 'nesw-resize';
    return true;
  };
  const gizmoMove = (e) => {
    const o = layout.items.get(ui.sel); if (!o || !gdrag) return;
    const p = groundPoint(e, gdrag.c.y); if (!p) return;
    if (gdrag.h === 'rotate') {
      const a = Math.atan2(-(p.z - gdrag.c.z), p.x - gdrag.c.x);
      let rot = gdrag.rot0 + Math.atan2(Math.sin(a - gdrag.a0), Math.cos(a - gdrag.a0));
      if (e.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);     // 15-degree steps with Shift
      o.item.rot = rot;
      layout.place(ui.sel);
      for (const [u, q] of layout.items) if (q.item.host === ui.sel) layout.place(u);
    } else {
      setSelScale(gdrag.s0 * Math.hypot(p.x - gdrag.c.x, p.z - gdrag.c.z) / gdrag.r0, false);
    }
  };
  const gizmoEnd = () => {
    if (!gdrag) return;
    const o = layout.items.get(ui.sel);
    if (gdrag.h === 'size' && o) setSelScale(o.item.kind === 'plant' ? (o.base ? o.base.v * o.mesh.scale.x / o.base.s : o.item.scale) : o.item.scale, true);
    else { layout.rebuildObstacles(); layout.changed(); pushHistSoon(); }
    gdrag = null; ui.gizmo.hot = null; el.style.cursor = '';
  };
  const startDrag = (e, uid) => {
    const o = layout.items.get(uid);
    const sh = hitSoil(e);
    ui.dragUid = uid; el.style.cursor = 'grabbing'; refreshHi();
    drag = { uid, start: { x: e.clientX, y: e.clientY }, moved: false, off: o.item.host ? null : sh ? [o.item.x - sh.point.x, o.item.z - sh.point.z] : [0, 0] };
  };
  const moveDrag = (e) => {
    if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < 4) return;
    drag.moved = true;
    const o = layout.items.get(drag.uid);
    if (!o) return;
    if (o.item.host) {
      // slide an epiphyte over stones / wood
      const h = hitObjects(e, layout.hosts());
      if (h) attachTo(o.item, h);
    } else {
      const h = hitSoil(e);
      if (h) {
        const I = app.tank.inner;
        o.item.x = THREE.MathUtils.clamp(h.point.x + drag.off[0], I.x0 + 0.01, I.x1 - 0.01);
        o.item.z = THREE.MathUtils.clamp(h.point.z + drag.off[1], I.z0 + 0.01, I.z1 - 0.01);
        layout.place(drag.uid);
        for (const [u, p] of layout.items) if (p.item.host === drag.uid) layout.place(u);
      }
    }
  };
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) { layout.rebuildObstacles(); for (const c of plants.carpets.values()) c.dirty = true; layout.changed(); pushHist(); }
    drag = null;
    ui.dragUid = null; el.style.cursor = ui.hover ? 'grab' : ''; refreshHi();
  };
  const endPaint = () => {
    if (!ui.painting) return;
    ui.painting = false;
    if (ui.toolArg?.m !== 'carpet') { layout.rebuildObstacles(); for (const c of plants.carpets.values()) c.dirty = true; }
    refreshSummary(); pushHist();
  };
  const fishToast = (e) => {
    const fh = hitObjects(e, [...fishes.schools.values()].map((s) => s.im).filter(Boolean));
    const h = hitObjects(e, layout.pickables());
    if (fh && (!h || fh.distance < h.distance)) {
      const s = [...fishes.schools.values()].find((x) => x.im === fh.object);
      if (s) { const f = s.def; toast(`${f.name}（${f.cm}cm）${f.desc}`, 3200); }
    }
    return h;
  };

  // ---- touch: 1 finger orbits (or draws / places with a tool), 2 fingers pinch-zoom + orbit. Nothing is grabbed
  // by accident: an object moves only when the finger starts on the object that is already selected (tap first).
  // Touch events are never swallowed, so OrbitControls sees every finger and can take over for the pinch.
  const T = { pts: new Map(), mode: null, start: null, uid: null };
  const touchDown = (e) => {
    if (!ui.touch) { ui.touch = true; hint(); }
    T.pts.set(e.pointerId, true);
    if (isView()) { T.start = T.pts.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; return; }
    if (T.pts.size >= 2) {                      // second finger: hand everything to the pinch / orbit
      endDrag(); endPaint(); gizmoEnd();
      T.mode = 'multi'; C.enableRotate = true;
      ring.visible = false; if (ui.ghost) ui.ghost.visible = false;
      return;
    }
    T.start = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (gizmoStart(e)) { T.mode = 'gizmo'; C.enableRotate = false; return; }
    if (ui.tool === 'select') {
      const h = hitObjects(e, layout.pickables());
      const uid = h && uidOf(h.object);
      if (uid && uid === ui.sel) { startDrag(e, uid); C.enableRotate = false; T.mode = 'drag'; }
      else { T.mode = 'tap'; T.uid = uid || null; }
    } else if (ui.tool === 'place') { T.mode = 'place'; if (ui.ghost) ghostAt(e); }
    else if (ui.tool === 'brush') { T.mode = 'paintWait'; const h = hitSoil(e); if (h) updateRing(h.point.x, h.point.z); }
  };
  const touchMove = (e) => {
    if (T.pts.size !== 1 || !T.start || isView()) return;
    const dist = Math.hypot(e.clientX - T.start.x, e.clientY - T.start.y);
    if (T.mode === 'gizmo') { gizmoMove(e); return; }
    if (T.mode === 'drag') moveDrag(e);
    else if (T.mode === 'tap' && dist > 8) T.mode = 'orbit';
    else if (T.mode === 'place' && ui.ghost) ghostAt(e);
    else if (T.mode === 'paintWait' && (dist > 6 || performance.now() - T.start.t > 120)) { T.mode = 'paint'; ui.painting = true; brushAt(e, 1 / 30); }
    else if (T.mode === 'paint') brushAt(e, 1 / 60);
  };
  const touchUp = (e) => {
    T.pts.delete(e.pointerId);
    if (T.pts.size > 0) return;                 // wait until every finger is off
    const dist = T.start ? Math.hypot(e.clientX - T.start.x, e.clientY - T.start.y) : 99;
    if (isView()) { if (dist < 10) tapWater(e); }
    else {
      if (T.mode === 'gizmo') gizmoEnd();
      else if (T.mode === 'drag') endDrag();
      else if (T.mode === 'tap') { fishToast(e); select(T.uid); if (!T.uid) tapWater(e); }
      else if (T.mode === 'place' && dist < 12) placeAt(e);
      else if (T.mode === 'paintWait') { ui.painting = true; brushAt(e, 1 / 30); endPaint(); }
      else if (T.mode === 'paint') endPaint();
    }
    T.mode = null; T.start = null; C.enableRotate = true;
  };
  // tapping the glass: the nearest point of the water the ray passes (up to the first thing it hits)

  el.addEventListener('pointerdown', (e) => {
    if (ui.gizmo.busy || (ui.sel && ui.gizmo.controls.axis)) return;
    if (e.pointerType === 'touch') { touchDown(e); return; }
    if (e.button === 0 && gizmoStart(e)) { e.stopImmediatePropagation(); el.setPointerCapture(e.pointerId); return; }
    if (isView()) { if (e.button === 0) ui.downAt = { x: e.clientX, y: e.clientY }; return; }   // orbit / zoom only (a click taps the glass)
    if (e.button === 2) return;                 // right button = orbit, in every mode (OrbitControls)
    if (e.button !== 0) return;
    if (ui.tool === 'select') {
      const h = fishToast(e);
      const uid = h && uidOf(h.object);
      if (uid) {
        select(uid);
        // Selection is separate from transformation; drag the center axes or use W/E/R.
        e.stopImmediatePropagation();
        el.setPointerCapture(e.pointerId);
      } else { ui.downAt = { x: e.clientX, y: e.clientY }; }
    } else if (ui.tool === 'place') {
      placeAt(e);
      e.stopImmediatePropagation();
    } else if (ui.tool === 'brush') {
      ui.painting = true;
      brushAt(e, 1 / 30);
      el.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
    }
  }, { capture: true });
  el.addEventListener('pointermove', (e) => {
    if (ui.gizmo.busy || ui.gizmo.controls.axis) return;
    if (e.pointerType === 'touch') { touchMove(e); return; }
    if (gdrag) { gizmoMove(e); return; }
    if (drag) { moveDrag(e); return; }
    if (!e.buttons && ui.sel && !isView()) {
      setNdc(e);
      const h = ui.gizmo.pick(ray);
      if (h !== ui.gizmo.hot) { ui.gizmo.hot = h; }
      if (h) { el.style.cursor = h === 'rotate' ? 'grab' : 'nesw-resize'; return; }
    }
    if (ui.tool === 'select' && !e.buttons && !isView()) {
      const now = performance.now();
      if (!ui.hoverT || now - ui.hoverT > 40) { ui.hoverT = now; const h = hitObjects(e, layout.pickables()); setHover(h ? uidOf(h.object) : null); }
      return;
    }
    if (ui.tool === 'place' && ui.ghost) ghostAt(e);
    else if (ui.tool === 'brush') {
      const h = hitSoil(e);
      if (h) updateRing(h.point.x, h.point.z); else ring.visible = false;
      if (ui.painting && e.buttons & 1) brushAt(e, 1 / 60);
    }
  });
  const up = (e) => {
    if (ui.gizmo.controls.axis || ui.gizmo.busy) { ui.downAt = null; return; }
    if (e.pointerType === 'touch') { touchUp(e); return; }
    if (gdrag) { gizmoEnd(); return; }
    if (drag) endDrag();
    else if (ui.tool === 'select' && ui.downAt && e.button === 0 && Math.hypot(e.clientX - ui.downAt.x, e.clientY - ui.downAt.y) < 4) { if (!isView()) select(null); tapWater(e); }
    ui.downAt = null;
    endPaint();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !ui.dragUid) setHover(null); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => {
    if (!e.shiftKey || isView()) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const d = (e.deltaY || e.deltaX) > 0 ? -1 : 1;
    if (ui.tool === 'place') { ui.ghostRot = (ui.ghostRot || 0) + d * Math.PI / 12; ghostAt(e); }
    else if (ui.sel) {
      ui.gizmo.begin();
      ui.gizmo.proxy.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),d*Math.PI/12);
      ui.gizmo.apply(); ui.gizmo.finish();
    }
  }, { capture: true, passive: false });
}
/** a tap on the glass or in the water: fish near the spot the ray reaches dart away */
function tapWater(e) {
  setNdc(e);
  const I = app.tank.inner;
  const hits = ray.intersectObjects([app.soil.mesh, ...layout.pickables()], true);
  let p = hits[0]?.point;
  const t = (I.z1 - ray.ray.origin.z) / ray.ray.direction.z;          // where the ray crosses the front glass
  const g = t > 0 ? ray.ray.at(t, new THREE.Vector3()) : null;
  if (!p && g) p = g;
  if (!p) return;
  // aim a little behind the glass, toward what was hit
  if (g && hits[0]) p = g.clone().lerp(hits[0].point, 0.35);
  fishes.startle(p);
  app.inverts.startle(p);
  if (hits[0]) app.focusLock = { p: hits[0].point.clone(), t: 10 };
}
function attachTo(item, h) {
  const hostUid = uidOf(h.object);
  const host = layout.items.get(hostUid);
  if (!host || hostUid === item.uid) return false;
  const inv = host.mesh.matrixWorld.clone().invert();
  const lp = h.point.clone().applyMatrix4(inv);
  const n = h.face.normal.clone();       // object space already
  item.host = hostUid; item.lp = lp.toArray(); item.ln = n.toArray();
  if (item.uid) layout.place(item.uid);
  return true;
}
function ghostAt(e) {
  const a = ui.toolArg, g = ui.ghost;
  const def = a.kind === 'plant' ? byId(PLANTS, a.type) : null;
  if (def?.mode === 'epiphyte') {
    const h = hitObjects(e, layout.hosts());
    if (!h) { g.visible = false; return; }
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    g.position.copy(h.point);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.lerp(new THREE.Vector3(0, 1, 0), 0.45).normalize());
    g.visible = true; return;
  }
  const h = hitSoil(e);
  if (!h) { g.visible = false; return; }
  const it = ghostItem();
  const y = app.soil.heightAt(h.point.x, h.point.z);
  if (a.kind === 'stone' || a.kind === 'wood') {
    g.scale.setScalar(it.size);
    g.position.set(h.point.x, y - it.size * (a.kind === 'stone' ? 0.1 : 0.03), h.point.z);
  } else g.position.set(h.point.x, y, h.point.z);
  g.rotation.set(0, ui.ghostRot || 0, 0);
  g.visible = true;
}
function placeAt(e) {
  const a = ui.toolArg, def = a.kind === 'plant' ? byId(PLANTS, a.type) : null;
  const it = ghostItem();
  it.rot = ui.ghostRot || 0;
  if (def?.mode === 'epiphyte') {
    const h = hitObjects(e, layout.hosts());
    if (!h) { toast('请点击石材或沉木表面'); return; }
    if (!attachTo(it, h)) return;
  } else {
    const h = hitSoil(e);
    if (!h) return;
    it.x = h.point.x; it.z = h.point.z;
  }
  layout.add(it);
  pushHist();
  if (ui.continuous || e.shiftKey) {            // keep placing the same kind (no handles in the way of the next click)
    select(null);
    newGhost();
    ghostAt(e);
  } else {                                      // one at a time: hand over to editing what was just placed
    setTool('select');
    select(it.uid);
  }
}
function brushAt(e, k) {
  const h = hitSoil(e);
  if (!h) return;
  const a = ui.toolArg, { x, z } = h.point;
  updateRing(x, z);
  if (a.m === 'carpet') {
    plants.paintCarpet(byId(PLANTS, a.type), app.soil, x, z, ui.brush.r, a.erase ? 0 : 1, 0.5);
    const now = performance.now();
    if (!ui.lastCarpet || now - ui.lastCarpet > 160) { ui.lastCarpet = now; const c = plants.carpets.get(a.type); if (c) plants.rebuildCarpet(c, app.soil, carpetAvoid); }
  } else {
    app.soil.brush(a.m, x, z, ui.brush.r, k * 2.2);
    layout.placeAll();
  }
}

// ---------------------------------------------------------------- keys
function setupKeys() {
  addEventListener('keydown', (e) => {
    if (!isView() && ui.gizmo.keyDown(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); ui.closePanels?.({focus:true}); if(isView()) setView(false); else if(ui.tool !== 'select') setTool('select'); else select(null); return; }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (isView()) {                      // only leave the mode or feed the fish
      if (e.key === 'Escape' || e.key.toLowerCase() === 'v') setView(false);
      else if (e.key.toLowerCase() === 'f') fishes.feed();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); $('#projectMenu').open = false; ui.closePanels?.({focus:true}); if (ui.tool !== 'select') setTool('select'); else select(null); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel) selAction('del');
    else if (e.key.toLowerCase() === 'r' && ui.sel) selAction(e.shiftKey ? 'rotL' : 'rotR');
    else if (e.key.toLowerCase() === 'd' && ui.sel) selAction('dup');
    else if (e.key.toLowerCase() === 'v') setView(true);
    else if (e.key.toLowerCase() === 'f') fishes.feed();
    else if (e.key === '[' || e.key === ']') {
      ui.brush.r = THREE.MathUtils.clamp(ui.brush.r * (e.key === ']' ? 1.2 : 1 / 1.2), 0.01, 0.1);
      const s = $('#brushR'); if (s) { s.value = ui.brush.r; $('#brushV').textContent = `${Math.round(ui.brush.r * 200)}cm`; }
    }
  });
}

// ---------------------------------------------------------------- scene overview
function refreshSummary() {
  if (!layout) return;
  const E = layout.summary();
  $('#sceneStatus').textContent = `约 ${Math.round(E.waterL)} L · ${E.fishN} 只生物`;
  $('#sceneBody').innerHTML = `<div class="modal-head"><div><span class="eyebrow">当前造景</span><h2>水族箱概览</h2></div><button data-close aria-label="关闭概览"><img class="ui-icon" src="icons/close.svg" alt="" aria-hidden="true"></button></div>
    <div class="metrics"><div><strong>${Math.round(E.waterL)}<small> L</small></strong><span>估算水量</span></div><div><strong>${E.fishN}</strong><span>生物数量</span></div><div><strong>${E.itemN}</strong><span>造景素材</span></div></div>
    <details class="care"><summary>查看饲养参考</summary><p class="desc">根据当前布局生成，仅作为搭配参考。</p>${E.warns.map(w => `<p class="care-note">${esc(w.t)}</p>`).join('') || '<p class="care-note">暂无搭配提示。</p>'}</details>`;
  $('#sceneBody [data-close]').onclick = () => $('#sceneModal').style.display = 'none';
}

// ---------------------------------------------------------------- thumbnails (rendered once in a small studio scene)
async function makeThumbs() {
  const r = app.renderer, W = 320, H = 200;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  // light studio backdrop so dark stones / leaves / shrimp stand out
  const bgc = document.createElement('canvas'); bgc.width = bgc.height = 256;
  const bg2 = bgc.getContext('2d'), grd = bg2.createRadialGradient(128, 110, 10, 128, 128, 190);
  grd.addColorStop(0, '#f1f4f4'); grd.addColorStop(1, '#b8c3c6');
  bg2.fillStyle = grd; bg2.fillRect(0, 0, 256, 256);
  const bgTex = new THREE.CanvasTexture(bgc); bgTex.colorSpace = THREE.SRGBColorSpace;
  sc.background = bgTex;
  sc.add(new THREE.HemisphereLight(0xf2f7ff, 0x605848, 1.7));
  const L = new THREE.DirectionalLight(0xffffff, 3.0); L.position.set(0.4, 1, 0.6); sc.add(L);
  const F = new THREE.DirectionalLight(0xffffff, 1.0); F.position.set(-0.5, 0.2, 1); sc.add(F);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.001, 10);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), buf = new Uint8Array(W * H * 4), img = ctx.createImageData(W, H);
  const caus = U.uCaustic.value; U.uCaustic.value = 0;
  const v = new THREE.Vector3();
  /** frame the object so it fills ~85% of the card from a 3/4 view */
  const shoot = (mesh, key, elev = 0.25) => {
    sc.add(mesh);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const corners = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const dir = new THREE.Vector3(0.35, elev, 1).normalize();
    const tgt = c.clone();
    let d = size * 2;
    for (let it = 0; it < 4; it++) {
      cam.position.copy(tgt).addScaledVector(dir, d); cam.lookAt(tgt); cam.updateMatrixWorld();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of corners) { v.copy(p).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      // recentre on the projected box, then pull in / back so the larger side spans 85%
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const hh = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d, ww = hh * cam.aspect;
      tgt.addScaledVector(right, (x0 + x1) / 2 * ww).addScaledVector(up, (y0 + y1) / 2 * hh);
      d *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / 0.85;
    }
    cam.position.copy(tgt).addScaledVector(dir, d); cam.lookAt(tgt);
    r.setRenderTarget(rt); r.render(sc, cam);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    ui.thumbs[key] = cv.toDataURL('image/jpeg', 0.88);
    sc.remove(mesh);
  };
  for (const s of STONES) shoot(makeStone(s, { seed: 3, size: 0.1 }), 'stone:' + s.id);
  for (const w of WOODS) { const m = makeWood(w, { seed: 5 }); m.scale.setScalar(0.25); shoot(m, 'wood:' + w.id); }
  for (const p of PLANTS) {
    let m;
    if (p.mode === 'carpet') {
      m = new THREE.Group();
      const g = plants.tuftGeometry(p);
      for (let i = 0; i < 30; i++) { const t = new THREE.Mesh(g, plants.mat); t.position.set((i % 6 - 2.5) * 0.008, 0, (Math.floor(i / 6) - 2) * 0.008); t.rotation.y = i; m.add(t); }
    } else m = plants.buildClump(p, { seed: 11, scale: 1 });
    shoot(m, 'plant:' + p.id, p.mode === 'carpet' ? 0.6 : 0.2);
  }
  for (const d of INVERTS) { const m = makeInvertMesh(d); m.scale.setScalar(d.kind === 'shrimp' ? 0.05 : 0.03); m.rotation.y = d.kind === 'shrimp' ? 0.35 : -0.5; shoot(m, 'inv:' + d.id, d.kind === 'shrimp' ? 0.12 : 0.35); }
  U.uCaustic.value = caus;
  r.setRenderTarget(null);
  rt.dispose(); bgTex.dispose();
}

function addModalClose(modal) {
  const content = modal.firstElementChild;
  const title = content.querySelector('h2');
  if (!title || title.closest('.modal-head')) return;
  const head = document.createElement('div'); head.className = 'modal-head';
  title.before(head); head.append(title);
  const close = document.createElement('button'); close.innerHTML = '<img class="ui-icon" src="icons/close.svg" alt="" aria-hidden="true">'; close.setAttribute('aria-label', '关闭窗口');
  close.onclick = () => modal.style.display = 'none'; head.append(close);
}

// ---------------------------------------------------------------- presets
function openPresets() {
  const m = $('#presetModal');
  $('#presetBody').innerHTML = `<h2>造景示例</h2><p class="preset-intro">选择一套搭配开始，加载后可自由编辑。可用撤销恢复当前布局。</p><div class="preset-gallery" aria-label="选择造景示例">` +
    PRESETS.map((p,i) => `<button class="preset-card" data-i="${i}" aria-label="使用${esc(p.name)}布局"><div class="preset-picture"><img src="${p.thumb}" alt="${esc(p.name)}实景预览" loading="lazy"><span>${esc(p.tag)}</span></div><div class="preset-copy"><strong>${esc(p.name)}</strong><small>${esc(p.desc)}</small><span class="preset-action">使用此布局 <span aria-hidden="true"><img class="ui-icon" src="icons/arrow-up-right.svg" alt="" aria-hidden="true"></span></span></div></button>`).join('') + '</div>';
  addModalClose(m); m.style.display = 'flex';
  m.querySelectorAll('button[data-i]').forEach(b => b.onclick = async () => {
    const previous = layout.serialize();
    m.querySelectorAll('button[data-i]').forEach(x => x.disabled = true);
    b.setAttribute('aria-busy','true');
    try {
      setTool('select'); select(null);
      await applyPreset(PRESETS[Number(b.dataset.i)]);
      m.style.display = 'none'; renderTab(); pushHist(); viewPreset('front');
      toast('已加载 · ' + PRESETS[Number(b.dataset.i)].name);
    } catch(error) {
      console.error(error);
      await layout.load(previous,setTank); $('#tankSel').value = layout.settings.tank;
      toast('示例加载失败，请重试');
    } finally {
      b.removeAttribute('aria-busy'); m.querySelectorAll('button[data-i]').forEach(x => x.disabled = false);
    }
  });
}

/** 新建: an empty tank (same size, substrate and lighting) with only the default soil slope; undo brings it back */
async function newLayout() {
  setTool('select');
  layout.clear();
  for (const f of [...FISH, ...INVERTS]) await layout.setFish(f.id, 0);
  app.soil.slope(0.03, 0.08);
  layout.placeAll();
  layout.changed();
  select(null); renderTab(); pushHist();
  toast('已新建水族箱（可用撤销恢复）', 2400);
}
/** a preset is a saved layout: it brings its own tank size along */
async function applyPreset(p) {
  await layout.load(await presetState(p), setTank);
  $('#tankSel').value = layout.settings.tank;
  renderTab();
}

// ---------------------------------------------------------------- save / load / share
function slots() { try { return JSON.parse(localStorage.getItem('aqua.slots') || '[]'); } catch { return []; } }
function openSave() {
  const m = $('#saveModal');
  const list = slots();
  $('#saveBody').innerHTML = `<h2>保存 / 加载</h2>
    <div class="row"><input id="slotName" placeholder="布局名称（例如：60cm 石景缸）" style="flex:1;font:inherit;padding:6px;border-radius:6px;border:1px solid var(--line);background:#1b1f21;color:var(--text)"><button id="doSave">保存到此浏览器</button></div>
    <div class="seg" style="margin:8px 0 12px"><button id="doShare">复制分享链接</button><button id="doExport">导出文件</button><button id="doImport">导入文件</button></div>
    <h3 style="color:var(--dim);font-size:12px">已保存</h3>
    ${list.length ? list.map((s, i) => `<div class="slot"><img src="${s.thumb}"><div class="t"><b>${esc(s.name)}</b><small>${new Date(s.date).toLocaleString('zh-CN')}</small></div><button data-load="${i}">打开</button><button data-del="${i}">删除</button></div>`).join('') : '<p class="desc">暂无保存记录。</p>'}`;
  addModalClose(m);
  m.style.display = 'flex';
  $('#doSave').onclick = () => {
    const name = $('#slotName').value.trim() || `布局 ${list.length + 1}`;
    const thumb = snapshotThumb();
    list.unshift({ name, date: Date.now(), thumb, state: layout.serialize() });
    try { localStorage.setItem('aqua.slots', JSON.stringify(list.slice(0, 24))); toast('已保存'); } catch { toast('保存失败（存储空间不足）'); }
    openSave();
  };
  m.querySelectorAll('[data-load]').forEach((b) => b.onclick = async () => { m.style.display = 'none'; await layout.load(list[Number(b.dataset.load)].state, setTank); $('#tankSel').value = layout.settings.tank; select(null); renderTab(); pushHist(); viewPreset('front'); });
  m.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.del), row = b.closest('.slot');
    row.classList.add('confirm');
    row.querySelector('.t').innerHTML = `<b>确定删除“${esc(list[i].name)}”吗？</b><small>此操作无法撤销</small>`;
    row.querySelectorAll('button').forEach((x) => x.remove());
    row.insertAdjacentHTML('beforeend', '<button data-no>取消</button><button data-yes class="danger">确认删除</button>');
    row.querySelector('[data-no]').onclick = () => openSave();
    row.querySelector('[data-yes]').onclick = () => { list.splice(i, 1); try { localStorage.setItem('aqua.slots', JSON.stringify(list)); } catch { } toast('已删除'); openSave(); };
  });
  $('#doShare').onclick = async () => {
    const h = await encodeState(layout.serialize());
    const url = `${location.origin}${location.pathname}#L=${h}`;
    history.replaceState(null, '', `#L=${h}`);
    try { await navigator.clipboard.writeText(url); toast('已复制分享链接'); } catch { prompt('请复制此链接', url); }
  };
  $('#doExport').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(layout.serialize())], { type: 'application/json' }));
    a.download = `aquarium_layout_${stamp()}.json`; a.click();
  };
  $('#doImport').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { await layout.load(JSON.parse(await f.text()), setTank); $('#tankSel').value = layout.settings.tank; m.style.display = 'none'; renderTab(); pushHist(); } catch { toast('加载失败'); } };
    inp.click();
  };
}
function snapshotThumb() {
  const c = app.renderer.domElement, cv = document.createElement('canvas');
  cv.width = 192; cv.height = 108;
  const k = Math.min(c.width / 16, c.height / 9);
  cv.getContext('2d').drawImage(c, (c.width - 16 * k) / 2, (c.height - 9 * k) / 2, 16 * k, 9 * k, 0, 0, 192, 108);
  return cv.toDataURL('image/jpeg', 0.7);
}
async function encodeState(st) {
  const bytes = new TextEncoder().encode(JSON.stringify(st));
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function readHash() {
  const m = /#L=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!m) return null;
  try {
    const b = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const u8 = Uint8Array.from(b, (c) => c.charCodeAt(0));
    const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(ds).text());
  } catch { return null; }
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; };
function photo() {
  const wasView = document.body.classList.contains('view');
  const a = document.createElement('a');
  a.href = app.renderer.domElement.toDataURL('image/png');
  a.download = `aquarium_${stamp()}.png`;
  a.click();
  toast('已保存图片');
  if (!wasView) return;
}
let toastT = null;
function toast(t, ms = 1800) { const el = $('#toast'); el.textContent = t; el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => (el.style.opacity = 0), ms); }
