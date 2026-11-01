// Общие помощники интерфейса для экспериментов 03+: сохранения, экраны, лаборатория.
window.E99 = window.E99 || {};

(function (E99) {
  'use strict';

  E99.$ = (id) => document.getElementById(id);

  E99.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  E99.geo = (base, k) => (lvl) => Math.round(base * Math.pow(k, lvl));
  E99.list = (arr) => (lvl) => arr[lvl];

  // Хранилище мета-прогресса в localStorage.
  E99.createStore = function (key, defaults) {
    return {
      load() {
        const d = defaults();
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return d;
          const m = JSON.parse(raw);
          return Object.assign(d, m, { upgrades: Object.assign({}, m.upgrades || {}) });
        } catch (e) { return d; }
      },
      save(meta) { try { localStorage.setItem(key, JSON.stringify(meta)); } catch (e) { /* ignore */ } },
      reset() { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } return defaults(); },
    };
  };

  // Навигация по экранам-секциям с кнопками [data-back].
  E99.createScreens = function (opts) {
    const stack = [];
    const nav = {
      show(id) {
        for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
        if (id) E99.$(id).classList.remove('hidden');
        if (opts.onShow) opts.onShow(id);
      },
      go(id) { stack.push(id); nav.show(id); if (opts.refresh) opts.refresh(id); },
      back() { stack.pop(); const id = stack[stack.length - 1] || opts.home; nav.show(id); if (opts.refresh) opts.refresh(id); },
      reset(list) { stack.length = 0; if (list) stack.push(...list); },
      isOpen: (id) => !E99.$(id).classList.contains('hidden'),
    };
    for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', nav.back);
    return nav;
  };

  // Карточки улучшений: upgrades = [{ id, name, max, cost(l), desc(l) }]
  E99.renderUpgrades = function (el, upgrades, meta, cur, onBuy) {
    el.innerHTML = '';
    for (const u of upgrades) {
      const lvl = meta.upgrades[u.id] || 0;
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : u.cost(lvl);
      const card = document.createElement('div');
      card.className = 'card' + (maxed ? ' maxed' : '');
      card.innerHTML = `<div class="card-title">${u.name} <span class="pips">${'●'.repeat(lvl)}${'○'.repeat(u.max - lvl)}</span></div>
        <div class="card-desc">${u.desc(lvl)}${maxed ? '' : ` <span class="muted">→ ${u.desc(lvl + 1).split(':').pop().trim()}</span>`}</div>`;
      const btn = document.createElement('button');
      const can = !maxed && meta[cur.key] >= cost;
      btn.className = 'btn small' + (can ? ' primary' : '');
      btn.textContent = maxed ? 'Максимум' : `${cur.icon} ${cost}`;
      btn.disabled = !can;
      btn.addEventListener('click', () => { meta[cur.key] -= cost; meta.upgrades[u.id] = lvl + 1; onBuy(); });
      card.appendChild(btn);
      el.appendChild(card);
    }
  };

  // Карточки разблокировок: items = [{ id, cost }], defs[id] = { name, icon, color, desc }
  E99.renderUnlocks = function (el, items, defs, meta, cur, onBuy) {
    el.innerHTML = '';
    for (const u of items) {
      const def = defs[u.id];
      const have = meta.unlocked.includes(u.id);
      const card = document.createElement('div');
      card.className = 'card' + (have ? ' maxed' : '');
      card.innerHTML = `<div class="card-title"><span class="mod-icon" style="color:${def.color}">${def.icon}</span> ${def.name}</div><div class="card-desc">${def.desc}</div>`;
      const btn = document.createElement('button');
      const can = !have && meta[cur.key] >= u.cost;
      btn.className = 'btn small' + (can ? ' primary' : '');
      btn.textContent = have ? 'Открыто' : `${cur.icon} ${u.cost}`;
      btn.disabled = !can;
      btn.addEventListener('click', () => { meta[cur.key] -= u.cost; meta.unlocked.push(u.id); onBuy(); });
      card.appendChild(btn);
      el.appendChild(card);
    }
  };

  // Карточка предложения (выбор 1 из 3).
  E99.offerCard = function ({ color, icon, name, kind, desc }, onPick) {
    const card = document.createElement('button');
    card.className = 'offer';
    card.style.setProperty('--c', color);
    card.innerHTML = `<div class="offer-icon">${icon}</div><div class="offer-name">${name}</div><div class="offer-kind">${kind || ''}</div><div class="offer-desc">${desc}</div>`;
    card.addEventListener('click', onPick);
    return card;
  };

  E99.weightedPick = function (pool, n, weight) {
    const out = [];
    const cand = pool.slice();
    while (out.length < n && cand.length) {
      let total = 0;
      for (const c of cand) total += weight ? weight(c) : 1;
      let r = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < cand.length; i++) { r -= weight ? weight(cand[i]) : 1; if (r <= 0) { idx = i; break; } }
      out.push(cand.splice(idx, 1)[0]);
    }
    return out;
  };

  E99.clearCanvas = function (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
})(window.E99);
