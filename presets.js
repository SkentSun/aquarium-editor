// Authored layout states and matching screenshots, all editable after loading.
export const PRESETS = [
  { id:'forest', name:'沉木水草森林', tag:'茂密森林', file:'presets/forest.json?v=natural11', thumb:'presets/previews/forest.png?v=natural11', desc:'90cm · 左高右低的沉木绿丛，前景留出自然水道，宝莲灯群游。' },
  { id:'river', name:'自然溪流', tag:'自然溪流', file:'presets/river.json?v=natural11', thumb:'presets/previews/river.png?v=natural11', desc:'90cm · 低伏的溪石与两岸苦草，中央保留开阔的卵石河床。' },
  { id:'stone-meadow', name:'青龙石原野', tag:'开阔石景', file:'presets/stone-meadow.json?v=natural11', thumb:'presets/previews/stone-meadow.png?v=natural11', desc:'90cm · 同向倾斜的青龙石群，草坡随地形起伏，右侧留出空地。' },
  { id:'crimson-garden', name:'赤叶暮色', tag:'暖色水草', file:'presets/crimson-garden.json?v=natural11', thumb:'presets/previews/crimson-garden.png?v=natural11', desc:'60cm 宽缸 · 绿草丛围合红叶焦点，沉木连接中景，火焰灯成群游动。' },
  { id:'white-shore', name:'白砂溪岸', tag:'清爽留白', file:'presets/white-shore.json?v=natural11', thumb:'presets/previews/white-shore.png?v=natural11', desc:'60cm · 单侧石木草岸与开阔白砂浅滩，砂道向远处自然收窄。' },
  { id:'root-sanctuary', name:'树根秘境', tag:'沉木岛景', file:'presets/root-sanctuary.json?v=natural11', thumb:'presets/previews/root-sanctuary.png?v=natural11', desc:'90cm · 一组树根与落木构成岛景，蕨类、榕叶和莫丝逐层过渡。' },
];
const cache = new Map();
export async function presetState(p) {
  if (!cache.has(p.file)) cache.set(p.file, fetch(p.file).then(r => { if(!r.ok) throw new Error('示例加载失败'); return r.json(); }));
  try { return structuredClone(await cache.get(p.file)); } catch(error) { cache.delete(p.file); throw error; }
}
