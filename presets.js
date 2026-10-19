// Authored layout states and matching screenshots, all editable after loading.
export const PRESETS = [
  { id:'forest', name:'沉木水草森林', tag:'茂密森林', file:'presets/forest.json', thumb:'presets/previews/forest.png', desc:'90cm · 枝状沉木、莫丝和丰富水草，搭配多种热带鱼。' },
  { id:'river', name:'自然溪流', tag:'自然溪流', file:'presets/river.json', thumb:'presets/previews/river.png', desc:'90cm · 大矶砂、青龙石与苦草，搭配淡水原生鱼。' },
  { id:'stone-meadow', name:'青龙石原野', tag:'开阔石景', file:'presets/stone-meadow.json', thumb:'presets/previews/stone-meadow.png', desc:'90cm · 高低错落的青龙石与矮珍珠草坪，红绿灯群游。' },
  { id:'crimson-garden', name:'赤叶暮色', tag:'暖色水草', file:'presets/crimson-garden.json', thumb:'presets/previews/crimson-garden.png', desc:'60cm 宽缸 · 红宝石丁香与宫廷草，搭配火焰灯和蓝波子。' },
  { id:'white-shore', name:'白砂溪岸', tag:'清爽留白', file:'presets/white-shore.json', thumb:'presets/previews/white-shore.png', desc:'60cm · 白砂浅滩、木化石与两侧水草，搭配青鳉和米虾。' },
  { id:'root-sanctuary', name:'树根秘境', tag:'沉木岛景', file:'presets/root-sanctuary.json', thumb:'presets/previews/root-sanctuary.png', desc:'90cm · 树根沉木、龙王石与蕨类水草，搭配三角灯和鼠鱼。' },
];
const cache = new Map();
export async function presetState(p) {
  if (!cache.has(p.file)) cache.set(p.file, fetch(p.file).then(r => { if(!r.ok) throw new Error('示例加载失败'); return r.json(); }));
  try { return structuredClone(await cache.get(p.file)); } catch(error) { cache.delete(p.file); throw error; }
}
