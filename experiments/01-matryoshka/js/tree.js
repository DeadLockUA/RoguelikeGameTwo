// Дерево сборки: узлы (схемы снарядов), предметы-модули и компиляция в боевые спецификации.
//
// Узел (node)  = { slots: [item|null, ...] } — схема одного снаряда (корень — схема корабля).
// Предмет (item) = { uid, type, child?: node, fossil?: {...} }
//   у триггеров есть child — схема вложенного снаряда, т.е. «снаряд внутри снаряда».
(function (E1) {
  'use strict';

  let uidCounter = 1;
  E1.uid = () => (Date.now().toString(36) + (uidCounter++).toString(36));

  E1.newNode = (slots) => ({ slots: new Array(slots).fill(null) });

  E1.maxDepth = (meta) => 1 + E1.upg(meta, 'depth');
  E1.rootSlots = (meta) => 2 + E1.upg(meta, 'rootSlots');
  E1.childSlots = (meta) => 1 + E1.upg(meta, 'childSlots');
  E1.fossilSlots = (meta) => 1 + E1.upg(meta, 'fossilSlots');
  E1.fossilPower = (meta) => 0.5 + 0.1 * E1.upg(meta, 'fossilPower');

  E1.makeItem = function (type, meta) {
    const def = E1.MODS[type];
    const item = { uid: E1.uid(), type };
    if (def.kind === 'trigger') item.child = E1.newNode(E1.childSlots(meta));
    return item;
  };

  E1.makeFossilItem = function (fossil) {
    return {
      uid: E1.uid(),
      type: 'fossil',
      fossil: { id: fossil.id, name: fossil.name, wave: fossil.wave, node: E1.clone(fossil.node) },
    };
  };

  E1.clone = (o) => JSON.parse(JSON.stringify(o));

  // Высота предмета: сколько уровней вложенности он добавляет ниже себя.
  // Окаменелости «заморожены» и не расходуют лимит глубины.
  E1.itemHeight = function (item) {
    if (!item || E1.MODS[item.type].kind !== 'trigger') return 0;
    return 1 + E1.nodeHeight(item.child);
  };
  E1.nodeHeight = function (node) {
    let h = 0;
    for (const it of node.slots) h = Math.max(h, E1.itemHeight(it));
    return h;
  };

  // Можно ли вставить предмет в узел глубины depth.
  E1.canPlace = (item, depth, meta) => depth + E1.itemHeight(item) <= E1.maxDepth(meta);

  E1.countModules = function (node) {
    let n = 0;
    for (const it of node.slots) {
      if (!it) continue;
      n++;
      if (it.child) n += E1.countModules(it.child);
      if (it.fossil) n += E1.countModules(it.fossil.node);
    }
    return n;
  };

  // ---------- Компиляция дерева в спецификации для симуляции ----------
  const MAX_COMPILE_DEPTH = 8;

  E1.compile = function (node, meta) {
    return compileNode(node, 0, 1, meta);
  };
  E1.compileAt = (node, depth, power, meta) => compileNode(node, depth, power, meta);

  function compileNode(node, depth, power, meta) {
    const s = {
      depth,
      dmgMul: 1, speedMul: 1, pierce: 0, sizeMul: 1, homing: 0, lifeMul: 1, rateMul: 1, multi: 0,
      triggers: [],
    };
    for (const it of node.slots) {
      if (!it) continue;
      switch (it.type) {
        case 'dmg': s.dmgMul += 0.4; break;
        case 'speed': s.speedMul += 0.25; break;
        case 'pierce': s.pierce += 1; break;
        case 'rate': s.rateMul += 0.25; break;
        case 'size': s.sizeMul += 0.35; break;
        case 'homing': s.homing += 4; break;
        case 'life': s.lifeMul += 0.4; break;
        case 'multi': s.multi += 1; break;
      }
    }
    if (depth < MAX_COMPILE_DEPTH) {
      for (const it of node.slots) {
        if (!it) continue;
        const def = E1.MODS[it.type];
        if (def.kind === 'trigger') {
          s.triggers.push({
            kind: it.type,
            interval: def.interval ? def.interval / s.rateMul : 0,
            count: def.count,
            child: compileNode(it.child, depth + 1, power, meta),
          });
        } else if (def.kind === 'fossil') {
          s.triggers.push({
            kind: 'fossil',
            interval: def.interval / s.rateMul,
            count: 1,
            child: compileNode(it.fossil.node, depth + 1, power * E1.fossilPower(meta), meta),
          });
        }
      }
    }
    s.dmg = 10 * Math.pow(0.62, depth) * s.dmgMul * power;
    s.speed = 460 * Math.pow(0.85, depth) * s.speedMul;
    s.life = (depth === 0 ? 0.9 : 0.7) * s.lifeMul;
    s.r = Math.max(2.5, 5 - 0.6 * depth) * s.sizeMul;
    s.color = E1.DEPTH_COLORS[Math.min(depth, E1.DEPTH_COLORS.length - 1)];
    s.fireInterval = 0.45 / s.rateMul; // используется только корнем (огонь корабля)
    return s;
  }
})(window.E1);
