// Экраны: меню, верфь (семя + симуляция), бой, награды, пауза, итоги, лаборатория.
(function (E2) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  let meta = E2.loadMeta();
  let game = null;
  let run = null;     // { mutations, pendingRewards, ended, graft }
  let yard = null;    // { size, seed: [{t, inh}|null], strainId, mutations, sel, hist, simOn }
  let stack = [];

  // ---------- Навигация ----------
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
    $('btn-pause').classList.toggle('hidden', !!id || !game || game.isOver());
  }
  function go(id) { stack.push(id); show(id); refresh(id); }
  function back() { stack.pop(); const id = stack[stack.length - 1] || 'screen-menu'; show(id); refresh(id); }
  function refresh(id) {
    if (id === 'screen-menu') renderMenu();
    if (id === 'screen-lab') renderLab();
    if (id === 'screen-yard') renderYard();
  }
  for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', back);

  // ---------- Меню ----------
  function renderMenu() {
    const el = $('menu-stats');
    if (!meta.runs) { el.innerHTML = '<span class="muted">Чашка Петри пуста. Посади первое семя.</span>'; return; }
    el.innerHTML = `
      <div><b>${meta.runs}</b><span>забегов</span></div>
      <div><b>${meta.bestWave}</b><span>лучшая волна</span></div>
      <div><b>${meta.bestPeak}</b><span>макс. клеток</span></div>
      <div><b>${meta.biomass}</b><span>биомассы</span></div>`;
  }
  $('btn-yard').addEventListener('click', () => go('screen-yard'));
  $('btn-lab').addEventListener('click', () => go('screen-lab'));
  $('btn-help').addEventListener('click', () => go('screen-help'));

  // ---------- Отрисовка сетки клеток (DOM) ----------
  // getCell(i) -> {t, inh?} | null ; power — Uint8Array ; onTap(i)
  function renderCellGrid(el, size, getCell, power, onTap, canTap) {
    el.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    el.classList.toggle('readonly', !onTap);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < size * size; i++) {
      const c = getCell(i);
      const d = document.createElement('div');
      d.className = 'gcell';
      if (power && power[i]) d.classList.add('powered');
      if (c) {
        const def = E2.CELLS[c.t];
        d.classList.add('filled');
        if (power && !power[i] && c.t !== 'core') d.classList.add('unpowered');
        if (c.inh) d.classList.add('inh');
        d.style.setProperty('--c', def.color);
        d.textContent = def.icon;
        d.title = def.name;
      } else if (canTap && canTap(i)) d.classList.add('can');
      if (onTap) d.addEventListener('click', () => onTap(i));
      frag.appendChild(d);
    }
    el.innerHTML = '';
    el.appendChild(frag);
  }

  function strainThumb(strain, px) {
    const cv = document.createElement('canvas');
    const s = strain.size;
    cv.width = s * px; cv.height = s * px;
    const c = cv.getContext('2d');
    c.fillStyle = '#081110';
    c.fillRect(0, 0, cv.width, cv.height);
    strain.cells.forEach((t, i) => {
      if (!t) return;
      c.fillStyle = E2.CELLS[t].color;
      c.fillRect((i % s) * px, ((i / s) | 0) * px, px - 1, px - 1);
    });
    return cv;
  }

  function renderGenome(el, rules) {
    el.innerHTML = '';
    for (const r of E2.ruleTexts(rules, meta.unlocked)) {
      const d = document.createElement('div');
      const def = E2.CELLS[r.cell];
      d.className = 'rule' + (r.mod ? ' mod' : '');
      d.style.setProperty('--c', def.color);
      d.innerHTML = `<b>${def.icon} ${def.name}.</b> ${r.text}`;
      el.appendChild(d);
    }
  }

  // ---------- Верфь ----------
  function initYard() {
    meta = E2.loadMeta();
    const size = E2.gridSize(meta);
    const seed = new Array(size * size).fill(null);
    let strainId = null, mutations = {};
    const ls = meta.lastSeed;
    if (ls && ls.cells) {
      const types = E2.recenter(ls.cells.map((c) => (c ? c.t : null)), ls.size, size);
      const inh = E2.recenter(ls.cells.map((c) => (c && c.inh ? 'x' : null)), ls.size, size);
      types.forEach((t, i) => { if (t && t !== 'core') seed[i] = { t, inh: !!inh[i] }; });
      const st = meta.strains.find((s) => s.id === ls.strainId);
      if (st) { strainId = st.id; mutations = Object.assign({}, st.mutations); }
      else seed.forEach((c, i) => { if (c) c.inh = false; });
    }
    const ci = E2.coreIndex(size);
    if (!ls) {
      // стартовое семя для первого знакомства
      const put = (dx, dy, t) => { seed[ci + dy * size + dx] = { t, inh: false }; };
      put(-1, 1, 'armor'); put(0, 1, 'armor'); put(1, 1, 'armor');
      put(-1, -1, 'gun'); put(0, -1, 'gun'); put(1, -1, 'gun');
    }
    seed[ci] = { t: 'core', inh: false };
    // семя могло стать больше лимита (например, после сброса) — обрезаем лишнее
    let manual = 0;
    seed.forEach((c, i) => {
      if (!c || c.t === 'core' || c.inh) return;
      if (++manual > E2.seedSlots(meta) || !meta.unlocked.includes(c.t)) seed[i] = null;
    });
    yard = { size, seed, strainId, mutations, sel: meta.unlocked[0], hist: null, simOn: false, simTick: 0 };
  }

  const manualCount = () => yard.seed.filter((c) => c && c.t !== 'core' && !c.inh).length;
  const seedTypes = () => yard.seed.map((c) => (c ? c.t : null));
  const yardRules = () => E2.buildRules(yard.mutations, meta);

  function renderYard() {
    if (!yard) initYard();
    const rules = yardRules();
    $('yard-info').textContent = `Слоты семени: ${manualCount()} / ${E2.seedSlots(meta)} · сетка ${yard.size}×${yard.size}${yard.strainId ? ' · штамм загружен (клетки с зелёной точкой не занимают слоты)' : ''}`;

    // палитра
    const pal = $('yard-palette');
    pal.innerHTML = '';
    for (const t of meta.unlocked) {
      const def = E2.CELLS[t];
      const b = document.createElement('button');
      b.className = 'pal' + (yard.sel === t ? ' sel' : '');
      b.style.setProperty('--c', def.color);
      b.innerHTML = `<span class="ic">${def.icon}</span>${def.name}`;
      b.title = def.desc;
      b.addEventListener('click', () => { yard.sel = t; stopSim(); renderYard(); });
      pal.appendChild(b);
    }
    const er = document.createElement('button');
    er.className = 'pal' + (yard.sel === null ? ' sel' : '');
    er.style.setProperty('--c', '#888');
    er.innerHTML = '<span class="ic">⌫</span>Стереть';
    er.addEventListener('click', () => { yard.sel = null; stopSim(); renderYard(); });
    pal.appendChild(er);

    // сетка
    if (yard.simOn && yard.hist) {
      const h = yard.hist[yard.simTick];
      renderCellGrid($('yard-grid'), yard.size, (i) => h.grid.cells[i], h.power, null);
      const c = E2.countCells(h.grid);
      $('sim-stats').textContent = `клеток ${c.total}: ` + E2.TYPES.filter((t) => c[t]).map((t) => `${E2.CELLS[t].icon}${c[t]}`).join('  ');
    } else {
      const g = E2.gridFromTypes(yard.size, seedTypes(), rules);
      renderCellGrid($('yard-grid'), yard.size, (i) => yard.seed[i], E2.computePower(g, rules), onYardTap);
      $('sim-stats').textContent = 'Зелёная подсветка — зона питания. Нажми ▶, чтобы увидеть, во что вырастет семя.';
    }
    $('sim-toggle').textContent = yard.simOn ? '✎ Редактировать' : '▶ Симуляция';
    $('sim-slider').disabled = !yard.simOn;
    $('sim-slider').value = yard.simTick;
    $('sim-label').textContent = `такт ${yard.simOn ? yard.simTick : 0}`;

    renderGenome($('yard-genome'), rules);

    // штаммы
    const sl = $('yard-strains');
    sl.innerHTML = '';
    if (!meta.strains.length) sl.innerHTML = '<p class="muted small">Штаммы появятся после первого забега.</p>';
    for (const st of meta.strains.slice().reverse()) {
      const b = document.createElement('button');
      b.className = 'strain' + (yard.strainId === st.id ? ' sel' : '');
      b.appendChild(strainThumb(st, 4));
      const info = document.createElement('div');
      const muts = Object.keys(st.mutations || {}).length;
      info.innerHTML = `<b>${escapeHtml(st.name)}</b><div class="meta">${st.peak} клеток · волна ${st.wave} · мутаций ${muts}</div>
        <div class="meta">${yard.strainId === st.id ? 'загружен — нажми, чтобы выгрузить' : 'нажми, чтобы загрузить как семя'}</div>`;
      b.appendChild(info);
      b.addEventListener('click', () => { stopSim(); toggleStrain(st); });
      sl.appendChild(b);
    }
  }

  function onYardTap(i) {
    const cur = yard.seed[i];
    if (cur && cur.t === 'core') return;
    if (yard.sel === null || (cur && cur.t === yard.sel)) {
      yard.seed[i] = null;
    } else {
      if ((!cur || cur.inh) && manualCount() >= E2.seedSlots(meta)) { flash('Слоты семени закончились. Расширь их в лаборатории.'); return; }
      yard.seed[i] = { t: yard.sel, inh: false };
    }
    renderYard();
  }

  function toggleStrain(st) {
    const size = yard.size;
    // убираем унаследованные клетки старого штамма
    yard.seed.forEach((c, i) => { if (c && c.inh) yard.seed[i] = null; });
    if (yard.strainId === st.id) {
      yard.strainId = null;
      yard.mutations = {};
    } else {
      yard.strainId = st.id;
      yard.mutations = Object.assign({}, st.mutations);
      const types = E2.recenter(st.cells, st.size, size);
      types.forEach((t, i) => {
        if (!t || t === 'core' || yard.seed[i]) return;
        if (t !== 'core' && !meta.unlocked.includes(t)) return;
        yard.seed[i] = { t, inh: true };
      });
    }
    renderYard();
  }

  function flash(msg) { $('sim-stats').textContent = msg; }

  function startSim() {
    const rules = yardRules();
    const types = seedTypes();
    yard.hist = E2.simulate(E2.gridFromTypes(yard.size, types, rules), rules, E2.PREVIEW_TICKS, E2.seedHash(types));
    yard.simOn = true;
    yard.simTick = 0;
    $('sim-slider').max = E2.PREVIEW_TICKS;
    renderYard();
    clearInterval(yard.timer);
    yard.timer = setInterval(() => {
      if (!yard.simOn) return clearInterval(yard.timer);
      if (yard.simTick >= E2.PREVIEW_TICKS) return clearInterval(yard.timer);
      yard.simTick++;
      renderYard();
    }, 180);
  }
  function stopSim() { if (yard) { yard.simOn = false; clearInterval(yard.timer); } }
  $('sim-toggle').addEventListener('click', () => { if (yard.simOn) { stopSim(); renderYard(); } else startSim(); });
  $('sim-slider').addEventListener('input', (e) => { clearInterval(yard.timer); yard.simTick = +e.target.value; renderYard(); });
  $('yard-clear').addEventListener('click', () => {
    stopSim();
    yard.seed = yard.seed.map((c) => (c && c.t === 'core' ? c : null));
    yard.strainId = null;
    yard.mutations = {};
    renderYard();
  });
  $('yard-start').addEventListener('click', startRun);

  // ---------- Забег ----------
  function startRun() {
    stopSim();
    meta.lastSeed = { size: yard.size, cells: yard.seed.map((c) => (c ? { t: c.t, inh: c.inh } : null)), strainId: yard.strainId };
    E2.saveMeta(meta);

    const mutations = Object.assign({}, yard.mutations);
    const startMuts = [];
    for (let k = 0; k < E2.upg(meta, 'heritage'); k++) {
      const pool = availableMutations(mutations);
      if (!pool.length) break;
      const m = pool[(Math.random() * pool.length) | 0];
      mutations[m.id] = (mutations[m.id] || 0) + 1;
      startMuts.push(m.name);
    }
    const rules = E2.buildRules(mutations, meta);
    const types = seedTypes();
    run = { mutations, pendingRewards: 0, ended: false, graft: null };
    if (game) game.destroy();
    game = E2.createGame(canvas, {
      meta,
      rules,
      grid: E2.gridFromTypes(yard.size, types, rules),
      seed: E2.seedHash(types),
      hooks: {
        onWaveEnd() { run.pendingRewards++; if ($('screen-reward').classList.contains('hidden')) setTimeout(openReward, 0); },
        onDeath(stats) { endRun(stats); },
      },
    });
    stack = [];
    show(null);
    game.start();
    if (startMuts.length) setTimeout(() => toast(`Наследственность: ${startMuts.join(', ')}`), 300);
  }

  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function availableMutations(muts) {
    return E2.MUTATIONS.filter((m) => {
      if (m.cell && m.cell !== 'core' && !meta.unlocked.includes(m.cell)) return false;
      const have = muts[m.id] || 0;
      return have < (m.stack || 1);
    });
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function openReward() {
    if (!game || game.isOver() || run.pendingRewards <= 0) return;
    game.pause();
    const muts = shuffle(availableMutations(run.mutations)).slice(0, 2);
    const graftType = meta.unlocked[(Math.random() * meta.unlocked.length) | 0];
    const offers = muts.map((m) => ({ kind: 'mut', m }));
    offers.push({ kind: 'graft', t: graftType, count: graftType === 'gun' || graftType === 'reactor' ? 2 : 3 });
    if (offers.length < 3) offers.unshift({ kind: 'heal' });

    $('reward-title').textContent = `Волна пережита! Выбери награду${run.pendingRewards > 1 ? ` (ещё ${run.pendingRewards})` : ''}`;
    $('graft-box').classList.add('hidden');
    const box = $('reward-cards');
    box.classList.remove('hidden');
    box.innerHTML = '';
    for (const o of shuffle(offers)) {
      const card = document.createElement('button');
      card.className = 'offer';
      let color, icon, name, kind, desc;
      if (o.kind === 'mut') {
        const cellDef = o.m.cell ? E2.CELLS[o.m.cell] : null;
        color = cellDef ? cellDef.color : '#ffd43b';
        icon = cellDef ? cellDef.icon : '☯';
        name = o.m.name;
        kind = `мутация${cellDef ? ' · ' + cellDef.name.toLowerCase() : ''}${o.m.stack ? ` · ${(run.mutations[o.m.id] || 0) + 1}/${o.m.stack}` : ''}`;
        desc = o.m.desc;
      } else if (o.kind === 'graft') {
        const d = E2.CELLS[o.t];
        color = d.color; icon = d.icon;
        name = `Прививка: ${d.name}`;
        kind = `поставь ${o.count} клетки прямо в живой корабль`;
        desc = d.desc;
      } else {
        color = '#69db7c'; icon = '✚'; name = 'Заживление'; kind = 'лечение';
        desc = 'Все клетки корабля полностью восстанавливают прочность.';
      }
      card.style.setProperty('--c', color);
      card.innerHTML = `<div class="offer-icon">${icon}</div><div class="offer-name">${name}</div><div class="offer-kind">${kind}</div><div class="offer-desc">${desc}</div>`;
      card.addEventListener('click', () => pickReward(o));
      box.appendChild(card);
    }
    show('screen-reward');
  }

  function pickReward(o) {
    if (o.kind === 'mut') {
      run.mutations[o.m.id] = (run.mutations[o.m.id] || 0) + 1;
      game.setRules(E2.buildRules(run.mutations, meta));
      finishReward();
    } else if (o.kind === 'heal') {
      const rules = game.getRules();
      for (const c of game.getGrid().cells) if (c) c.hp = E2.maxHp(c.t, rules);
      finishReward();
    } else {
      run.graft = { t: o.t, left: o.count };
      $('reward-cards').classList.add('hidden');
      $('graft-box').classList.remove('hidden');
      renderGraft();
    }
  }

  function renderGraft() {
    const g = game.getGrid();
    const d = E2.CELLS[run.graft.t];
    $('reward-title').textContent = `Прививка: ${d.icon} ${d.name}`;
    $('graft-info').textContent = `Осталось клеток: ${run.graft.left}. Нажми на пустую клетку (лучше — в зелёной зоне питания).`;
    renderCellGrid($('graft-grid'), g.size, (i) => g.cells[i], game.getPower(), (i) => {
      if (run.graft.left <= 0 || g.cells[i]) return;
      if (game.graft(i, run.graft.t)) run.graft.left--;
      if (run.graft.left <= 0) finishReward(); else renderGraft();
    }, (i) => !g.cells[i]);
  }
  $('graft-done').addEventListener('click', finishReward);

  function finishReward() {
    run.graft = null;
    run.pendingRewards = Math.max(0, run.pendingRewards - 1);
    if (run.pendingRewards > 0) { openReward(); return; }
    show(null);
    game.resume();
  }

  // ---------- Пауза ----------
  function openPause() {
    if (!game || game.isOver() || !$('screen-reward').classList.contains('hidden')) return;
    game.pause();
    const g = game.getGrid();
    renderCellGrid($('pause-grid'), g.size, (i) => g.cells[i], game.getPower(), null);
    renderGenome($('pause-genome'), game.getRules());
    const ml = $('pause-mutations');
    ml.innerHTML = '';
    const ids = Object.keys(run.mutations);
    if (!ids.length) ml.innerHTML = '<span class="muted small">Пока нет. Мутации даются после каждой волны.</span>';
    for (const id of ids) {
      const m = E2.MUTATIONS.find((x) => x.id === id);
      const s = document.createElement('span');
      s.className = 'mut';
      s.title = m.desc;
      s.textContent = m.name + (run.mutations[id] > 1 ? ` ×${run.mutations[id]}` : '');
      ml.appendChild(s);
    }
    show('screen-pause');
  }
  function closePause() { show(null); game.resume(); }
  $('btn-pause').addEventListener('click', openPause);
  $('pause-continue').addEventListener('click', closePause);
  $('pause-quit').addEventListener('click', () => {
    if (!confirm('Завершить забег? Пиковая форма корабля сохранится как штамм.')) return;
    endRun(game.stats());
  });
  window.addEventListener('keydown', (e) => {
    if (!game || game.isOver() || !run || run.ended) return;
    if (e.code !== 'KeyE' && e.code !== 'Tab' && e.code !== 'Escape') return;
    e.preventDefault();
    if (!$('screen-pause').classList.contains('hidden')) closePause();
    else if ($('screen-reward').classList.contains('hidden')) openPause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && !game.isOver() && !game.isPaused() && run && !run.ended) openPause();
  });

  // ---------- Итоги ----------
  function endRun(stats) {
    if (!run || run.ended) return;
    run.ended = true;
    game.pause();
    const harvest = 1 + 0.15 * E2.upg(meta, 'harvest');
    const biomass = Math.floor((Math.floor(stats.kills / 3) + stats.wave * stats.wave * 3 + stats.bossKills * 25 + stats.peak) * harvest);
    meta.runs++;
    meta.biomass += biomass;
    meta.totalKills += stats.kills;
    meta.bestWave = Math.max(meta.bestWave, stats.wave);
    meta.bestPeak = Math.max(meta.bestPeak, stats.peak);

    let strain = null;
    if (stats.peak > 1 && stats.peakTypes) {
      strain = {
        id: Date.now().toString(36),
        name: `Штамм №${meta.runs}`,
        run: meta.runs,
        wave: stats.wave,
        size: stats.size,
        cells: stats.peakTypes,
        mutations: Object.assign({}, run.mutations),
        peak: stats.peak,
      };
      meta.strains.push(strain);
      while (meta.strains.length > E2.MAX_STRAINS) meta.strains.shift();
    }
    E2.saveMeta(meta);
    yard = null; // верфь перечитает мету

    const mins = Math.floor(stats.time / 60), secs = Math.floor(stats.time % 60);
    $('results-body').innerHTML = `
      <div class="res-grid">
        <div><b>${stats.wave}</b><span>волна</span></div>
        <div><b>${stats.kills}</b><span>убийств</span></div>
        <div><b>${stats.peak}</b><span>пик клеток</span></div>
        <div><b class="c-green">+${biomass}</b><span>биомассы</span></div>
      </div>
      <p class="muted small">Время: ${mins}:${String(secs).padStart(2, '0')} · мутаций: ${Object.keys(run.mutations).length}</p>`;
    if (strain) {
      const box = document.createElement('div');
      box.className = 'res-strain';
      box.innerHTML = `<div>Пиковая форма сохранена: <b class="c-green">${strain.name}</b></div>`;
      box.appendChild(strainThumb(strain, 8));
      const note = document.createElement('div');
      note.className = 'muted small';
      note.textContent = 'Загрузи его на верфи как готовое семя — вместе с мутациями.';
      box.appendChild(note);
      $('results-body').appendChild(box);
    }
    show('screen-results');
  }

  function leaveRun() {
    if (game) { game.destroy(); game = null; }
    run = null;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  $('res-yard').addEventListener('click', () => { leaveRun(); stack = ['screen-menu']; go('screen-yard'); });
  $('res-lab').addEventListener('click', () => { leaveRun(); stack = ['screen-menu']; go('screen-lab'); });
  $('res-menu').addEventListener('click', () => { leaveRun(); stack = []; go('screen-menu'); });

  // ---------- Лаборатория ----------
  function renderLab() {
    $('lab-biomass').innerHTML = `<span class="c-green">✦</span> ${meta.biomass} биомассы`;
    const up = $('lab-upgrades');
    up.innerHTML = '';
    for (const u of E2.UPGRADES) {
      const lvl = E2.upg(meta, u.id);
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : u.cost(lvl);
      const card = document.createElement('div');
      card.className = 'card' + (maxed ? ' maxed' : '');
      card.innerHTML = `<div class="card-title">${u.name} <span class="pips">${'●'.repeat(lvl)}${'○'.repeat(u.max - lvl)}</span></div>
        <div class="card-desc">${u.desc(lvl)}${maxed ? '' : ` <span class="muted">→ ${u.desc(lvl + 1).split(':').pop().trim()}</span>`}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn small' + (!maxed && meta.biomass >= cost ? ' primary' : '');
      btn.textContent = maxed ? 'Максимум' : `✦ ${cost}`;
      btn.disabled = maxed || meta.biomass < cost;
      btn.addEventListener('click', () => { meta.biomass -= cost; meta.upgrades[u.id] = lvl + 1; E2.saveMeta(meta); yard = null; renderLab(); });
      card.appendChild(btn);
      up.appendChild(card);
    }
    const un = $('lab-unlocks');
    un.innerHTML = '';
    for (const u of E2.UNLOCKS) {
      const def = E2.CELLS[u.id];
      const have = meta.unlocked.includes(u.id);
      const card = document.createElement('div');
      card.className = 'card' + (have ? ' maxed' : '');
      card.innerHTML = `<div class="card-title"><span style="color:${def.color}">${def.icon}</span> ${def.name}</div><div class="card-desc">${def.desc}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn small' + (!have && meta.biomass >= u.cost ? ' primary' : '');
      btn.textContent = have ? 'Открыта' : `✦ ${u.cost}`;
      btn.disabled = have || meta.biomass < u.cost;
      btn.addEventListener('click', () => { meta.biomass -= u.cost; meta.unlocked.push(u.id); E2.saveMeta(meta); yard = null; renderLab(); });
      card.appendChild(btn);
      un.appendChild(card);
    }
  }
  $('lab-yard').addEventListener('click', () => go('screen-yard'));
  $('lab-reset').addEventListener('click', () => {
    if (!confirm('Стереть весь прогресс эксперимента? Это необратимо.')) return;
    meta = E2.resetMeta();
    yard = null;
    renderLab();
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  go('screen-menu');
  if (!meta.seenHelp) { meta.seenHelp = true; E2.saveMeta(meta); go('screen-help'); }

  E2._app = { get meta() { return meta; }, get run() { return run; }, get game() { return game; }, get yard() { return yard; }, startRun, openReward, openPause };
})(window.E2);
