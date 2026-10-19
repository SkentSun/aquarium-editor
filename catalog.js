

// 水槽（内寸に近い外寸）。glass = ガラス厚
export const TANKS = [
  { id: '30c', name: '30cm 立方缸', w: 0.30, d: 0.30, h: 0.30, glass: 0.005},
  { id: '45p', name: '45cm 窄型缸', w: 0.45, d: 0.27, h: 0.30, glass: 0.005},
  { id: '60p', name: '60cm 标准缸', w: 0.60, d: 0.30, h: 0.36, glass: 0.006},
  { id: '60h', name: '60cm 宽缸', w: 0.60, d: 0.45, h: 0.45, glass: 0.008},
  { id: '90p', name: '90cm 标准缸', w: 0.90, d: 0.45, h: 0.45, glass: 0.010},
  { id: '120p', name: '120cm 大型', w: 1.20, d: 0.45, h: 0.45, glass: 0.012},
];

// 底床。bagL = 1袋の容量(L)、grain = 粒径(m)
export const SOILS = [
  { id: 'aquasoil', name: '营养水草泥（棕色）', tex: 's_aquasoil', grain: 0.003, bagL: 9,
    desc: '适合水草生长的营养底泥，适用于弱酸性软水。', tint: [0.24, 0.17, 0.12] },
  { id: 'black', name: '富士砂（黑色）', tex: 's_black', grain: 0.002, bagL: 5,
    desc: '黑色火山砂，色调沉稳，衬托生物色彩。', tint: [0.08, 0.08, 0.08] },
  { id: 'oiso', name: '大矶砂', tex: 's_oiso', grain: 0.005, bagL: 6,
    desc: '传统耐用砾石，易于维护。', tint: [0.33, 0.31, 0.28] },
  { id: 'tasuna', name: '田砂', tex: 's_tasuna', grain: 0.0008, bagL: 5,
    desc: '自然色细砂，适合鼠鱼活动。', tint: [0.62, 0.53, 0.42] },
  { id: 'white', name: '白砂', tex: 's_white', grain: 0.0015, bagL: 5,
    desc: '明亮清爽的白砂，衬托生物颜色。', tint: [0.86, 0.83, 0.77] },
];

export const STONES = [
  { id: 'seiryu', name: '青龙石', tex: 'r_seiryu', density: 2.7, shape: 'seiryu',
    desc: '棱角鲜明，带白色纹理，是石景造景常用石材。', tint: [0.42, 0.45, 0.47] },
  { id: 'ryuoh', name: '龙王石', tex: 'r_ryuoh', density: 2.4, shape: 'ryuoh',
    desc: '孔洞丰富、色调温暖的土黄色石材。', tint: [0.47, 0.37, 0.25] },
  { id: 'lava', name: '溶岩石', tex: 'r_lava', density: 1.2, shape: 'lava',
    desc: '轻质多孔，适合附生水草和细菌附着。', tint: [0.22, 0.13, 0.11] },
  { id: 'kasei', name: '木化石', tex: 'r_kasei', density: 2.5, shape: 'kasei',
    desc: '保留木纹的石化材质，质感独特。', tint: [0.52, 0.42, 0.32] },
];
export const STONE_SIZES = [
  { id: 's', name: '小', size: 0.06 }, { id: 'm', name: '中', size: 0.11 }, { id: 'l', name: '大', size: 0.17 }, { id: 'xl', name: '特大', size: 0.24 },
];

export const WOODS = [
  { id: 'branch', name: '枝状沉木', shape: 'branch', desc: '细枝舒展，适合营造森林景观。' },
  { id: 'single', name: '单枝沉木', shape: 'single', desc: '粗壮弯曲的单枝沉木，适合作为视觉主体。' },
  { id: 'root', name: '树根沉木', shape: 'root', desc: '根部向外伸展，适合搭建大型造景骨架。' },
];
export const WOOD_SIZES = [{ id: 's', name: '小', size: 0.16 }, { id: 'm', name: '中', size: 0.26 }, { id: 'l', name: '大', size: 0.38 }];

// 水草。mode: carpet = ブラシで敷く / clump = 点击で株を植える / epiphyte = 石や沉木に活着
// coverage = 1 盆が覆う面積(m²)（carpet。株分けして薄く植えた場合、90cm 水槽の前景一面で 20 盆前後）
// perPot = 1 盆（杯）で置ける数（epiphyte のモスは小さな塊いくつ分か）
export const PLANTS = [
  { id: 'hc', name: '迷你矮珍珠', mode: 'carpet', kind: 'carpet', leaf: 'lf_carpet', h: 0.012, coverage: 0.018,
    desc: '叶片极小，可铺出细密草坪，建议添加 CO2。', color: [0.30, 0.62, 0.20] },
  { id: 'montecarlo', name: '趴地矮珍珠', mode: 'carpet', kind: 'carpet', leaf: 'lf_carpet', h: 0.022, coverage: 0.02,
    desc: '圆叶生长茂密，是较易养护的前景草。', color: [0.36, 0.64, 0.22], scale: 1.6 },
  { id: 'hairgrass', name: '矮牛毛毡', mode: 'carpet', kind: 'hairgrass', h: 0.06, coverage: 0.018,
    desc: '细叶随水流摇曳，呈现草原效果。', color: [0.34, 0.58, 0.18] },
  { id: 'rotala', name: '圆叶节节菜（宫廷草）', mode: 'clump', kind: 'stem', leaf: 'lf_rotala', h: 0.18,
    desc: '顶端泛红的有茎草，适合后景丛植。', color: [0.55, 0.45, 0.25], tip: [0.95, 0.42, 0.38] },
  { id: 'ludwigia', name: '红宝石丁香', mode: 'clump', kind: 'stem', leaf: 'lf_ludwigia', h: 0.16,
    desc: '深酒红色圆叶，为造景增添红色点缀。', color: [0.45, 0.12, 0.10], tip: [0.62, 0.12, 0.10], leafSize: 1.5 },
  { id: 'hygro', name: '小对叶水蓑衣', mode: 'clump', kind: 'stem', leaf: 'lf_green', h: 0.19,
    desc: '鲜绿且耐养，适合新手的有茎草。', color: [0.40, 0.62, 0.20], tip: [0.55, 0.72, 0.30], leafSize: 1.4 },
  { id: 'crypt', name: '温蒂椒草', mode: 'clump', kind: 'rosette', leaf: 'lf_crypt', h: 0.1,
    desc: '波浪状古铜色叶片，丰富中景层次。', color: [0.24, 0.22, 0.12] },
  { id: 'sword', name: '皇冠草', mode: 'clump', kind: 'rosette', leaf: 'lf_sword', h: 0.2,
    desc: '大而剑形的叶片呈放射状伸展。', color: [0.35, 0.60, 0.20], big: true },
  { id: 'valis', name: '苦草', mode: 'clump', kind: 'ribbon', leaf: 'valis', h: 0.38,
    desc: '带状长叶随水流飘动，适合后景。', color: [0.40, 0.62, 0.25] },
  { id: 'anubias', name: '小水榕', mode: 'epiphyte', kind: 'anubias', leaf: 'lf_anubias', h: 0.06,
    desc: '可附着于石材或沉木，耐养且耐阴。', color: [0.09, 0.22, 0.07] },
  { id: 'fern', name: '铁皇冠', mode: 'epiphyte', kind: 'fern', leaf: 'lf_fern', h: 0.14,
    desc: '细长叶片的水生蕨类，可附着于沉木。', color: [0.13, 0.27, 0.08] },
  { id: 'moss', name: '爪哇莫丝', mode: 'epiphyte', kind: 'moss', leaf: 'moss', h: 0.02, perPot: 4, unit: '杯',
    desc: '为沉木和石材营造苔藓覆盖的景观。', color: [0.22, 0.44, 0.14] },
];

// 生物。cm = 成魚の全長、zone = 泳ぐ層 [下, 上]（0 底 .. 1 水面）、school = 群れの強さ
// predator: 口に入る小型魚を食べる可能性、nipper: ヒレをかじる、fighter: 同種オス同士で争う
export const FISH = [
  { id: 'cardinal', name: '宝莲灯', cm: 4, zone: [0.3, 0.75], school: 0.95, speed: 1.0,
    desc: '蓝红条纹醒目，群游效果出色。', minGroup: 10 },
  { id: 'neon', name: '红绿灯', cm: 3.5, zone: [0.3, 0.8], school: 0.95, speed: 1.0,
    desc: '经典小型灯鱼，耐养且喜欢群游。', minGroup: 10 },
  { id: 'rummynose', name: '红鼻剪刀', cm: 4.5, zone: [0.25, 0.7], school: 1.0, speed: 1.2,
    desc: '鼻端鲜红，群游整齐。', minGroup: 10 },
  { id: 'harlequin', name: '三角灯', cm: 4, zone: [0.35, 0.8], school: 0.8, speed: 0.9,
    desc: '带黑色楔形斑纹，性情温和，喜欢群游。', minGroup: 8 },
  { id: 'ember', name: '火焰灯', cm: 2, zone: [0.3, 0.8], school: 0.85, speed: 0.9,
    desc: '体型极小，呈鲜艳橙红色。', minGroup: 12 },
  { id: 'guppy', name: '孔雀鱼（雄鱼）', cm: 4, zone: [0.5, 0.95], school: 0.3, speed: 0.7,
    desc: '尾鳍宽大，色彩华丽。', minGroup: 3 },
  { id: 'medaka', name: '杨贵妃青鳉', cm: 3.5, zone: [0.75, 0.98], school: 0.6, speed: 0.8, cold: true,
    desc: '朱红色青鳉，常在水面附近活动。', minGroup: 5 },
  { id: 'honey', name: '蜜糖丽丽鱼', cm: 4, zone: [0.4, 0.9], school: 0.1, speed: 0.5,
    desc: '蜜黄色的温和丝足鲈。', minGroup: 1 },
  { id: 'betta', name: '半月斗鱼', cm: 6, zone: [0.5, 0.95], school: 0, speed: 0.4, fighter: true, nipper: true,
    desc: '鱼鳍华丽，雄鱼之间不宜混养。', minGroup: 1 },
  { id: 'angel', name: '神仙鱼', cm: 12, zone: [0.35, 0.85], school: 0.2, speed: 0.5, predator: true,
    desc: '姿态优雅的慈鲷，可能捕食小鱼。', minGroup: 1, tall: true },
  { id: 'cory', name: '熊猫鼠鱼', cm: 4, zone: [0.0, 0.08], school: 0.6, speed: 0.6, bottom: true,
    desc: '在底部活动，可清理残饵。', minGroup: 3 },
  { id: 'oto', name: '小精灵鱼', cm: 4, zone: [0.0, 0.9], school: 0.2, speed: 0.4, grazer: true,
    desc: '啃食玻璃和叶片上的藻类。', minGroup: 2 },
  // ---- 追加種（のショップでよく扱われる魚）
  { id: 'greenneon', name: '绿莲灯', cm: 2.5, zone: [0.3, 0.8], school: 0.95, speed: 1.0,
    desc: '蓝绿色线条贯穿身体，适合小型鱼缸。', minGroup: 10 },
  { id: 'blackneon', name: '黑莲灯', cm: 3.5, zone: [0.3, 0.8], school: 0.9, speed: 1.0,
    desc: '黑色条纹搭配白色亮线，耐养且色调沉稳。', minGroup: 10 },
  { id: 'glowlight', name: '红灯管', cm: 3.5, zone: [0.3, 0.8], school: 0.9, speed: 1.0,
    desc: '带发光般的橙色线条，温和耐养。', minGroup: 10 },
  { id: 'redphantom', name: '红幻影灯', cm: 4, zone: [0.3, 0.75], school: 0.8, speed: 0.9,
    desc: '身体呈半透明红色，肩部有黑斑。', minGroup: 8 },
  { id: 'penguin', name: '企鹅灯', cm: 5, zone: [0.45, 0.9], school: 0.85, speed: 1.0,
    desc: '黑色条纹延伸至尾鳍，习惯倾斜游动。', minGroup: 8 },
  { id: 'hanabi', name: '银河斑马', cm: 2.5, zone: [0.12, 0.55], school: 0.5, speed: 0.8,
    desc: '身体布满星点，鱼鳍泛红，喜欢水草遮蔽处。', minGroup: 8 },
  { id: 'boraras', name: '辣椒灯鱼', cm: 1.8, zone: [0.4, 0.9], school: 0.85, speed: 0.9,
    desc: '鲜红的迷你波鱼，适合小型鱼缸。', minGroup: 12 },
  { id: 'espei', name: '小三角灯', cm: 3, zone: [0.35, 0.8], school: 0.8, speed: 0.9,
    desc: '铜色身体带细长楔形斑纹。', minGroup: 8 },
  { id: 'zebra', name: '斑马鱼', cm: 5, zone: [0.5, 0.95], school: 0.9, speed: 1.4,
    desc: '蓝金相间的条纹，活泼耐养。', minGroup: 6 },
  { id: 'platy', name: '红月光鱼', cm: 5, zone: [0.4, 0.9], school: 0.3, speed: 0.7,
    desc: '红色身体搭配黑色鱼鳍，温和，适合新手。', minGroup: 3 },
  { id: 'molly', name: '黑玛丽', cm: 7, zone: [0.5, 0.95], school: 0.3, speed: 0.7,
    desc: '身体呈绒黑色，也会啃食藻类。', minGroup: 3 },
  { id: 'dwarfgourami', name: '丽丽鱼', cm: 6, zone: [0.4, 0.9], school: 0.1, speed: 0.5,
    desc: '红蓝条纹相间，以丝状腹鳍探索环境。', minGroup: 1 },
  { id: 'pearlgourami', name: '珍珠马甲', cm: 10, zone: [0.4, 0.9], school: 0.1, speed: 0.5,
    desc: '带珍珠般斑点和橙色胸部，适合较大鱼缸。', minGroup: 1 },
  { id: 'discus', name: '七彩神仙鱼', cm: 15, zone: [0.35, 0.8], school: 0.5, speed: 0.45, tall: true, expert: true,
    desc: '色彩丰富，需要较高水温及细致水质管理。', minGroup: 3 },
  { id: 'ram', name: '德国蓝波子', cm: 5, zone: [0.05, 0.4], school: 0.1, speed: 0.5,
    desc: '身体闪烁蓝光，眼睛泛红，常在下层缓慢活动。', minGroup: 1 },
  { id: 'apisto', name: '阿卡西短鲷', cm: 7, zone: [0.05, 0.4], school: 0.1, speed: 0.5,
    desc: '尾鳍宽大的小型慈鲷，具有领地意识。', minGroup: 1 },
  { id: 'bristlenose', name: '胡子异型', cm: 10, zone: [0.0, 0.9], school: 0.1, speed: 0.4, grazer: true,
    desc: '附着在沉木和石材上啃食藻类。', minGroup: 1 },
  { id: 'siamese', name: '黑线飞狐', cm: 10, zone: [0.1, 0.6], school: 0.3, speed: 1.0,
    desc: '带黑色纵线，擅长清理藻类。', minGroup: 1 },
  { id: 'kuhli', name: '库氏鳅', cm: 8, zone: [0.0, 0.06], school: 0.5, speed: 0.5, bottom: true,
    desc: '身体细长、带条纹，喜欢在底部成群活动。', minGroup: 3 },
  { id: 'dwarfpuffer', name: '巧克力娃娃', cm: 2.5, zone: [0.3, 0.8], school: 0.1, speed: 0.4, eatsShrimp: true, nipper: true,
    desc: '体型极小的淡水河豚，会捕食虾和螺。', minGroup: 1 },
  { id: 'ryukin', name: '琉金', cm: 12, zone: [0.3, 0.9], school: 0.3, speed: 0.5, cold: true, eatsPlants: true, tall: true,
    desc: '身体圆润、尾鳍修长的金鱼，会啃食水草。', minGroup: 1 },
  { id: 'yaritanago', name: '矛形田中鳑鲏', cm: 8, zone: [0.3, 0.8], school: 0.7, speed: 1.0, cold: true,
    desc: '婚姻色艳丽的鱊类。', minGroup: 5 },
  { id: 'endlers', name: '安德拉斯孔雀鱼', cm: 2.5, zone: [0.5, 0.95], school: 0.4, speed: 0.8,
    desc: '原生型孔雀鱼，体型小巧、色彩鲜艳。', minGroup: 3 },
  { id: 'shimadojo', name: '条纹花鳅', cm: 9, zone: [0.0, 0.06], school: 0.3, speed: 0.5, bottom: true, cold: true,
    desc: '带斑点花纹的泥鳅，喜欢钻沙。', minGroup: 2 },
  // ---- 淡水原生鱼（無加温で飼える川魚）。jumps: 驚くと飛び出すのでフタが必要、patrol: 群れの定位置を持たず水槽を周回する大きめの川魚
  { id: 'oikawa', name: '宽鳍鱲（婚姻色雄鱼）', cm: 13, zone: [0.45, 0.95], school: 0.6, speed: 1.3, cold: true, jumps: true, patrol: true,
    desc: '婚姻色呈蓝绿与朱红色，喜欢在有水流的环境群游。', minGroup: 5 },
  { id: 'kawamutsu', name: '纵纹鱲', cm: 12, zone: [0.35, 0.9], school: 0.5, speed: 1.1, cold: true, jumps: true, predator: true, patrol: true,
    desc: '带深蓝色宽纵纹，会捕食能吞下的小鱼和虾。', minGroup: 3 },
  { id: 'aburahaya', name: '斯丹氏鱥', cm: 10, zone: [0.3, 0.85], school: 0.7, speed: 1.0, cold: true, jumps: true, patrol: true,
    desc: '带细密斑点的溪流鱼，适合较低水温。', minGroup: 5 },
  { id: 'baratanago', name: '高体鳑鲏', cm: 5, zone: [0.3, 0.8], school: 0.6, speed: 0.9, cold: true,
    desc: '婚姻色呈粉紫色，耐养的小型鳑鲏。', minGroup: 5 },
  { id: 'motsugo', name: '麦穗鱼', cm: 7, zone: [0.25, 0.8], school: 0.7, speed: 1.0, cold: true,
    desc: '嘴部上翘，带黑色纵线，是池塘常见小鱼。', minGroup: 5 },
  { id: 'kawabata', name: '锦波鱼', cm: 4, zone: [0.4, 0.9], school: 0.85, speed: 1.0, cold: true,
    desc: '身体泛金光的小型鲤科鱼，群游优美。', minGroup: 8 },
  { id: 'dojo', name: '泥鳅', cm: 12, zone: [0.0, 0.05], school: 0.2, speed: 0.4, bottom: true, cold: true,
    desc: '用触须探索底床，性情温和，在底部觅食。', minGroup: 2 },
  { id: 'yoshinobori', name: '吻虾虎鱼', cm: 6, zone: [0.0, 0.06], school: 0, speed: 0.6, bottom: true, perch: true, cold: true, fighter: true, eatsShrimp: true,
    desc: '腹鳍呈吸盘状，常附着于石材，具有领地意识。', minGroup: 1 },
];

// 魚の分類（生物タブの見出し）
export const FISH_GROUPS = [
  ['小型脂鲤（灯鱼）', ['cardinal', 'neon', 'greenneon', 'blackneon', 'glowlight', 'rummynose', 'ember', 'redphantom', 'penguin']],
  ['波鱼与斑马鱼', ['harlequin', 'espei', 'hanabi', 'boraras', 'zebra']],
  ['卵胎生鱼（孔雀鱼、月光鱼等）', ['guppy', 'endlers', 'platy', 'molly']],
  ['丝足鲈与斗鱼', ['honey', 'dwarfgourami', 'pearlgourami', 'betta']],
  ['慈鲷', ['angel', 'discus', 'ram', 'apisto']],
  ['底栖与清洁鱼', ['cory', 'kuhli', 'oto', 'bristlenose', 'siamese', 'dwarfpuffer']],
  ['淡水原生鱼', ['medaka', 'oikawa', 'kawamutsu', 'aburahaya', 'yaritanago', 'baratanago', 'motsugo', 'kawabata', 'shimadojo', 'dojo', 'yoshinobori']],
  ['金鱼', ['ryukin']],
];

