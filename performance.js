// Opt-in diagnostic overlay. Counters include every render pass in one application frame.
export function createPerformanceMonitor(app) {
  const { renderer } = app;
  renderer.info.autoReset = false;
  const el = document.createElement('section'); el.id = 'performancePanel'; el.setAttribute('aria-label', '实时性能监控');
  el.innerHTML = `<div class="perf-head"><strong>性能监控 <small>实时</small></strong><div><button id="perfFold" aria-label="折叠性能监控"><img class="ui-icon" src="icons/minus.svg" alt="" aria-hidden="true"></button><button id="perfClose" aria-label="关闭性能监控"><img class="ui-icon" src="icons/close.svg" alt="" aria-hidden="true"></button></div></div>
    <div id="perfContent"><div class="perf-grid" id="perfMetrics"></div><svg id="perfGraph" viewBox="0 0 300 36" aria-label="最近 60 次采样的帧率曲线"><path id="perfGraphPath" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
    <details id="perfAudit" open><summary>实例化检查 <span id="perfAuditTotal"></span></summary><table><thead><tr><th>元素</th><th>网格 / 数量</th><th>方式</th></tr></thead><tbody id="perfAuditRows"></tbody></table></details>
    <p class="perf-note">Draw Calls 与提交面数包含主场景、阴影、反射及后期处理。场景面数只计算可见对象的单份几何体 × 实例数，未做视锥裁剪。后期处理复用一个全屏网格，不计入场景面数。¹ 帧预算以 60 FPS 的 16.67 ms 为基准，不是 CPU 占用率。</p>
    <details><summary>指标口径</summary><p class="perf-note">JS 帧耗时包含模拟更新与 WebGL 命令提交，不能代表整机 CPU 占用率；GPU 计时异步采样，取决于浏览器支持。JS 堆不含纹理、显存或浏览器全部内存。CPU / GPU 系统占用率及显存字节数：浏览器未提供。</p></details></div>`;
  document.body.append(el);
  let enabled = false;
  const btn = document.createElement('button'); btn.id = 'performanceBtn'; btn.textContent = '性能监控';
  document.querySelector('#projectMenu .project-actions').append(btn);
  function toggle(v) {
    enabled = v; el.hidden = !v; btn.setAttribute('aria-pressed', String(v));
    try { localStorage.setItem('aqua.performance', v ? 'on' : 'off'); } catch {}
    resetSamples(); clearQueries();
  }
  btn.onclick = () => toggle(!enabled);
  el.querySelector('#perfClose').onclick = () => toggle(false);
  el.querySelector('#perfFold').onclick = () => { const content = el.querySelector('#perfContent'); content.hidden = !content.hidden; el.querySelector('#perfFold').innerHTML = content.hidden ? '<img class="ui-icon" src="icons/plus.svg" alt="" aria-hidden="true">' : '<img class="ui-icon" src="icons/minus.svg" alt="" aria-hidden="true">'; };
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let pending = [], active = null, gpuMs = null, sampleIndex = 0;
  function clearQueries() { for (const q of pending) gl.deleteQuery(q); pending = []; gpuMs = null; }
  function pollGPU() {
    if (!ext || gl.isContextLost()) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { clearQueries(); return; }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift(); gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
    }
  }
  let cpuStart = 0, updateEnd = 0, intervals = [], cpus = [], updates = [], submits = [], frameCalls = [], frameTriangles = [], framePoints = [], graph = [], lastPublish = 0;
  function resetSamples() { intervals = []; cpus = []; updates = []; submits = []; frameCalls = []; frameTriangles = []; framePoints = []; lastPublish = 0; }
  const mean = a => a.length ? a.reduce((s,v) => s+v,0) / a.length : 0;
  const fmt = n => Math.round(n).toLocaleString('zh-CN');
  const ms = n => `${n.toFixed(1)} <small>ms</small>`;
  function begin(intervalMs) {
    renderer.info.reset();
    if (!enabled) return;
    cpuStart = performance.now();
    intervals.push(intervalMs);
    if (intervals.length > 120) intervals.shift();
  }
  function beforeRender() {
    if (!enabled) return;
    updateEnd = performance.now(); pollGPU();
    if (ext && ++sampleIndex % 15 === 0 && pending.length < 4 && !gl.isContextLost()) {
      active = gl.createQuery();
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    }
  }
  function end() {
    if (!enabled) return;
    const now = performance.now();
    if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); active = null; }
    const add = (a, n) => { a.push(n); if (a.length > 120) a.shift(); };
    add(cpus, now-cpuStart); add(updates, updateEnd-cpuStart); add(submits, now-updateEnd);
    add(frameCalls, renderer.info.render.calls); add(frameTriangles, renderer.info.render.triangles); add(framePoints, renderer.info.render.points);
    if (now-lastPublish < 650) return;
    lastPublish = now;
    const inventory = inspectScene(app);
    const interval = mean(intervals), fps = 1000 / Math.max(1, interval), cpu = mean(cpus);
    const sorted = [...intervals].sort((a,b)=>a-b), p95 = sorted[Math.max(0, Math.ceil(sorted.length*.95)-1)] || 0;
    const heap = performance.memory;
    const cells = [
      ['FPS', fps.toFixed(1)], ['Draw Calls / 帧', fmt(mean(frameCalls))],
      ['提交三角面 / 帧', fmt(mean(frameTriangles))], ['场景三角面', fmt(inventory.triangles)],
      ['JS 帧耗时', ms(cpu)], ['GPU 渲染（采样）', ext ? (gpuMs === null ? '等待采样' : ms(gpuMs)) : '浏览器不支持'],
      ['更新 / 提交', `${mean(updates).toFixed(1)} / ${mean(submits).toFixed(1)} <small>ms</small>`], ['帧间隔 P95', ms(p95)],
      ['帧预算使用率¹', `${(cpu / (1000/60)*100).toFixed(0)}<small>%</small>`], ['JS 堆内存', heap ? `${(heap.usedJSHeapSize/1048576).toFixed(1)} <small>MB</small>` : '浏览器不提供'],
      ['几何体 / 纹理', `${fmt(renderer.info.memory.geometries)} / ${fmt(renderer.info.memory.textures)}`], ['着色器程序', fmt(renderer.info.programs?.length || 0)],
      ['画质 / 像素比', `${({low:'流畅',std:'均衡',high:'精细'})[app.quality]} / ${renderer.getPixelRatio().toFixed(2)}`],
      ['点 / 帧', fmt(mean(framePoints))], ['绘制分辨率', `${gl.drawingBufferWidth} × ${gl.drawingBufferHeight}`],
    ];
    el.querySelector('#perfMetrics').innerHTML = cells.map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
    graph.push(Math.min(120,fps)); if (graph.length > 60) graph.shift();
    el.querySelector('#perfGraphPath').setAttribute('d', graph.map((v,i)=>`${i?'L':'M'}${(i*300/59).toFixed(1)},${(36-v/120*35).toFixed(1)}`).join(' '));
    el.querySelector('#perfAuditTotal').textContent = `${inventory.instancedBatches} 批 · ${fmt(inventory.instances)} 实例`;
    el.querySelector('#perfAuditRows').innerHTML = inventory.rows.map(r=>`<tr><td>${r.name}<small class="perf-faces">${fmt(r.triangles)} 面</small></td><td>${r.batches} / ${fmt(r.instances)}</td><td>${r.mode}</td></tr>`).join('');
    app.performanceSnapshot = { timestamp: new Date().toISOString(), fps, calls:mean(frameCalls), submittedTriangles:mean(frameTriangles), sceneTriangles:inventory.triangles, cpuMs:cpu, updateMs:mean(updates), submitMs:mean(submits), gpuMs, p95Ms:p95, heapBytes:heap?.usedJSHeapSize ?? null, resources:{...renderer.info.memory}, inventory };
  }
  toggle(enabled);
  document.addEventListener('visibilitychange', () => { resetSamples(); clearQueries(); });
  return { begin, beforeRender, end, toggle, get enabled(){return enabled;} };
}

export function inspectScene(app) {
  const rows = new Map();
  const kinds = [ ['鱼类','按物种实例化'], ['虾与螺','按物种实例化'], ['前景草','实例化'], ['中后景与附生草','普通网格'], ['石材','独立网格'], ['沉木','单件合并网格'], ['底床','单一地形网格'], ['鱼食','实例化'], ['气泡','实例化缓冲几何体'], ['悬浮颗粒','Points 点精灵'], ['缸体与环境','普通网格'], ['玻璃','独立网格'], ['编辑辅助','普通网格 / 线段'] ];
  for (const [name,mode] of kinds) rows.set(name,{name,mode,batches:0,instances:0,triangles:0});
  const labels = new Map();
  const tag = (obj,label) => obj?.traverse(o=>labels.set(o,label));
  for (const s of app.fishes?.schools.values() || []) tag(s.im,'鱼类');
  for (const g of app.inverts?.groups.values() || []) tag(g.im,'虾与螺');
  for (const {item,mesh} of app.layout?.items.values() || []) tag(mesh, item.kind==='stone'?'石材':item.kind==='wood'?'沉木':'中后景与附生草');
  for (const c of app.plants?.carpets.values() || []) { tag(c.mesh,'前景草'); tag(c.im,'前景草'); }
  tag(app.plantBatches?.mesh,'中后景与附生草');
  if(app.plantBatches?.mesh) rows.get('中后景与附生草').mode='BatchedMesh 多绘制';
  tag(app.tank.glassGroup,'玻璃'); tag(app.ui?.gizmo?.group,'编辑辅助');
  tag(app.soil.mesh,'底床'); tag(app.fishes?.foodMesh,'鱼食'); tag(app.fx?.motes,'悬浮颗粒'); tag(app.fx?.bubbles,'气泡');
  let instancedBatches=0, instances=0, triangles=0;
  for (const scene of [app.scene,app.overlay]) scene.traverseVisible(o=>{
    const g=o.geometry;
    if(!g || !(o.isMesh||o.isPoints||o.isLine||o.isSprite) || (Array.isArray(o.material)?o.material.every(m=>!m.visible):o.material?.visible===false)) return;
    let n=o.isInstancedMesh?o.count:g.isInstancedBufferGeometry?g.instanceCount:1;
    if(!Number.isFinite(n)) n=g.attributes.aBub?.count || 0;
    if(n<=0)return;
    const name=labels.get(o) || (scene===app.overlay?'编辑辅助':'缸体与环境'), row=rows.get(name);
    const available=g.index?.count ?? g.attributes.position?.count ?? 0;
    const start=g.drawRange?.start||0, count=Math.min(Math.max(0,available-start),g.drawRange?.count??Infinity);
    const faces=o.userData?.plantBatch ? o.userData.activeTriangles : o.isSprite?2:o.isMesh?Math.floor(count/3)*n:0;
    row.batches++; row.instances+=o.userData?.plantBatch ? o.userData.activePlants : o.isPoints ? Math.min(count, available) : n; row.triangles+=faces; triangles+=faces;
    if(o.isInstancedMesh||g.isInstancedBufferGeometry){instancedBatches++;instances+=n;}
  });
  // Carpets use the field 'mesh'; identify by the actual geometry as a fallback.
  if (app.post) rows.set('水体与后期', {name:'水体与后期', mode:'全屏网格复用', batches:1, instances:1, triangles:2});
  return {rows:[...rows.values()],triangles,instancedBatches,instances};
}
