// Эксперимент 3 «Оптический стол»: бой (лучи поверх общей арены), редактор стола, лаборатория.
(function (E3, E99) {
  'use strict';

  const $ = E99.$;
  const canvas = $('game');
  const TAU = Math.PI * 2;
  const store = E99.createStore('e99.exp3', () => ({
    version: 1, photons: 0, upgrades: {}, unlocked: E3.START_UNLOCKED.slice(),
    relics: [], runs: 0, bestWave: 0, totalKills: 0, seenHelp: false,
  }));
  let meta = store.load();
  const upg = (id) => meta.upgrades[id] || 0;
  const CUR = { key: 'photons', icon: '✧' };

  let arena = null;
  let run = null; // { bench, inventory: [type], selected, tool, offers, pendingLevels, optics, powerBuff, ended }
  let editorMode = null;

  const nav = E99.createScreens({
    home: 'screen-menu',
    refresh(id) { if (id === 'screen-menu') renderMenu(); if (id === 'screen-lab') renderLab(); },
    onShow(id) { $('btn-pause').classList.toggle('hidden', !!id || !arena || arena.isOver()); },
  });

  // ---------- Меню ----------
  function renderMenu() {
    const el = $('menu-stats');
    if (!meta.runs) { el.innerHTML = '<span class="muted">Стол пуст. Только лазер и твоя геометрия.</span>'; return; }
    el.innerHTML = `<div><b>${meta.runs}</b><span>забегов</span></div><div><b>${meta.bestWave}</b><span>лучшая волна</span></div>
      <div><b>${meta.relics.length}</b><span>реликвий</span></div><div><b>${meta.photons}</b><span>фотонов</span></div>`;
  }
  $('btn-start').addEventListener('click', startRun);
  $('btn-lab').addEventListener('click', () => nav.go('screen-lab'));
  $('btn-help').addEventListener('click', () => nav.go('screen-help'));

  // ---------- Лаборатория ----------
  function renderLab() {
    $('lab-currency').innerHTML = `<span style="color:var(--accent)">✧</span> ${meta.photons} фотонов`;
    const save = () => { store.save(meta); renderLab(); };
    E99.renderUpgrades($('lab-upgrades'), E3.UPGRADES, meta, CUR, save);
    E99.renderUnlocks($('lab-unlocks'), E3.UNLOCKS, E3.ELEMENTS, meta, CUR, save);
    const rl = $('lab-relics');
    rl.innerHTML = meta.relics.length
      ? meta.relics.map((t) => { const d = E3.ELEMENTS[t]; return `<span class="relic" style="--c:${d.color}">${d.icon} ${d.name}</span>`; }).join('')
      : '<span class="muted small">Пока нет. В конце забега можно сохранить один элемент со стола.</span>';
  }
  $('lab-start').addEventListener('click', startRun);
  $('lab-reset').addEventListener('click', () => { if (confirm('Стереть весь прогресс эксперимента?')) { meta = store.reset(); renderLab(); } });

  // ---------- Забег ----------
  function benchSize() { return 5 + upg('bench'); }
  function powerBase() { return 40 * (1 + 0.15 * upg('power')) * (run ? run.powerBuff : 1); }

  function retrace() {
    run.optics = E3.trace(run.bench, powerBase());
  }

  function startRun() {
    meta = store.load();
    run = {
      bench: E3.newBench(benchSize()),
      inventory: meta.relics.slice(),
      selected: null, tool: 'rotate', offers: null, pendingLevels: 0, offersShown: 0,
      powerBuff: 1, optics: null, ended: false,
    };
    for (let i = 0; i < upg('startKit'); i++) run.inventory.push(meta.unlocked[(Math.random() * meta.unlocked.length) | 0]);
    retrace();

    if (arena) arena.destroy();
    const turnRate = 3 * (1 + 0.25 * upg('turnSpeed'));
    const range = 460 * (1 + 0.15 * upg('range'));
    let beams = []; // мировые лучи текущего кадра

    arena = E99.createArena(canvas, {
      palette: { bg: '#07070f', grid: 'rgba(255,230,150,0.05)', accent: '#ffd43b' },
      player: {
        maxHp: 100 + 25 * upg('hp'), speed: 230 * (1 + 0.1 * upg('move')), magnet: 90 * (1 + 0.25 * upg('magnet')), r: 16,
      },
      hint: 'E / Tab — стол · ЛКМ — ручной поворот',
      hooks: {
        update(dt, A) {
          const p = A.player;
          // поворот корабля к цели
          let want = null;
          if (A.mouse.down) { const m = A.mouseWorld(); want = Math.atan2(m.y - p.y, m.x - p.x); }
          else { const t = A.nearestEnemy(p.x, p.y, 650); if (t) want = Math.atan2(t.y - p.y, t.x - p.x); }
          if (want !== null) {
            let d = want - p.angle;
            while (d > Math.PI) d -= TAU;
            while (d < -Math.PI) d += TAU;
            p.angle += Math.max(-turnRate * dt, Math.min(turnRate * dt, d));
          }
          beams = computeBeams(A, range);
          // урон лучами
          for (const b of beams) {
            for (const h of b.hits) {
              A.damageEnemy(h.e, b.p * dt, { burn: b.burn ? b.p * 0.4 : 0, slow: b.slow ? 0.45 : 0, slowT: 0.3 });
            }
          }
        },
        renderWorld(ctx, A) { drawBeams(ctx, beams); },
        renderPlayer(ctx, A) { drawShip(ctx, A.player); },
        onLevelUp() { run.pendingLevels++; if (editorMode !== 'levelup') setTimeout(openLevelUp, 0); },
        onDeath(stats) { endRun(stats); },
      },
    });
    nav.reset();
    nav.show(null);
    arena.start();
    if (run.inventory.length) openEditor('pause', 'Перед стартом: расставь элементы из запаса');
  }

  // Переводит выходы стола в мировые лучи и находит, кого они задевают.
  function computeBeams(A, range) {
    const p = A.player, n = run.bench.size, c = (n - 1) / 2, W = E3.CELLW;
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    const out = [];
    for (const ex of run.optics.exits) {
      const lx = (ex.x - c) * W, ly = (ex.y - c) * W;
      const ox = p.x + lx * cos - ly * sin, oy = p.y + lx * sin + ly * cos;
      const a = p.angle + ex.d * Math.PI / 4;
      const ux = Math.cos(a), uy = Math.sin(a);
      const halfW = 3 * ex.w;
      const cand = [];
      A.forNear(ox + ux * range / 2, oy + uy * range / 2, range / 2 + 40, (e) => {
        const dx = e.x - ox, dy = e.y - oy;
        const t = dx * ux + dy * uy;
        if (t < -e.r || t > range + e.r) return;
        const perp = Math.abs(dx * uy - dy * ux);
        if (perp < e.r + halfW) cand.push({ e, t });
      });
      cand.sort((q, r) => q.t - r.t);
      const hits = cand.slice(0, 1 + ex.pierce);
      const stopped = hits.length === 1 + ex.pierce;
      const len = stopped ? Math.max(0, hits[hits.length - 1].t) : range;
      out.push({ ox, oy, ux, uy, len, p: ex.p, w: ex.w, burn: ex.burn, slow: ex.slow, color: ex.color, hits });
    }
    return out;
  }

  function drawBeams(ctx, beams) {
    for (const b of beams) {
      const k = Math.min(1, b.p / 40);
      ctx.strokeStyle = b.color;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = (6 + 6 * k) * b.w;
      ctx.beginPath(); ctx.moveTo(b.ox, b.oy); ctx.lineTo(b.ox + b.ux * b.len, b.oy + b.uy * b.len); ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = (1.2 + 1.8 * k) * b.w;
      ctx.beginPath(); ctx.moveTo(b.ox, b.oy); ctx.lineTo(b.ox + b.ux * b.len, b.oy + b.uy * b.len); ctx.stroke();
      if (b.hits.length) {
        const h = b.hits[b.hits.length - 1];
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(b.ox + b.ux * Math.max(0, h.t), b.oy + b.uy * Math.max(0, h.t), 4 + Math.random() * 3, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawShip(ctx, p) {
    const n = run.bench.size, W = E3.CELLW, half = (n * W) / 2;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#12101e';
    ctx.strokeStyle = '#ffd43b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-half - 4, -half - 4, n * W + 8, n * W + 8, 6) : ctx.rect(-half - 4, -half - 4, n * W + 8, n * W + 8);
    ctx.fill(); ctx.stroke();
    // нос корабля
    ctx.beginPath(); ctx.moveTo(half + 4, -6); ctx.lineTo(half + 12, 0); ctx.lineTo(half + 4, 6); ctx.closePath();
    ctx.fillStyle = '#ffd43b'; ctx.fill();
    const c = (n - 1) / 2;
    // внутренние лучи
    ctx.globalCompositeOperation = 'lighter';
    for (const s of run.optics.segments) {
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.5 * s.w;
      ctx.beginPath(); ctx.moveTo((s.x1 - c) * W, (s.y1 - c) * W); ctx.lineTo((s.x2 - c) * W, (s.y2 - c) * W); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    run.bench.cells.forEach((cell, i) => {
      if (!cell) return;
      ctx.save();
      ctx.translate(((i % n) - c) * W, (((i / n) | 0) - c) * W);
      E3.drawElement(ctx, cell, W);
      ctx.restore();
    });
    ctx.restore();
  }

  // ---------- Уровни и редактор ----------
  function openLevelUp() {
    if (!arena || arena.isOver() || run.pendingLevels <= 0 || editorMode === 'levelup') return;
    const els = E99.weightedPick(meta.unlocked, 3, (t) => (t === 'mirror' || t === 'amp' ? 1.3 : 1));
    run.offers = els.map((t) => ({ kind: 'el', t }));
    if (run.offersShown > 0 && Math.random() < 0.3) run.offers[2] = { kind: 'power' };
    run.offersShown++;
    openEditor('levelup');
  }

  function openEditor(mode, sub) {
    if (!arena || arena.isOver()) return;
    editorMode = mode;
    arena.pause();
    $('editor-title').textContent = mode === 'levelup' ? `Новый уровень! Выбери элемент${run.pendingLevels > 1 ? ` (ещё ${run.pendingLevels})` : ''}` : 'Оптический стол';
    $('editor-sub').textContent = sub || 'Выбери элемент из запаса и нажми на клетку. Нажатие на элемент — поворот (или «Убрать»). Нос корабля — справа, он смотрит на цель.';
    $('editor-quit').style.display = mode === 'pause' ? '' : 'none';
    $('editor-msg').textContent = '';
    nav.show('screen-editor');
    renderEditor();
  }

  function closeEditor() {
    if (editorMode === 'levelup' && run.offers) { $('editor-msg').textContent = 'Сначала выбери награду сверху.'; return; }
    if (editorMode === 'levelup') run.pendingLevels = Math.max(0, run.pendingLevels - 1);
    retrace();
    if (editorMode === 'levelup' && run.pendingLevels > 0) { editorMode = null; openLevelUp(); return; }
    editorMode = null;
    run.selected = null;
    nav.show(null);
    arena.resume();
  }
  $('editor-continue').addEventListener('click', closeEditor);
  $('editor-quit').addEventListener('click', () => { if (confirm('Завершить забег?')) endRun(arena.stats()); });
  $('btn-pause').addEventListener('click', () => openEditor('pause'));
  window.addEventListener('keydown', (e) => {
    if (!arena || arena.isOver() || !run || run.ended) return;
    if (e.code !== 'KeyE' && e.code !== 'Tab' && e.code !== 'Escape') return;
    e.preventDefault();
    if (nav.isOpen('screen-editor')) closeEditor(); else openEditor('pause');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && arena && !arena.isOver() && !arena.isPaused() && run && !run.ended) openEditor('pause');
  });

  for (const b of document.querySelectorAll('[data-tool]')) {
    b.addEventListener('click', () => { run.tool = b.dataset.tool; run.selected = null; renderEditor(); });
  }

  function renderEditor() {
    // предложения
    const offers = $('editor-offers');
    offers.innerHTML = '';
    offers.classList.toggle('hidden', !(editorMode === 'levelup' && run.offers));
    if (editorMode === 'levelup' && run.offers) {
      for (const o of run.offers) {
        const card = o.kind === 'power'
          ? E99.offerCard({ color: '#ffd43b', icon: '☀', name: 'Накачка', kind: 'усиление на забег', desc: '+20% мощности источника до конца забега.' }, () => { run.powerBuff *= 1.2; run.offers = null; retrace(); renderEditor(); })
          : E99.offerCard({ color: E3.ELEMENTS[o.t].color, icon: E3.ELEMENTS[o.t].icon, name: E3.ELEMENTS[o.t].name, kind: 'оптический элемент', desc: E3.ELEMENTS[o.t].desc },
            () => { run.inventory.push(o.t); run.selected = o.t; run.tool = 'rotate'; run.offers = null; $('editor-msg').textContent = 'Элемент в запасе. Нажми на пустую клетку стола.'; renderEditor(); });
        offers.appendChild(card);
      }
    }
    for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('primary', run.tool === b.dataset.tool && !run.selected);

    // запас (сгруппирован)
    const inv = $('editor-inventory');
    inv.innerHTML = '';
    const groups = {};
    for (const t of run.inventory) groups[t] = (groups[t] || 0) + 1;
    if (!run.inventory.length) inv.innerHTML = '<span class="muted small">Пусто</span>';
    for (const t of Object.keys(groups)) {
      const d = E3.ELEMENTS[t];
      const b = document.createElement('button');
      b.className = 'item' + (run.selected === t ? ' selected' : '');
      b.style.setProperty('--c', d.color);
      b.innerHTML = `<span class="mod-icon">${d.icon}</span>${d.name}${groups[t] > 1 ? ` ×${groups[t]}` : ''}`;
      b.addEventListener('click', () => { run.selected = run.selected === t ? null : t; showInfo(t); renderEditor(); });
      inv.appendChild(b);
    }
    $('editor-continue').disabled = !!(editorMode === 'levelup' && run.offers);
    retrace();
    drawBench();
  }

  function showInfo(t) {
    const d = E3.ELEMENTS[t];
    $('editor-info').innerHTML = `<div class="info-title" style="color:${d.color}">${d.icon} ${d.name}</div><div>${d.desc}</div>`;
  }

  // Холст редактора стола.
  const bc = $('bench-canvas');
  let benchGeom = null;
  function drawBench() {
    const n = run.bench.size;
    const wrap = bc.parentElement;
    const cssW = Math.min(wrap.clientWidth || 360, 460);
    const pad = cssW * 0.12;
    const s = (cssW - pad * 2) / n;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    bc.style.width = cssW + 'px'; bc.style.height = cssW + 'px';
    bc.width = cssW * dpr; bc.height = cssW * dpr;
    const ctx = bc.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a16';
    ctx.fillRect(0, 0, cssW, cssW);
    benchGeom = { pad, s, n };
    const cx = (x) => pad + (x + 0.5) * s;
    // клетки
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#14122a' : '#110f24';
      ctx.fillRect(pad + x * s + 1, pad + y * s + 1, s - 2, s - 2);
    }
    // «нос»
    ctx.fillStyle = 'rgba(255,212,59,0.25)';
    ctx.beginPath(); ctx.moveTo(cssW - pad * 0.7, cssW / 2 - 10); ctx.lineTo(cssW - pad * 0.25, cssW / 2); ctx.lineTo(cssW - pad * 0.7, cssW / 2 + 10); ctx.fill();
    ctx.fillStyle = '#8b86b8'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('нос', cssW - pad * 0.47, cssW / 2 + 22);
    // лучи
    ctx.globalCompositeOperation = 'lighter';
    for (const sg of run.optics.segments) {
      const k = Math.min(1, sg.p / 40);
      ctx.strokeStyle = sg.color;
      ctx.globalAlpha = 0.25; ctx.lineWidth = (5 + 5 * k) * sg.w;
      ctx.beginPath(); ctx.moveTo(cx(sg.x1), cx(sg.y1)); ctx.lineTo(cx(sg.x2), cx(sg.y2)); ctx.stroke();
      ctx.globalAlpha = 0.95; ctx.lineWidth = (1 + 1.5 * k) * sg.w;
      ctx.beginPath(); ctx.moveTo(cx(sg.x1), cx(sg.y1)); ctx.lineTo(cx(sg.x2), cx(sg.y2)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // стрелки выходов с мощностью
    ctx.font = 'bold 11px ui-monospace, monospace';
    for (const ex of run.optics.exits) {
      const x = cx(ex.x), y = cx(ex.y), a = ex.d * Math.PI / 4;
      const tx = x + Math.cos(a) * pad * 0.45, ty = y + Math.sin(a) * pad * 0.45;
      ctx.fillStyle = ex.color;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(ex.p), tx, ty);
    }
    // элементы
    run.bench.cells.forEach((cell, i) => {
      if (!cell) return;
      ctx.save();
      ctx.translate(cx(i % n), cx((i / n) | 0));
      E3.drawElement(ctx, cell, s);
      ctx.restore();
    });
    const sum = E3.summarize(run.optics.exits);
    $('bench-stats').textContent = `лучей на выходе: ${sum.count} · суммарная мощность: ${Math.round(sum.total)} · вперёд: ${Math.round(sum.forward)}`;
  }

  bc.addEventListener('click', (e) => {
    if (!benchGeom || !run) return;
    const r = bc.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - benchGeom.pad) / benchGeom.s);
    const y = Math.floor((e.clientY - r.top - benchGeom.pad) / benchGeom.s);
    const n = benchGeom.n;
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = y * n + x;
    const cell = run.bench.cells[i];
    if (cell && cell.t === 'source') return;
    if (run.selected) {
      if (cell) run.inventory.push(cell.t);
      run.bench.cells[i] = { t: run.selected, o: run.selected === 'mirror' || run.selected === 'splitter' ? 1 : 0 };
      run.inventory.splice(run.inventory.indexOf(run.selected), 1);
      if (!run.inventory.includes(run.selected)) run.selected = null;
      $('editor-msg').textContent = '';
    } else if (cell) {
      const def = E3.ELEMENTS[cell.t];
      if (run.tool === 'remove' || !def.rot) {
        if (run.tool === 'remove') { run.inventory.push(cell.t); run.bench.cells[i] = null; }
        else { $('editor-msg').textContent = `${def.name} не вращается. Включи «Убрать», чтобы снять.`; showInfo(cell.t); }
      } else {
        cell.o = (cell.o + 1) % def.rot;
      }
    }
    renderEditor();
  });
  window.addEventListener('resize', () => { if (run && nav.isOpen('screen-editor')) drawBench(); });

  // ---------- Конец забега ----------
  function endRun(stats) {
    if (!run || run.ended) return;
    run.ended = true;
    arena.pause();
    editorMode = null;
    const photons = Math.floor(stats.kills / 4) + stats.wave * stats.wave * 3 + stats.bossKills * 25;
    meta.runs++;
    meta.photons += photons;
    meta.totalKills += stats.kills;
    meta.bestWave = Math.max(meta.bestWave, stats.wave);
    store.save(meta);

    const used = [...new Set(run.bench.cells.filter((c) => c && c.t !== 'source').map((c) => c.t))];
    const cap = 1 + upg('relics');
    const mins = Math.floor(stats.time / 60), secs = Math.floor(stats.time % 60);
    $('results-body').innerHTML = `<div class="res-grid">
        <div><b>${stats.wave}</b><span>волна</span></div><div><b>${stats.kills}</b><span>убийств</span></div>
        <div><b>${mins}:${String(secs).padStart(2, '0')}</b><span>время</span></div><div><b style="color:var(--accent)">+${photons}</b><span>фотонов</span></div></div>`;
    if (used.length) {
      const box = document.createElement('div');
      box.className = 'res-extra';
      box.innerHTML = `<div>Сохрани один элемент как <b style="color:var(--accent)">реликвию</b> — он будет в запасе в начале каждого забега.</div>
        <div class="muted small">Витрина: ${meta.relics.length}/${cap}${meta.relics.length >= cap ? ' — новая реликвия заменит самую старую' : ''}</div>`;
      const row = document.createElement('div');
      row.className = 'inventory';
      for (const t of used) {
        const d = E3.ELEMENTS[t];
        const b = document.createElement('button');
        b.className = 'item';
        b.style.setProperty('--c', d.color);
        b.innerHTML = `<span class="mod-icon">${d.icon}</span>${d.name}`;
        b.addEventListener('click', () => {
          meta.relics.push(t);
          while (meta.relics.length > cap) meta.relics.shift();
          store.save(meta);
          box.innerHTML = `<div>Реликвия сохранена: <b style="color:${d.color}">${d.icon} ${d.name}</b></div>`;
        });
        row.appendChild(b);
      }
      box.appendChild(row);
      $('results-body').appendChild(box);
    }
    nav.show('screen-results');
  }

  function leaveRun() { if (arena) { arena.destroy(); arena = null; } run = null; E99.clearCanvas(canvas); }
  $('res-lab').addEventListener('click', () => { leaveRun(); nav.reset(['screen-menu']); nav.go('screen-lab'); });
  $('res-again').addEventListener('click', () => { leaveRun(); startRun(); });
  $('res-menu').addEventListener('click', () => { leaveRun(); nav.reset(); nav.go('screen-menu'); });

  nav.go('screen-menu');
  if (!meta.seenHelp) { meta.seenHelp = true; store.save(meta); nav.go('screen-help'); }

  E3._app = { get meta() { return meta; }, get run() { return run; }, get arena() { return arena; }, startRun, openEditor };
})(window.E3, window.E99);
