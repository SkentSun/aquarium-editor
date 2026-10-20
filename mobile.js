// One progressive-disclosure dock for desktop, tablet and phone.
const $ = s => document.querySelector(s);
const ICONS = {
  material: '<path d="m3 16 6-11 4 7 3-4 5 8Z"/><path d="M3 20h18"/>',
  fish: '<path d="M4 12c4-7 11-7 15 0-4 7-11 7-15 0Z"/><path d="m4 12-3-4v8Z"/><circle cx="15" cy="11" r=".6"/>',
  env: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  perf: '<path d="M4 20V12m8 8V4m8 16v-11M2 22h20"/>',
  views: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  project: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M2 5h20M3 9c3-2 6 2 9 0s6 2 9 0M7 20v-5m0 2-2-2m2 0 2-2"/><path d="M12 14c2-2 4-2 6 0-2 2-4 2-6 0Zm0 0-2-1v2Z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
export function initStudioDock(app, ui, h) {
  document.body.classList.add('docked');
  ui.touch = !!app.mobile;
  const left = $('#left'), tabs = $('#tabs');
  left.hidden = true; left.classList.remove('min');
  const heading = $('#leftHead span');
  const close = $('#leftToggle'); close.innerHTML = '<img class="ui-icon" src="icons/close.svg" alt="" aria-hidden="true">'; close.title = '关闭面板'; close.setAttribute('aria-label', '关闭面板');
  const dock = document.createElement('nav'); dock.id = 'studioDock'; dock.setAttribute('aria-label', '造景工具栏');
  dock.innerHTML = `<div class="dock-tools">${[['material','造景'],['fish','生物'],['env','环境'],['perf','性能'],['views','视角']].map(([id,label])=>`<button data-panel="${id}" aria-expanded="false" aria-controls="${id==='views'?'viewPopover':'left'}">${icon(id)}<span>${label}</span></button>`).join('')}<i class="dock-divider"></i><span id="dockHistory"></span><i class="dock-divider"></i><button data-panel="project" aria-expanded="false" aria-controls="projectPopover">${icon('project')}<span>鱼缸</span></button><span id="dockView"></span></div>`;
  const navigationHelp = document.createElement('p');
  navigationHelp.className = 'navigation-help';
  navigationHelp.textContent = app.mobile ? '单指拖动旋转视角 · 双指捏合缩放' : '按住鼠标中键拖动：旋转视角 · 滚动滚轮：缩放';
  dock.append(navigationHelp);
  document.body.append(dock);
  const supportButton = document.createElement('button');
  supportButton.className = 'support-button'; supportButton.type = 'button';
  supportButton.setAttribute('aria-haspopup', 'dialog'); supportButton.setAttribute('aria-controls', 'supportDialog');
  supportButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h12v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8Z"/><path d="M17 9h1a3 3 0 1 1 0 6h-1M3 22h16M8 2v3M12 2v3"/></svg><span>打赏</span>';
  navigationHelp.append(supportButton);
  const supportDialog = document.createElement('dialog'); supportDialog.id = 'supportDialog';
  supportDialog.setAttribute('aria-labelledby', 'supportTitle'); supportDialog.setAttribute('aria-describedby', 'supportDescription');
  supportDialog.innerHTML = '<button class="support-close" type="button" aria-label="关闭打赏窗口" autofocus><img class="ui-icon" src="icons/close.svg" alt=""></button><h2 id="supportTitle">请我喝杯咖啡</h2><p id="supportDescription">如果这个小工具对你有帮助，欢迎使用支付宝扫一扫，扫码打赏。</p><img class="support-qr" src="assets/support-qr.jpg" alt="打赏收款二维码" width="863" height="878"><p>感谢支持，让创作继续。</p>';
  document.body.append(supportDialog);
  supportDialog.addEventListener('keydown', e => e.stopPropagation());
  supportButton.onclick = () => { closePanels(); supportDialog.showModal(); };
  supportDialog.querySelector('.support-close').onclick = () => supportDialog.close();
  supportDialog.addEventListener('click', e => { if (e.target === supportDialog) { const r = supportDialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) supportDialog.close(); } });
  supportDialog.addEventListener('close', () => supportButton.focus());
  $('#dockHistory').append($('#undoBtn'), $('#redoBtn'));
  $('#undoBtn').innerHTML = '<img class="ui-icon" src="icons/undo.svg" alt="" aria-hidden="true">'; $('#redoBtn').innerHTML = '<img class="ui-icon" src="icons/redo.svg" alt="" aria-hidden="true">';
  $('#dockView').append($('#viewBtn')); $('#viewBtn').innerHTML = '<span class="dock-fullscreen" aria-hidden="true">⌗</span><span>欣赏</span>';
  const views = document.createElement('section'); views.id = 'viewPopover'; views.className = 'dock-popover'; views.hidden = true; views.setAttribute('aria-label', '切换视角');
  views.innerHTML = '<div class="popover-head"><span>视角</span><button data-dismiss aria-label="关闭视角面板"><img class="ui-icon" src="icons/close.svg" alt="" aria-hidden="true"></button></div>';
  const viewButtons = $('#views'); viewButtons.hidden = false; views.append(viewButtons);
  const project = document.createElement('section'); project.id = 'projectPopover'; project.className = 'dock-popover'; project.hidden = true; project.setAttribute('aria-label', '鱼缸与设置');
  project.innerHTML = '<div class="popover-head"><span>鱼缸</span><button data-dismiss aria-label="关闭鱼缸面板"><img class="ui-icon" src="icons/close.svg" alt="" aria-hidden="true"></button></div><div class="tank-setting"><label for="tankSel">鱼缸尺寸</label></div>';
  project.querySelector('.tank-setting').append($('#tankSel'));
  const projectMenu = $('#projectMenu'), sceneButton = $('#sceneBtn');
  project.append(projectMenu); projectMenu.open = true;
  project.querySelector('.project-actions').append(sceneButton);
  sceneButton.innerHTML = '水族箱概览<span id="sceneStatus" hidden></span>';
  document.body.append(views, project);
  const chip = document.createElement('div'); chip.id = 'dockToolStatus'; chip.hidden = true; document.body.append(chip);
  const exit = document.createElement('button'); exit.id = 'exitView'; exit.textContent = '退出欣赏'; exit.onclick = () => h.setView(false); document.body.append(exit);
  let active = null, lastMaterial = 'soil';
  const materialTabs = new Set(['soil','stone','wood','plant']);
  function closePanels({focus=false}={}) {
    const previous = active;
    active = null; left.hidden = true; views.hidden = true; project.hidden = true;
    syncButtons();
    if(focus && previous) dock.querySelector(`[data-panel="${previous}"]`)?.focus();
  }
  function syncButtons() {
    dock.querySelectorAll('[data-panel]').forEach(b => { const on = b.dataset.panel === active; b.classList.toggle('on', on); b.setAttribute('aria-expanded', String(on)); });
  }
  function openPanel(id) {
    if (active === id) { closePanels(); return; }
    closePanels(); h.setTool('select'); h.select(null);
    // Diagnostics is another optional panel, not a permanent part of the workspace.
    app.performance?.toggle(false);
    active = id;
    if (id === 'views') views.hidden = false;
    else if (id === 'project') { project.hidden = false; $('#projectMenu').open = true; }
    else {
      const tab = id === 'material' ? lastMaterial : id === 'fish' ? 'fish' : id === 'perf' ? 'perf' : 'env';
      tabs.querySelector(`[data-tab="${tab}"]`).click();
      left.hidden = false; left.dataset.section = id;
      heading.textContent = {material:'造景素材',fish:'添加生物',env:'环境设置',perf:'性能设置'}[id];
    }
    syncButtons();
  }
  dock.querySelectorAll('[data-panel]').forEach(b => b.onclick = () => openPanel(b.dataset.panel));
  tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if(materialTabs.has(b.dataset.tab)) lastMaterial = b.dataset.tab; }));
  close.onclick = () => closePanels({focus:true});
  for (const panel of [views,project]) panel.querySelector('[data-dismiss]').onclick = () => closePanels({focus:true});
  viewButtons.addEventListener('click', e => { if (e.target.closest('button')) closePanels(); });
  project.addEventListener('click', e => { if(e.target.closest('.project-actions button')) closePanels(); });
  const performanceButton = $('#performanceBtn');
  performanceButton.hidden = true;
  performanceButton.addEventListener('click', closePanels);
  document.addEventListener('pointerdown', e => {
    if(!active || dock.contains(e.target) || left.contains(e.target) || views.contains(e.target) || project.contains(e.target)) return;
    closePanels();
  });
  ui.closePanels = closePanels; ui.closeSheet = closePanels;
  ui.onToolChange = () => {
    const editing = ui.tool !== 'select'; chip.hidden = !editing;
    if(!editing) return;
    closePanels();
    const label = document.createElement('span'); label.textContent = `${ui.tool === 'brush' ? '绘制' : '放置'} · ${h.toolName()}`;
    const end = document.createElement('button'); end.textContent = '完成'; end.onclick = () => h.setTool('select');
    chip.replaceChildren(label);
    if(ui.tool === 'brush') {
      const range = document.createElement('input'); range.type='range'; range.min='0.01'; range.max='0.1'; range.step='0.005'; range.value=ui.brush.r; range.setAttribute('aria-label','画笔大小'); range.oninput = () => ui.brush.r=Number(range.value); chip.append(range);
    }
    chip.append(end);
  };
  ui.onSelect = () => { if(ui.sel) closePanels(); };
  ui.updateHistory = () => { $('#undoBtn').disabled = ui.hist.length < 2; $('#redoBtn').disabled = !ui.fut.length; };
  ui.updateInset = () => {
    const mobile = matchMedia('(max-width: 760px)').matches || app.mobile;
    app.layoutMode = mobile ? 'm' : 'dock';
    const compact = matchMedia('(max-width: 480px)').matches;
    const historyHost = compact ? $('#projectMenu .project-actions') : $('#dockHistory');
    for (const id of ['undoBtn','redoBtn']) if ($('#'+id).parentNode !== historyHost) historyHost.append($('#'+id));
    app.setInset({x:0,y:document.body.classList.contains('view')?0:78});
    const viewing = document.body.classList.contains('view');
    if(viewing) { closePanels(); app.performance?.toggle(false); }
    $('#viewBtn').setAttribute('aria-pressed', String(viewing));
  };
  addEventListener('resize', ui.updateInset);
  ui.updateInset(); ui.updateHistory();
  app.performance?.toggle(false);
  // Keep the visible workspace quiet even when an older bookmark contains perf=1.
  const url = new URL(location.href); if(url.searchParams.has('perf')) { url.searchParams.delete('perf'); history.replaceState(null,'',url); }
  $('#top').remove();
}
