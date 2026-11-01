// Клеточный автомат корабля. Чистые функции: одинаковое семя + правила + сид => одинаковый рост.
//
// Сетка: { size, cells: Array(size*size) of cell|null }
// Клетка: { t: тип, hp, age }
(function (E2) {
  'use strict';

  const T = E2.TYPES;
  const NT = T.length;
  const TI = {};
  T.forEach((t, i) => { TI[t] = i; });
  E2.TI = TI;

  // ---------- Правила ----------
  E2.buildRules = function (mutations, meta) {
    const m = (id) => mutations[id] || 0;
    const unlocked = meta.unlocked;
    const pool = m('mutagenTame') ? ['armor', 'gun', 'reactor'] : unlocked.slice();
    return {
      coreR: 2 + m('coreR'),
      reactorR: 1,
      armorBirth: m('armorB1') ? 1 : 2,
      gunBirth: m('gunB2') ? [2, 3] : [3],
      gunCrowd: 5,
      reactorEvery: m('reactorFast') ? 4 : 8,
      sporeCrowd: 4,
      mutagenEvery: 6,
      mutagenPool: pool.filter((t) => t !== 'core'),
      regen: !!m('regen'),
      pulse: !!m('pulse'),
      heavyGun: !!m('heavyGun'),
      thorns: !!m('thorns'),
      sporeMine: !!m('sporeMine'),
      sporeFeed: !!m('sporeFeed'),
      nerveGun: !!m('nerveGun'),
      gunRange: 1 + 0.35 * m('gunRange'),
      spikeMul: 1 + m('spikeDmg'),
      hpMul: 1 + 0.3 * m('hardShell'),
      tickMul: Math.pow(0.8, m('fastTick')),
      coreBonus: 40 * E2.upg(meta, 'coreHp'),
    };
  };

  E2.maxHp = (t, rules) => (E2.CELLS[t].hp + (t === 'core' ? rules.coreBonus : 0)) * rules.hpMul;
  E2.mkCell = (t, rules, frac = 1) => ({ t, hp: E2.maxHp(t, rules) * frac, age: 0 });

  E2.makeGrid = (size) => ({ size, cells: new Array(size * size).fill(null) });
  E2.coreIndex = (size) => ((size - 1) / 2) * size + (size - 1) / 2;

  E2.cloneGrid = (g) => ({ size: g.size, cells: g.cells.map((c) => (c ? { t: c.t, hp: c.hp, age: c.age } : null)) });

  // Семя (массив типов) -> живая сетка
  E2.gridFromTypes = function (size, types, rules) {
    const g = E2.makeGrid(size);
    for (let i = 0; i < types.length; i++) if (types[i]) g.cells[i] = E2.mkCell(types[i], rules);
    return g;
  };
  E2.typesFromGrid = (g) => g.cells.map((c) => (c ? c.t : null));

  // Перенос массива типов на сетку другого размера (по центру).
  E2.recenter = function (types, fromSize, toSize) {
    const out = new Array(toSize * toSize).fill(null);
    const off = (toSize - fromSize) / 2;
    for (let y = 0; y < fromSize; y++) {
      for (let x = 0; x < fromSize; x++) {
        const t = types[y * fromSize + x];
        if (!t) continue;
        const nx = x + off, ny = y + off;
        if (nx >= 0 && ny >= 0 && nx < toSize && ny < toSize) out[ny * toSize + nx] = t;
      }
    }
    return out;
  };

  // Детерминированный ГПСЧ.
  E2.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---------- Питание ----------
  E2.computePower = function (grid, rules) {
    const n = grid.size;
    const power = new Uint8Array(n * n);
    const queue = [];
    const radiate = (i, r) => {
      const cx = i % n, cy = (i / n) | 0;
      for (let y = Math.max(0, cy - r); y <= Math.min(n - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(n - 1, cx + r); x++) {
          const j = y * n + x;
          if (power[j]) continue;
          power[j] = 1;
          const c = grid.cells[j];
          if (c && c.t === 'reactor') queue.push(j);
        }
      }
    };
    for (let i = 0; i < grid.cells.length; i++) {
      const c = grid.cells[i];
      if (c && c.t === 'core') radiate(i, rules.coreR);
    }
    while (queue.length) radiate(queue.pop(), rules.reactorR);
    return power;
  };

  // ---------- Соседи ----------
  function countNeighbors(grid) {
    const n = grid.size;
    const cnt = new Uint8Array(n * n * NT);
    const tot = new Uint8Array(n * n);
    const orthNerve = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = grid.cells[y * n + x];
        if (!c) continue;
        const ti = TI[c.t];
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= n) continue;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= n) continue;
            const j = ny * n + nx;
            cnt[j * NT + ti]++;
            tot[j]++;
            if (c.t === 'nerve' && (dx === 0 || dy === 0)) orthNerve[j]++;
          }
        }
      }
    }
    return { cnt, tot, orthNerve };
  }
  E2.countNeighbors = countNeighbors;

  function neighborsOf(i, n) {
    const out = [];
    const x = i % n, y = (i / n) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < n && ny < n) out.push(ny * n + nx);
      }
    }
    return out;
  }
  E2.neighborsOf = neighborsOf;

  // ---------- Такт ----------
  // Возвращает { grid, events, power } — events: [{ type: 'sporeDeath', i }]
  E2.tick = function (grid, rules, tickNo, seed) {
    const n = grid.size;
    const power = E2.computePower(grid, rules);
    const { cnt, tot, orthNerve } = countNeighbors(grid);
    const N = (i, t) => cnt[i * NT + TI[t]];
    const next = new Array(n * n).fill(null);
    const events = [];

    for (let i = 0; i < n * n; i++) {
      const c = grid.cells[i];
      if (c) {
        let nc = { t: c.t, hp: c.hp, age: c.age + 1 };
        if (c.t !== 'core') {
          const max = E2.maxHp(c.t, rules);
          if (!power[i]) {
            let starve = c.t === 'spore' ? 0.5 : 0.34;
            if (c.t === 'spore' && rules.sporeFeed && N(i, 'armor') > 0) starve = 0;
            nc.hp -= max * starve;
          }
          if (c.t === 'gun' && N(i, 'gun') >= rules.gunCrowd) nc.hp = 0;
          if (c.t === 'spore' && N(i, 'spore') >= rules.sporeCrowd) nc.hp = 0;
          if (c.t === 'nerve' && orthNerve[i] >= 3) nc.hp = 0;
          if (nc.hp > 0 && rules.regen && power[i] && N(i, 'reactor') > 0) nc.hp = Math.min(max, nc.hp + max * 0.15);
          if (nc.hp <= 0) {
            if (c.t === 'spore') events.push({ type: 'sporeDeath', i });
            nc = null;
          }
        }
        next[i] = nc;
      } else {
        let born = null;
        if (power[i]) {
          if (rules.gunBirth.includes(N(i, 'gun'))) born = 'gun';
          else if (rules.nerveGun && N(i, 'nerve') >= 1 && N(i, 'gun') >= 2) born = 'gun';
          else if (orthNerve[i] === 1 && N(i, 'nerve') === 1) born = 'nerve';
          else if (N(i, 'spike') >= 1 && N(i, 'armor') >= 1 && tot[i] <= 3) born = 'spike';
          else if (N(i, 'armor') >= rules.armorBirth) born = 'armor';
        }
        if (!born) {
          const s = N(i, 'spore');
          if (s >= 1 && s <= 2 && tot[i] <= 4) born = 'spore';
        }
        if (born) next[i] = E2.mkCell(born, rules, 0.6);
      }
    }

    // Превращения (по состоянию старой сетки, детерминированно).
    const rnd = E2.rng((seed ^ Math.imul(tickNo + 1, 2654435761)) >>> 0);
    for (let i = 0; i < n * n; i++) {
      const c = grid.cells[i];
      if (!c || !next[i] || next[i].t !== c.t) continue;
      if (c.t === 'reactor' && power[i] && (tickNo + i) % rules.reactorEvery === 0) {
        const cand = neighborsOf(i, n).filter((j) => next[j] && next[j].t === 'armor' && grid.cells[j] && grid.cells[j].t === 'armor' && N(j, 'reactor') === 1);
        if (cand.length) {
          const j = cand[(rnd() * cand.length) | 0];
          next[j] = E2.mkCell('reactor', rules, Math.min(1, next[j].hp / E2.maxHp('armor', rules)));
        }
      } else if (c.t === 'mutagen' && (tickNo + i) % rules.mutagenEvery === 0 && rules.mutagenPool.length) {
        const cand = neighborsOf(i, n).filter((j) => next[j] && next[j].t !== 'core' && next[j].t !== 'mutagen');
        if (cand.length) {
          const j = cand[(rnd() * cand.length) | 0];
          const pool = rules.mutagenPool.filter((t) => t !== next[j].t && t !== 'mutagen');
          if (pool.length) next[j] = E2.mkCell(pool[(rnd() * pool.length) | 0], rules, 0.8);
        }
      }
    }

    return { grid: { size: n, cells: next }, events, power: E2.computePower({ size: n, cells: next }, rules) };
  };

  // Ускорение пушек от нервных сетей: множитель темпа для каждой клетки.
  E2.nerveBoost = function (grid) {
    const n = grid.size;
    const comp = new Int32Array(n * n).fill(-1);
    const sizes = [];
    for (let i = 0; i < n * n; i++) {
      const c = grid.cells[i];
      if (!c || c.t !== 'nerve' || comp[i] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [i];
      comp[i] = id;
      while (stack.length) {
        const k = stack.pop();
        size++;
        const x = k % n, y = (k / n) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          const cj = grid.cells[j];
          if (cj && cj.t === 'nerve' && comp[j] < 0) { comp[j] = id; stack.push(j); }
        }
      }
      sizes.push(size);
    }
    const boost = new Float32Array(n * n).fill(1);
    if (!sizes.length) return boost;
    for (let i = 0; i < n * n; i++) {
      const c = grid.cells[i];
      if (!c || c.t !== 'gun') continue;
      const seen = new Set();
      let total = 0;
      for (const j of neighborsOf(i, n)) {
        if (comp[j] >= 0 && !seen.has(comp[j])) { seen.add(comp[j]); total += sizes[comp[j]]; }
      }
      boost[i] = 1 + 0.12 * Math.min(total, 15);
    }
    return boost;
  };

  E2.countCells = function (grid) {
    const out = { total: 0 };
    for (const t of T) out[t] = 0;
    for (const c of grid.cells) if (c) { out[c.t]++; out.total++; }
    return out;
  };

  // Предпросмотр: история роста без врагов.
  E2.simulate = function (grid, rules, ticks, seed) {
    const hist = [{ grid, power: E2.computePower(grid, rules) }];
    let g = grid;
    for (let k = 0; k < ticks; k++) {
      const r = E2.tick(g, rules, k, seed);
      g = r.grid;
      hist.push({ grid: g, power: r.power });
    }
    return hist;
  };

  E2.seedHash = function (types) {
    let h = 2166136261;
    for (let i = 0; i < types.length; i++) {
      const v = types[i] ? TI[types[i]] + 1 : 0;
      h ^= v + i * 31;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  // Текстовое описание правил (с подсветкой изменённых мутациями).
  E2.ruleTexts = function (rules, unlocked) {
    const has = (t) => t === 'core' || unlocked.includes(t);
    const out = [];
    const add = (cell, text, mod) => { if (has(cell)) out.push({ cell, text, mod: !!mod }); };
    add('core', `Питает клетки в радиусе ${rules.coreR}. Клетки без питания голодают и гибнут за 3 такта.`, rules.coreR > 2);
    add('armor', `Рождается в запитанной пустой клетке, если рядом ≥${rules.armorBirth} брони.${rules.thorns ? ' Ранит врагов.' : ''}`, rules.armorBirth < 2 || rules.thorns);
    add('gun', `Рождается, если рядом ${rules.gunBirth.join(' или ')} пушки${rules.nerveGun ? ' (или нерв + 2 пушки)' : ''}; гибнет при ≥${rules.gunCrowd} соседях-пушках.${rules.heavyGun ? ' В окружении 4+ брони — тяжёлый калибр.' : ''}`, rules.gunBirth.length > 1 || rules.heavyGun || rules.nerveGun || rules.gunRange > 1);
    add('reactor', `Запитанный реактор питает радиус ${rules.reactorR}. Раз в ${rules.reactorEvery} тактов превращает соседнюю броню в реактор.${rules.regen ? ' Лечит соседей.' : ''}${rules.pulse ? ' Пульсар: залп каждый 8-й такт.' : ''}`, rules.reactorEvery < 8 || rules.regen || rules.pulse);
    add('spore', `Рождается рядом с 1–2 спорами (даже без питания), если вокруг ≤4 клеток; гибнет при ≥${rules.sporeCrowd} спорах рядом.${rules.sporeFeed ? ' Не голодает рядом с бронёй.' : ''}${rules.sporeMine ? ' Взрывается при гибели.' : ''}`, rules.sporeFeed || rules.sporeMine);
    add('spike', `Рождается рядом с бронёй и шипом, если вокруг ≤3 клеток (край корабля).${rules.spikeMul > 1 ? ` Урон ×${rules.spikeMul}.` : ''}`, rules.spikeMul > 1);
    add('nerve', 'Рождается, если рядом ровно один нерв (по стороне); гибнет при ≥3 нервах по сторонам. Ускоряет соседние пушки.', false);
    add('mutagen', `Раз в ${rules.mutagenEvery} тактов превращает соседа в: ${rules.mutagenPool.filter((t) => t !== 'mutagen').map((t) => E2.CELLS[t].name.toLowerCase()).join(', ')}.`, rules.mutagenPool.length <= 3);
    return out;
  };
})(window.E2);
