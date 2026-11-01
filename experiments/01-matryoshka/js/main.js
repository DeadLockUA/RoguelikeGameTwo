// Экраны, редактор схемы, лаборатория и связка забега с мета-прогрессом.
(function (E1) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  let meta = E1.loadMeta();
  let game = null;
  let run = null;          // { root, inventory, selected, offers, pendingLevels, offersShown }
  let editorMode = null;   // 'levelup' | 'pause'
  let screenStack = [];

  const MAX_FOSSILS = 24;

  // ---------- Экраны ----------
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
  }
  function go(id) { screenStack.push(id); show(id); refresh(id); }
  function back() { screenStack.pop(); const id = screenStack[screenStack.length - 1] || 'screen-menu'; show(id); refresh(id); }
  function refresh(id) {
    if (id === 'screen-menu') renderMenu();
    if (id === 'screen-lab') renderLab();
  }
  for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', back);

  // ---------- Меню ----------
  function renderMenu() {
    const st = $('menu-stats');
    if (meta.runs === 0) { st.innerHTML = '<span class="muted">Первый запуск. Удачи, лаборант.</span>'; return; }
    st.innerHTML = `
      <div><b>${meta.runs}</b><span>забегов</span></div>
      <div><b>${meta.bestWave}</b><span>лучшая волна</span></div>
      <div><b>${meta.fossils.length}</b><span>окаменелостей</span></div>
      <div><b>${meta.samples}</b><span>образцов</span></div>`;
  }
  $('btn-start').addEventListener('click', startRun);
  $('btn-lab').addEventListener('click', () => go('screen-lab'));
  $('btn-help').addEventListener('click', () => go('screen-help'));

  // ---------- Лаборатория ----------
  function renderLab() {
    $('lab-samples').innerHTML = `<span class="c-green">⬢</span> ${meta.samples} образцов`;

    const up = $('lab-upgrades');
    up.innerHTML = '';
    for (const u of E1.UPGRADES) {
      const lvl = E1.upg(meta, u.id);
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : u.cost(lvl);
      const card = document.createElement('div');
      card.className = 'card' + (maxed ? ' maxed' : '');
      card.innerHTML = `
        <div class="card-title">${u.name} <span class="pips">${'●'.repeat(lvl)}${'○'.repeat(u.max - lvl)}</span></div>
        <div class="card-desc">${u.desc(lvl)}${maxed ? '' : ` <span class="muted">→ ${u.desc(lvl + 1).split(':').pop().trim()}</span>`}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn small' + (!maxed && meta.samples >= cost ? ' primary' : '');
      btn.textContent = maxed ? 'Максимум' : `⬢ ${cost}`;
      btn.disabled = maxed || meta.samples < cost;
      btn.addEventListener('click', () => {
        meta.samples -= cost;
        meta.upgrades[u.id] = lvl + 1;
        E1.saveMeta(meta);
        renderLab();
      });
      card.appendChild(btn);
      up.appendChild(card);
    }

    const un = $('lab-unlocks');
    un.innerHTML = '';
    for (const u of E1.UNLOCKS) {
      const def = E1.MODS[u.id];
      const have = meta.unlocked.includes(u.id);
      const card = document.createElement('div');
      card.className = 'card' + (have ? ' maxed' : '');
      card.innerHTML = `
        <div class="card-title"><span class="mod-icon" style="color:${def.color}">${def.icon}</span> ${def.name}
          <span class="kind">${def.kind === 'trigger' ? 'триггер' : 'модификатор'}</span></div>
        <div class="card-desc">${def.desc}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn small' + (!have && meta.samples >= u.cost ? ' primary' : '');
      btn.textContent = have ? 'Открыт' : `⬢ ${u.cost}`;
      btn.disabled = have || meta.samples < u.cost;
      btn.addEventListener('click', () => {
        meta.samples -= u.cost;
        meta.unlocked.push(u.id);
        E1.saveMeta(meta);
        renderLab();
      });
      card.appendChild(btn);
      un.appendChild(card);
    }

    const cap = E1.fossilSlots(meta);
    meta.selectedFossils = meta.selectedFossils.filter((id) => meta.fossils.some((f) => f.id === id)).slice(0, cap);
    $('lab-fossil-cap').textContent = `(${meta.selectedFossils.length}/${cap} в забег)`;
    const fl = $('lab-fossils');
    fl.innerHTML = '';
    if (!meta.fossils.length) fl.innerHTML = '<p class="muted">Пока пусто. Окаменелость появится после первого забега.</p>';
    for (const f of meta.fossils.slice().reverse()) {
      const sel = meta.selectedFossils.includes(f.id);
      const row = document.createElement('div');
      row.className = 'fossil' + (sel ? ' selected' : '');
      row.innerHTML = `
        <label class="fossil-main">
          <input type="checkbox" ${sel ? 'checked' : ''}>
          <span class="mod-icon c-amber">◈</span>
          <span><b>${escapeHtml(f.name)}</b><br><span class="muted small">волна ${f.wave} · ${f.kills} убийств · ${E1.countModules(f.node)} модулей · глубина ${E1.nodeHeight(f.node) + 1}</span></span>
        </label>
        <div class="fossil-tree">${miniTree(f.node)}</div>`;
      const cb = row.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (meta.selectedFossils.length >= cap) meta.selectedFossils.shift();
          meta.selectedFossils.push(f.id);
        } else meta.selectedFossils = meta.selectedFossils.filter((id) => id !== f.id);
        E1.saveMeta(meta);
        renderLab();
      });
      const del = document.createElement('button');
      del.className = 'btn ghost small';
      del.textContent = 'Удалить';
      del.addEventListener('click', () => {
        if (!confirm(`Удалить «${f.name}»?`)) return;
        meta.fossils = meta.fossils.filter((x) => x.id !== f.id);
        E1.saveMeta(meta);
        renderLab();
      });
      row.appendChild(del);
      fl.appendChild(row);
    }
  }
  $('lab-start').addEventListener('click', startRun);
  $('lab-reset').addEventListener('click', () => {
    if (!confirm('Стереть весь прогресс эксперимента? Это необратимо.')) return;
    meta = E1.resetMeta();
    renderLab();
  });

  // Компактное текстовое представление дерева.
  function miniTree(node) {
    const parts = node.slots.map((it) => {
      if (!it) return '<span class="mini empty">·</span>';
      const d = E1.MODS[it.type];
      let inner = '';
      if (it.child) inner = `<span class="mini-nest">[${miniTree(it.child)}]</span>`;
      if (it.fossil) inner = `<span class="mini-nest">[${miniTree(it.fossil.node)}]</span>`;
      return `<span class="mini" style="color:${d.color}" title="${d.name}">${d.icon}</span>${inner}`;
    });
    return parts.join('');
  }

  // ---------- Забег ----------
  function startRun() {
    meta = E1.loadMeta();
    run = {
      root: E1.newNode(E1.rootSlots(meta)),
      inventory: [],
      selected: null,
      offers: null,
      pendingLevels: 0,
      offersShown: 0,
    };
    for (const id of meta.selectedFossils) {
      const f = meta.fossils.find((x) => x.id === id);
      if (f) run.inventory.push(E1.makeFossilItem(f));
    }
    for (let i = 0; i < E1.upg(meta, 'startKit'); i++) run.inventory.push(E1.makeItem(randomPool()[0], meta));

    if (game) game.destroy();
    game = E1.createGame(canvas, {
      meta,
      hooks: {
        onLevelUp() { run.pendingLevels++; if (editorMode !== 'levelup') setTimeout(openLevelUp, 0); },
        onDeath(stats) { setTimeout(() => endRun(stats), 700); },
      },
    });
    game.setTree(run.root);
    screenStack = [];
    show(null);
    game.start();
    if (run.inventory.length) openEditor('pause', 'Перед стартом: расставь модули из запаса');
  }

  function randomPool(n = 1, ensureTrigger = false) {
    const pool = meta.unlocked.slice();
    const out = [];
    const weights = (id) => (E1.MODS[id].kind === 'trigger' ? 1.3 : 1);
    while (out.length < n && out.length < pool.length) {
      let total = 0;
      const cand = pool.filter((id) => !out.includes(id));
      for (const id of cand) total += weights(id);
      let r = Math.random() * total;
      let pick = cand[0];
      for (const id of cand) { r -= weights(id); if (r <= 0) { pick = id; break; } }
      out.push(pick);
    }
    if (ensureTrigger && !out.some((id) => E1.MODS[id].kind === 'trigger')) {
      const trig = pool.filter((id) => E1.MODS[id].kind === 'trigger');
      out[out.length - 1] = trig[(Math.random() * trig.length) | 0];
    }
    return out;
  }

  function openLevelUp() {
    if (!game || game.isOver() || run.pendingLevels <= 0 || editorMode === 'levelup') return;
    run.offers = randomPool(3, run.offersShown === 0).map((t) => E1.makeItem(t, meta));
    run.offersShown++;
    openEditor('levelup');
  }

  function openEditor(mode, sub) {
    if (!game || game.isOver()) return;
    editorMode = mode;
    game.pause();
    $('editor-title').textContent = mode === 'levelup' ? `Новый уровень! Выбери модуль${run.pendingLevels > 1 ? ` (ещё ${run.pendingLevels})` : ''}` : 'Схема';
    $('editor-sub').textContent = sub || `Макс. глубина: ${E1.maxDepth(meta)} · Клик по модулю в запасе, затем по пустому слоту. Клик по занятому слоту — вернуть в запас.`;
    $('editor-quit').style.display = mode === 'pause' ? '' : 'none';
    setMsg('');
    renderEditor();
    show('screen-editor');
  }

  function closeEditor() {
    if (editorMode === 'levelup' && run.offers) { setMsg('Сначала выбери один из модулей сверху.'); return; }
    if (editorMode === 'levelup') run.pendingLevels = Math.max(0, run.pendingLevels - 1);
    game.setTree(run.root);
    if (editorMode === 'levelup' && run.pendingLevels > 0) { editorMode = null; openLevelUp(); return; }
    editorMode = null;
    run.selected = null;
    show(null);
    game.resume();
  }
  $('editor-continue').addEventListener('click', closeEditor);
  $('editor-quit').addEventListener('click', () => {
    if (!confirm('Завершить забег? Сборка станет окаменелостью.')) return;
    const stats = game.stats();
    editorMode = null;
    endRun(stats);
  });

  window.addEventListener('keydown', (e) => {
    if (!game || game.isOver() || !run) return;
    const editorOpen = !$('screen-editor').classList.contains('hidden');
    const resultsOpen = !$('screen-results').classList.contains('hidden');
    if (resultsOpen) return;
    if (e.code === 'KeyE' || e.code === 'Tab' || e.code === 'Escape') {
      e.preventDefault();
      if (editorOpen) closeEditor();
      else openEditor('pause');
    }
  });

  function setMsg(t) { $('editor-msg').textContent = t; }

  // ---------- Редактор дерева ----------
  function renderEditor() {
    // предложения
    const offers = $('editor-offers');
    offers.innerHTML = '';
    if (editorMode === 'levelup' && run.offers) {
      for (const it of run.offers) {
        const d = E1.MODS[it.type];
        const card = document.createElement('button');
        card.className = 'offer';
        card.style.setProperty('--c', d.color);
        card.innerHTML = `<div class="offer-icon">${d.icon}</div><div class="offer-name">${d.name}</div>
          <div class="offer-kind">${d.kind === 'trigger' ? 'триггер · содержит вложенный снаряд' : 'модификатор'}</div>
          <div class="offer-desc">${d.desc}</div>`;
        card.addEventListener('click', () => {
          run.inventory.push(it);
          run.selected = it;
          run.offers = null;
          setMsg('Модуль в запасе. Поставь его в слот или оставь на потом.');
          renderEditor();
        });
        offers.appendChild(card);
      }
      offers.classList.remove('hidden');
    } else offers.classList.add('hidden');

    const tree = $('editor-tree');
    tree.innerHTML = '';
    tree.appendChild(renderNode(run.root, 0, true, 1));

    const inv = $('editor-inventory');
    inv.innerHTML = '';
    if (!run.inventory.length) inv.innerHTML = '<p class="muted small">Пусто</p>';
    for (const it of run.inventory) {
      const b = itemButton(it);
      if (run.selected === it) b.classList.add('selected');
      b.addEventListener('click', () => {
        run.selected = run.selected === it ? null : it;
        renderEditor();
      });
      inv.appendChild(b);
    }
    $('editor-continue').disabled = !!(editorMode === 'levelup' && run.offers);
    if (run.selected) showInfo(run.selected);
  }

  function itemButton(it) {
    const d = E1.MODS[it.type];
    const b = document.createElement('button');
    b.className = 'item';
    b.style.setProperty('--c', d.color);
    const extra = it.child ? ` <span class="muted small">+${E1.countModules(it.child)}</span>` : '';
    const label = it.fossil ? escapeHtml(it.fossil.name) : d.name;
    b.innerHTML = `<span class="mod-icon">${d.icon}</span><span class="item-name">${label}${extra}</span>`;
    b.addEventListener('mouseenter', () => showInfo(it));
    return b;
  }

  function nodeStats(node, depth, power) {
    const s = E1.compileAt(node, depth, power, meta);
    const parts = [`урон ${s.dmg.toFixed(1)}`, `скорость ${Math.round(s.speed)}`, `жизнь ${s.life.toFixed(2)} с`];
    if (s.pierce) parts.push(`пробитие ${s.pierce}`);
    if (s.multi) parts.push(`копий ×${1 + s.multi}`);
    if (s.homing) parts.push('наведение');
    if (depth === 0) parts.push(`темп ${(1 / s.fireInterval).toFixed(1)}/с`);
    return parts.join(' · ');
  }

  function renderNode(node, depth, editable, power) {
    const box = document.createElement('div');
    box.className = 'node';
    box.style.setProperty('--dc', E1.DEPTH_COLORS[Math.min(depth, E1.DEPTH_COLORS.length - 1)]);
    const head = document.createElement('div');
    head.className = 'node-head';
    head.innerHTML = `<span class="depth-badge">${depth === 0 ? 'КОРАБЛЬ' : 'УРОВЕНЬ ' + depth}</span>
      <span class="node-stats">${nodeStats(node, depth, power)}</span>`;
    box.appendChild(head);

    const slots = document.createElement('div');
    slots.className = 'slots';
    node.slots.forEach((it, i) => {
      const row = document.createElement('div');
      row.className = 'slot-row';
      const slot = document.createElement('button');
      slot.className = 'slot' + (it ? ' filled' : '');
      if (it) {
        const d = E1.MODS[it.type];
        slot.style.setProperty('--c', d.color);
        slot.innerHTML = `<span class="mod-icon">${d.icon}</span><span class="item-name">${it.fossil ? escapeHtml(it.fossil.name) : d.name}</span>`;
        slot.addEventListener('mouseenter', () => showInfo(it));
      } else {
        slot.innerHTML = '<span class="muted">пустой слот</span>';
        if (editable && run.selected) {
          slot.classList.add(E1.canPlace(run.selected, depth, meta) ? 'can' : 'cannot');
        }
      }
      if (editable) {
        slot.addEventListener('click', () => onSlotClick(node, i, depth));
      } else slot.disabled = true;
      row.appendChild(slot);

      if (it && it.child) {
        row.appendChild(renderNode(it.child, depth + 1, editable, power));
      } else if (it && it.fossil) {
        const det = document.createElement('details');
        det.className = 'fossil-nest';
        det.innerHTML = `<summary class="muted small">заморожено: ${E1.countModules(it.fossil.node)} модулей, волна ${it.fossil.wave} — развернуть</summary>`;
        det.appendChild(renderNode(it.fossil.node, depth + 1, false, power * E1.fossilPower(meta)));
        row.appendChild(det);
      }
      slots.appendChild(row);
    });
    box.appendChild(slots);
    return box;
  }

  function onSlotClick(node, i, depth) {
    const cur = node.slots[i];
    const sel = run.selected;
    if (sel) {
      if (!E1.canPlace(sel, depth, meta)) {
        setMsg(`Слишком глубоко: этот модуль добавляет ${E1.itemHeight(sel)} ур. вложенности, а лимит — ${E1.maxDepth(meta)}. Улучши «Глубину» в лаборатории.`);
        return;
      }
      node.slots[i] = sel;
      run.inventory = run.inventory.filter((x) => x !== sel);
      if (cur) run.inventory.push(cur);
      run.selected = null;
      setMsg('');
    } else if (cur) {
      node.slots[i] = null;
      run.inventory.push(cur);
      run.selected = cur;
      setMsg('Модуль снят вместе со всем, что в нём вложено.');
    }
    renderEditor();
  }

  function showInfo(it) {
    const d = E1.MODS[it.type];
    let html = `<div class="info-title" style="color:${d.color}">${d.icon} ${it.fossil ? escapeHtml(it.fossil.name) : d.name}</div>
      <div class="info-kind">${{ stat: 'Модификатор', trigger: 'Триггер (матрёшка)', fossil: 'Окаменелость' }[d.kind]}</div>
      <div>${d.desc}</div>`;
    if (d.kind === 'trigger') html += `<div class="muted small">Добавляет уровней вложенности: ${E1.itemHeight(it)}</div>`;
    if (d.kind === 'fossil') html += `<div class="muted small">Сила: ${Math.round(E1.fossilPower(meta) * 100)}% · Не расходует лимит глубины.</div>`;
    $('editor-info').innerHTML = html;
  }

  // ---------- Конец забега ----------
  function endRun(stats) {
    if (!run || run.ended) return;
    run.ended = true;
    game.pause();
    editorMode = null;
    // Окаменевает только схема; модули из запаса пропадают.
    const samples = Math.floor(stats.kills / 4) + stats.wave * stats.wave * 3 + stats.bossKills * 25;
    meta.runs++;
    meta.samples += samples;
    meta.totalSamples += samples;
    meta.totalKills += stats.kills;
    meta.bestWave = Math.max(meta.bestWave, stats.wave);

    let fossil = null;
    if (E1.countModules(run.root) > 0) {
      fossil = {
        id: E1.uid(),
        name: `Окаменелость №${meta.runs}`,
        run: meta.runs,
        wave: stats.wave,
        kills: stats.kills,
        node: E1.clone(run.root),
      };
      meta.fossils.push(fossil);
      if (meta.fossils.length > MAX_FOSSILS) {
        const idx = meta.fossils.findIndex((f) => !meta.selectedFossils.includes(f.id));
        meta.fossils.splice(idx >= 0 ? idx : 0, 1);
      }
      // Новую окаменелость автоматически берём в следующий забег.
      const cap = E1.fossilSlots(meta);
      meta.selectedFossils = meta.selectedFossils.filter((id) => meta.fossils.some((f) => f.id === id));
      meta.selectedFossils.push(fossil.id);
      while (meta.selectedFossils.length > cap) meta.selectedFossils.shift();
    }
    E1.saveMeta(meta);

    const mins = Math.floor(stats.time / 60), secs = Math.floor(stats.time % 60);
    $('results-body').innerHTML = `
      <div class="res-grid">
        <div><b>${stats.wave}</b><span>волна</span></div>
        <div><b>${stats.kills}</b><span>убийств</span></div>
        <div><b>${mins}:${String(secs).padStart(2, '0')}</b><span>время</span></div>
        <div><b class="c-green">+${samples}</b><span>образцов</span></div>
      </div>
      ${fossil ? `<div class="res-fossil"><span class="mod-icon c-amber">◈</span> Сборка окаменела: <b>${fossil.name}</b>
        <div class="fossil-tree">${miniTree(fossil.node)}</div>
        <div class="muted small">Она уже выбрана для следующего забега.</div></div>`
        : '<p class="muted">Схема была пуста — окаменелость не образовалась.</p>'}`;
    show('screen-results');
  }

  function leaveRun() {
    if (game) { game.destroy(); game = null; }
    run = null;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  $('res-lab').addEventListener('click', () => { leaveRun(); screenStack = ['screen-menu']; go('screen-lab'); });
  $('res-again').addEventListener('click', () => { leaveRun(); startRun(); });
  $('res-menu').addEventListener('click', () => { leaveRun(); screenStack = []; go('screen-menu'); });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // старт
  go('screen-menu');
  if (!meta.seenHelp) { meta.seenHelp = true; E1.saveMeta(meta); go('screen-help'); }

  // доступ для отладки из консоли
  E1._app = { get meta() { return meta; }, get run() { return run; }, get game() { return game; }, startRun, openEditor };
})(window.E1);
