// Эксперимент 4 «Секвенсор»: оружие — музыкальный цикл, который играет сам.
(function (E4, E99) {
  'use strict';

  const $ = E99.$;
  const canvas = $('game');
  const TAU = Math.PI * 2;
  const audio = E4.audio;
  const store = E99.createStore('e99.exp4', () => ({
    version: 1, vinyl: 0, upgrades: {}, unlocked: E4.START_UNLOCKED.slice(),
    records: [], selectedRecords: [], runs: 0, bestWave: 0, totalKills: 0, seenHelp: false, muted: false,
  }));
  let meta = store.load();
  audio.setMuted(meta.muted);
  const upg = (id) => meta.upgrades[id] || 0;
  const CUR = { key: 'vinyl', icon: '◍' };

  let arena = null;
  let run = null;
  let editorMode = null;

  const nav = E99.createScreens({
    home: 'screen-menu',
    refresh(id) { if (id === 'screen-menu') renderMenu(); if (id === 'screen-lab') renderLab(); },
    onShow(id) {
      const inRun = !id && arena && !arena.isOver();
      $('btn-pause').classList.toggle('hidden', !inRun);
      $('btn-mute').classList.toggle('hidden', !inRun);
      if (id !== 'screen-editor') stopPreview();
    },
  });

  // ---------- звук ----------
  function updateMuteBtn() { $('btn-mute').textContent = meta.muted ? '🔇' : '🔊'; }
  $('btn-mute').addEventListener('click', () => { meta.muted = !meta.muted; audio.setMuted(meta.muted); store.save(meta); updateMuteBtn(); });
  updateMuteBtn();

  // ---------- меню ----------
  function renderMenu() {
    const el = $('menu-stats');
    if (!meta.runs) { el.innerHTML = '<span class="muted">Включи звук: здесь оружие — это музыка.</span>'; return; }
    el.innerHTML = `<div><b>${meta.runs}</b><span>забегов</span></div><div><b>${meta.bestWave}</b><span>лучшая волна</span></div>
      <div><b>${meta.records.length}</b><span>пластинок</span></div><div><b>${meta.vinyl}</b><span>винила</span></div>`;
  }
  $('btn-start').addEventListener('click', startRun);
  $('btn-lab').addEventListener('click', () => nav.go('screen-lab'));
  $('btn-help').addEventListener('click', () => nav.go('screen-help'));

  // ---------- лаборатория ----------
  function renderLab() {
    $('lab-currency').innerHTML = `<span style="color:var(--accent)">◍</span> ${meta.vinyl} винила`;
    const save = () => { store.save(meta); renderLab(); };
    E99.renderUpgrades($('lab-upgrades'), E4.UPGRADES, meta, CUR, save);
    E99.renderUnlocks($('lab-unlocks'), E4.UNLOCKS, E4.NOTES, meta, CUR, save);
    const cap = 1 + upg('records');
    meta.selectedRecords = meta.selectedRecords.filter((id) => meta.records.some((r) => r.id === id)).slice(0, cap);
    $('lab-rec-cap').textContent = `(${meta.selectedRecords.length}/${cap} в забег)`;
    const list = $('lab-records');
    list.innerHTML = '';
    if (!meta.records.length) list.innerHTML = '<p class="muted small">Пластинка записывается в конце каждого забега.</p>';
    for (const r of meta.records.slice().reverse()) {
      const sel = meta.selectedRecords.includes(r.id);
      const b = document.createElement('button');
      b.className = 'pick' + (sel ? ' sel' : '');
      b.innerHTML = `<span class="vinyl-ic">◍</span><span><b>${E99.escapeHtml(r.name)}</b><div class="meta">${r.tracks.length}×${r.tracks[0].length} · волна ${r.wave}</div>
        <div class="mini-pattern">${miniPattern(r.tracks)}</div></span>`;
      b.addEventListener('click', () => {
        if (sel) meta.selectedRecords = meta.selectedRecords.filter((id) => id !== r.id);
        else { meta.selectedRecords.push(r.id); while (meta.selectedRecords.length > cap) meta.selectedRecords.shift(); }
        store.save(meta); renderLab();
      });
      list.appendChild(b);
    }
  }
  function miniPattern(tracks) {
    return tracks.map((row) => row.map((t) => (t ? `<i style="color:${E4.NOTES[t].color}">${E4.NOTES[t].icon}</i>` : '<i class="e">·</i>')).join('')).join('<br>');
  }
  $('lab-start').addEventListener('click', startRun);
  $('lab-reset').addEventListener('click', () => { if (confirm('Стереть весь прогресс эксперимента?')) { meta = store.reset(); audio.setMuted(false); renderLab(); } });

  // ---------- забег ----------
  const stepsCount = () => 8 + 2 * upg('steps');
  const tracksCount = () => 2 + upg('tracks');
  const recordPower = () => 0.5 + 0.1 * upg('recordPower');

  function startRun() {
    audio.init(); // разблокировка звука по жесту пользователя
    meta = store.load();
    const steps = stepsCount();
    const tracks = [];
    for (let i = 0; i < tracksCount(); i++) tracks.push(new Array(steps).fill(null));
    // стартовый бит
    tracks[0][0] = 'kick'; tracks[0][steps / 2] = 'kick';
    tracks[1][steps / 4] = 'snare'; tracks[1][(3 * steps) / 4] = 'snare';
    const records = meta.selectedRecords.map((id) => meta.records.find((r) => r.id === id)).filter(Boolean);
    run = {
      tracks, records, inventory: [], selected: null, offers: null, pendingLevels: 0, offersShown: 0,
      bpmBuff: 0, tick: 0, stepT: 0, echo: [], shield: 0, fx: [], lastStep: { chord: 0 }, pulse: 0, ended: false,
    };
    for (let i = 0; i < upg('startKit'); i++) run.inventory.push(meta.unlocked[(Math.random() * meta.unlocked.length) | 0]);

    if (arena) arena.destroy();
    arena = E99.createArena(canvas, {
      palette: { bg: '#0b0710', grid: 'rgba(247,131,172,0.06)', accent: '#f783ac' },
      player: { maxHp: 100 + 25 * upg('hp'), speed: 230 * (1 + 0.1 * upg('move')), magnet: 90 * (1 + 0.25 * upg('magnet')) },
      hint: 'E / Tab — секвенсор',
      hintOffset: 140,
      hooks: {
        update(dt, A) {
          const p = A.player;
          if (p.vx || p.vy) p.angle = Math.atan2(p.vy, p.vx);
          run.stepT += dt;
          const stepDur = 60 / (100 + 8 * upg('bpm') + run.bpmBuff) / 2;
          while (run.stepT >= stepDur) { run.stepT -= stepDur; doStep(A); }
          run.pulse = Math.max(0, run.pulse - dt * 3);
          for (const f of run.fx) f.life -= dt;
          run.fx = run.fx.filter((f) => f.life > 0);
        },
        beforeHurt(dmg) {
          if (run.shield > 0) { run.shield--; arena.burst(arena.player.x, arena.player.y, '#63e6be', 12); return 0; }
          return dmg;
        },
        renderBackground(ctx, A) {
          if (run.pulse > 0) {
            ctx.fillStyle = `rgba(255,107,107,${run.pulse * 0.06})`;
            ctx.fillRect(A.cam.x, A.cam.y, A.view.w, A.view.h);
          }
        },
        renderWorld(ctx, A) {
          for (const f of run.fx) {
            ctx.globalAlpha = Math.max(0, f.life / f.max);
            ctx.strokeStyle = f.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(f.pts[0].x, f.pts[0].y);
            for (const q of f.pts.slice(1)) ctx.lineTo(q.x + (Math.random() - 0.5) * 8, q.y + (Math.random() - 0.5) * 8);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          const p = A.player;
          for (let i = 0; i < run.shield; i++) {
            ctx.strokeStyle = '#63e6be';
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, 22 + i * 5, 0, TAU); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        },
        renderHud(ctx, A) { drawSequencer(ctx, A); },
        onLevelUp() { run.pendingLevels++; if (editorMode !== 'levelup') setTimeout(openLevelUp, 0); },
        onDeath(stats) { endRun(stats); },
      },
    });
    nav.reset();
    nav.show(null);
    arena.start();
    if (run.inventory.length) openEditor('pause', 'Перед стартом: расставь ноты из запаса');
  }

  function playRows() {
    const rows = run.tracks.map((row) => ({ row, power: 1, groove: E4.isGroove(row) }));
    for (const r of run.records) for (const row of r.tracks) rows.push({ row, power: recordPower(), groove: E4.isGroove(row) });
    return rows;
  }

  function doStep(A) {
    const res = E4.stepEvents(playRows(), run.tick, run.echo);
    run.echo = res.echoOut;
    run.lastStep = res;
    for (const ev of res.events) { fireNote(A, ev.type, ev.mul); audio.play(ev.type, Math.min(1.4, 0.6 + ev.mul * 0.35) * (ev.echo ? 0.6 : 1), run.tick); }
    run.tick++;
  }

  function aimAngle(A) {
    const p = A.player;
    const t = A.nearestEnemy(p.x, p.y, 600);
    return t ? Math.atan2(t.y - p.y, t.x - p.x) : p.angle;
  }

  function fireNote(A, type, mul) {
    const p = A.player;
    switch (type) {
      case 'kick':
        A.ring(p.x, p.y, 110 * Math.min(1.6, 0.8 + mul * 0.2), 16 * mul, '#ff6b6b', { knock: 160 });
        run.pulse = 1;
        break;
      case 'snare': {
        const a = aimAngle(A);
        A.spawnShot({ x: p.x, y: p.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, r: 5, dmg: 22 * mul, pierce: 1, life: 1, color: '#ffd43b' });
        break;
      }
      case 'hat': {
        const a = aimAngle(A);
        for (const da of [-0.2, 0, 0.2]) A.spawnShot({ x: p.x, y: p.y, vx: Math.cos(a + da) * 680, vy: Math.sin(a + da) * 680, r: 3, dmg: 7 * mul, life: 0.6, color: '#a5d8ff', knock: 10 });
        break;
      }
      case 'pad':
        run.shield = Math.min(3, run.shield + 1);
        p.hp = Math.min(p.maxHp, p.hp + 2 * mul);
        break;
      case 'bass': {
        const a = aimAngle(A);
        A.spawnShot({ x: p.x, y: p.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, r: 9 + 2 * Math.min(mul, 2), dmg: 45 * mul, pierce: 3, life: 2, color: '#b197fc', knock: 90 });
        break;
      }
      case 'dash': {
        let dx = p.vx, dy = p.vy;
        if (!dx && !dy) { const t = A.nearestEnemy(p.x, p.y, 300); if (t) { dx = p.x - t.x; dy = p.y - t.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; } else { dx = Math.cos(p.angle); dy = Math.sin(p.angle); } }
        const dist = 95 * Math.min(1.5, mul);
        const x0 = p.x, y0 = p.y;
        p.x += dx * dist; p.y += dy * dist;
        p.inv = Math.max(p.inv, 0.3);
        const hit = new Set();
        for (let k = 0; k <= 6; k++) {
          const qx = x0 + dx * dist * k / 6, qy = y0 + dy * dist * k / 6;
          A.forNear(qx, qy, 40, (e) => { if (!hit.has(e.id) && Math.hypot(e.x - qx, e.y - qy) < e.r + 16) { hit.add(e.id); A.damageEnemy(e, 15 * mul); } });
        }
        run.fx.push({ pts: [{ x: x0, y: y0 }, { x: p.x, y: p.y }], color: '#ffa94d', life: 0.25, max: 0.25 });
        break;
      }
      case 'clap':
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU + run.tick * 0.2;
          A.spawnShot({ x: p.x, y: p.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, r: 4, dmg: 10 * mul, life: 0.8, color: '#f783ac' });
        }
        break;
      case 'synth': {
        const hit = new Set();
        let from = { x: p.x, y: p.y };
        const pts = [from];
        for (let k = 0; k < 3; k++) {
          const t = A.nearestEnemy(from.x, from.y, k === 0 ? 380 : 220, hit);
          if (!t) break;
          hit.add(t.id);
          A.damageEnemy(t, 14 * mul);
          from = { x: t.x, y: t.y };
          pts.push(from);
        }
        if (pts.length > 1) run.fx.push({ pts, color: '#69db7c', life: 0.18, max: 0.18 });
        break;
      }
      default: break;
    }
  }

  // HUD: секвенсор с курсором.
  function drawSequencer(ctx, A) {
    const narrow = A.view.w < 600;
    const cs = narrow ? 12 : 15;
    const rows = playRows();
    const x0 = 16, y0 = 66;
    const curTick = run.tick - 1;
    ctx.font = `${cs - 3}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    rows.forEach((r, ri) => {
      const len = r.row.length;
      const isRec = ri >= run.tracks.length;
      for (let s = 0; s < len; s++) {
        const x = x0 + s * (cs + 2), y = y0 + ri * (cs + 2);
        const t = r.row[s];
        const active = ((curTick % len) + len) % len === s;
        ctx.globalAlpha = isRec ? 0.55 : 1;
        ctx.fillStyle = active ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.07)';
        ctx.fillRect(x, y, cs, cs);
        if (t) {
          ctx.fillStyle = E4.NOTES[t].color;
          ctx.fillText(E4.NOTES[t].icon, x + cs / 2, y + cs / 2 + 1);
        }
      }
      if (r.groove) { ctx.fillStyle = '#ffd43b'; ctx.fillText('♪', x0 + len * (cs + 2) + 6, y0 + ri * (cs + 2) + cs / 2); }
    });
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    const info = [];
    if (run.lastStep.chord > 1) info.push(`аккорд ×${(1 + E4.CHORD_STEP * (run.lastStep.chord - 1)).toFixed(1)}`);
    if (run.lastStep.accent) info.push('акцент');
    if (run.shield) info.push(`щит ${run.shield}`);
    if (info.length) {
      ctx.fillStyle = '#ffd8e8';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(info.join(' · '), x0, y0 + rows.length * (cs + 2) + 10);
    }
  }

  // ---------- уровни и редактор ----------
  function openLevelUp() {
    if (!arena || arena.isOver() || run.pendingLevels <= 0 || editorMode === 'levelup') return;
    run.offers = E99.weightedPick(meta.unlocked, 3, (t) => (E4.NOTES[t].kind === 'mod' ? 0.6 : 1)).map((t) => ({ kind: 'note', t }));
    if (run.offersShown > 1 && Math.random() < 0.25) run.offers[2] = { kind: 'bpm' };
    run.offersShown++;
    openEditor('levelup');
  }

  function openEditor(mode, sub) {
    if (!arena || arena.isOver()) return;
    editorMode = mode;
    arena.pause();
    $('editor-title').textContent = mode === 'levelup' ? `Новый уровень! Выбери ноту${run.pendingLevels > 1 ? ` (ещё ${run.pendingLevels})` : ''}` : 'Секвенсор';
    $('editor-sub').textContent = sub || 'Выбери ноту в запасе и нажми на шаг. Нажатие на ноту без выбора — вернуть в запас. Ноты на одном шаге — аккорд (+20% за каждый разный инструмент). Ровный ритм на дорожке — ♪ +30%.';
    $('editor-quit').style.display = mode === 'pause' ? '' : 'none';
    $('editor-msg').textContent = '';
    nav.show('screen-editor');
    renderEditor();
  }

  function closeEditor() {
    if (editorMode === 'levelup' && run.offers) { $('editor-msg').textContent = 'Сначала выбери награду сверху.'; return; }
    if (editorMode === 'levelup') run.pendingLevels = Math.max(0, run.pendingLevels - 1);
    if (editorMode === 'levelup' && run.pendingLevels > 0) { editorMode = null; openLevelUp(); return; }
    editorMode = null;
    run.selected = null;
    nav.show(null);
    arena.resume();
  }
  $('editor-continue').addEventListener('click', closeEditor);
  $('editor-quit').addEventListener('click', () => { if (confirm('Завершить забег? Твой цикл запишется на пластинку.')) endRun(arena.stats()); });
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

  function renderEditor() {
    const offers = $('editor-offers');
    offers.innerHTML = '';
    offers.classList.toggle('hidden', !(editorMode === 'levelup' && run.offers));
    if (editorMode === 'levelup' && run.offers) {
      for (const o of run.offers) {
        if (o.kind === 'bpm') {
          offers.appendChild(E99.offerCard({ color: '#f783ac', icon: '♩', name: 'Разгон', kind: 'усиление на забег', desc: '+8 BPM до конца забега: всё звучит и стреляет чаще.' },
            () => { run.bpmBuff += 8; run.offers = null; renderEditor(); }));
        } else {
          const d = E4.NOTES[o.t];
          offers.appendChild(E99.offerCard({ color: d.color, icon: d.icon, name: d.name, kind: d.kind === 'mod' ? 'модификатор шага' : 'инструмент', desc: d.desc },
            () => { run.inventory.push(o.t); run.selected = o.t; run.offers = null; $('editor-msg').textContent = 'Нота в запасе. Нажми на шаг в секвенсоре.'; audio.play(o.t, 1, 0); renderEditor(); }));
        }
      }
    }

    // сетка
    const g = $('seq-grid');
    g.innerHTML = '';
    const steps = run.tracks[0].length;
    const allRows = playRows();
    const head = document.createElement('div');
    head.className = 'seq-row head';
    head.innerHTML = '<div class="seq-label"></div>' + Array.from({ length: steps }, (_, s) => {
      const res = E4.stepEvents(allRows, s, null);
      return `<div class="seq-h ${s % 4 === 0 ? 'beat' : ''}">${res.chord > 1 ? `<b>×${(1 + E4.CHORD_STEP * (res.chord - 1)).toFixed(1)}</b>` : s + 1}</div>`;
    }).join('');
    g.appendChild(head);
    allRows.forEach((r, ri) => {
      const isRec = ri >= run.tracks.length;
      const row = document.createElement('div');
      row.className = 'seq-row' + (isRec ? ' rec' : '');
      const label = document.createElement('div');
      label.className = 'seq-label';
      label.innerHTML = isRec ? `◍ пласт.` : `Дор. ${ri + 1}`;
      if (r.groove) label.innerHTML += ' <span class="groove">♪</span>';
      row.appendChild(label);
      for (let s = 0; s < r.row.length; s++) {
        const t = r.row[s];
        const c = document.createElement('button');
        c.className = 'seq-cell' + (s % 4 === 0 ? ' beat' : '') + (t ? ' filled' : '');
        c.dataset.step = s;
        if (t) { c.style.setProperty('--c', E4.NOTES[t].color); c.textContent = E4.NOTES[t].icon; c.title = E4.NOTES[t].name; }
        if (isRec) c.disabled = true;
        else c.addEventListener('click', () => onCell(ri, s));
        row.appendChild(c);
      }
      g.appendChild(row);
    });

    // запас
    const inv = $('editor-inventory');
    inv.innerHTML = '';
    const groups = {};
    for (const t of run.inventory) groups[t] = (groups[t] || 0) + 1;
    if (!run.inventory.length) inv.innerHTML = '<span class="muted small">Пусто</span>';
    for (const t of Object.keys(groups)) {
      const d = E4.NOTES[t];
      const b = document.createElement('button');
      b.className = 'item' + (run.selected === t ? ' selected' : '');
      b.style.setProperty('--c', d.color);
      b.innerHTML = `<span class="mod-icon">${d.icon}</span>${d.name}${groups[t] > 1 ? ` ×${groups[t]}` : ''}`;
      b.addEventListener('click', () => { run.selected = run.selected === t ? null : t; showInfo(t); audio.play(t, 0.8, 0); renderEditor(); });
      inv.appendChild(b);
    }
    $('editor-continue').disabled = !!(editorMode === 'levelup' && run.offers);
  }

  function showInfo(t) {
    const d = E4.NOTES[t];
    $('editor-info').innerHTML = `<div class="info-title" style="color:${d.color}">${d.icon} ${d.name}</div><div>${d.desc}</div>`;
  }

  function onCell(ri, s) {
    const row = run.tracks[ri];
    const cur = row[s];
    if (run.selected) {
      row[s] = run.selected;
      run.inventory.splice(run.inventory.indexOf(run.selected), 1);
      if (cur) run.inventory.push(cur);
      audio.play(run.selected, 0.8, s);
      if (!run.inventory.includes(run.selected)) run.selected = null;
    } else if (cur) {
      row[s] = null;
      run.inventory.push(cur);
      run.selected = cur;
      showInfo(cur);
    }
    renderEditor();
  }

  // Прослушивание цикла в редакторе.
  let preview = null;
  function stopPreview() {
    if (preview) { clearInterval(preview.timer); preview = null; }
    const b = $('seq-preview');
    if (b) b.textContent = '▶ Прослушать';
    for (const c of document.querySelectorAll('.seq-cell.now')) c.classList.remove('now');
  }
  $('seq-preview').addEventListener('click', () => {
    if (preview) { stopPreview(); return; }
    audio.init();
    const stepDur = 60 / (100 + 8 * upg('bpm') + run.bpmBuff) / 2;
    preview = { tick: 0, echo: [] };
    $('seq-preview').textContent = '■ Стоп';
    preview.timer = setInterval(() => {
      const rows = playRows();
      const res = E4.stepEvents(rows, preview.tick, preview.echo);
      preview.echo = res.echoOut;
      for (const ev of res.events) audio.play(ev.type, Math.min(1.4, 0.6 + ev.mul * 0.35) * (ev.echo ? 0.6 : 1), preview.tick);
      for (const c of document.querySelectorAll('.seq-cell.now')) c.classList.remove('now');
      document.querySelectorAll('#seq-grid .seq-row:not(.head)').forEach((rowEl, ri) => {
        const len = rows[ri] ? rows[ri].row.length : 1;
        const cell = rowEl.querySelector(`.seq-cell[data-step="${preview.tick % len}"]`);
        if (cell) cell.classList.add('now');
      });
      preview.tick++;
    }, stepDur * 1000);
  });

  // ---------- конец забега ----------
  function endRun(stats) {
    if (!run || run.ended) return;
    run.ended = true;
    arena.pause();
    editorMode = null;
    const vinyl = Math.floor(stats.kills / 4) + stats.wave * stats.wave * 3 + stats.bossKills * 25;
    meta.runs++;
    meta.vinyl += vinyl;
    meta.totalKills += stats.kills;
    meta.bestWave = Math.max(meta.bestWave, stats.wave);
    let rec = null;
    const notes = run.tracks.flat().filter(Boolean).length;
    if (notes > 0) {
      rec = { id: Date.now().toString(36), name: `Пластинка №${meta.runs}`, wave: stats.wave, tracks: run.tracks.map((r) => r.slice()) };
      meta.records.push(rec);
      while (meta.records.length > E4.MAX_RECORDS) {
        const idx = meta.records.findIndex((r) => !meta.selectedRecords.includes(r.id));
        meta.records.splice(idx >= 0 ? idx : 0, 1);
      }
      const cap = 1 + upg('records');
      meta.selectedRecords = meta.selectedRecords.filter((id) => meta.records.some((r) => r.id === id));
      meta.selectedRecords.push(rec.id);
      while (meta.selectedRecords.length > cap) meta.selectedRecords.shift();
    }
    store.save(meta);
    const mins = Math.floor(stats.time / 60), secs = Math.floor(stats.time % 60);
    $('results-body').innerHTML = `<div class="res-grid">
        <div><b>${stats.wave}</b><span>волна</span></div><div><b>${stats.kills}</b><span>убийств</span></div>
        <div><b>${mins}:${String(secs).padStart(2, '0')}</b><span>время</span></div><div><b style="color:var(--accent)">+${vinyl}</b><span>винила</span></div></div>
      ${rec ? `<div class="res-extra"><div>Твой цикл записан: <b style="color:var(--accent)">◍ ${rec.name}</b></div>
        <div class="mini-pattern">${miniPattern(rec.tracks)}</div>
        <div class="muted small">В следующем забеге он будет играть фоном как дополнительные дорожки (сила ${Math.round(recordPower() * 100)}%).</div></div>` : ''}`;
    nav.show('screen-results');
  }

  function leaveRun() { stopPreview(); if (arena) { arena.destroy(); arena = null; } run = null; E99.clearCanvas(canvas); }
  $('res-lab').addEventListener('click', () => { leaveRun(); nav.reset(['screen-menu']); nav.go('screen-lab'); });
  $('res-again').addEventListener('click', () => { leaveRun(); startRun(); });
  $('res-menu').addEventListener('click', () => { leaveRun(); nav.reset(); nav.go('screen-menu'); });

  nav.go('screen-menu');
  if (!meta.seenHelp) { meta.seenHelp = true; store.save(meta); nav.go('screen-help'); }

  E4._app = { get meta() { return meta; }, get run() { return run; }, get arena() { return arena; }, startRun, openEditor };
})(window.E4, window.E99);
