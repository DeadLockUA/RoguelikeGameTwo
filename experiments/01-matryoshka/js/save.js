// Сохранение мета-прогресса в localStorage.
(function (E1) {
  'use strict';

  const KEY = 'e99.exp1';
  E1.SAVE_KEY = KEY;

  function defaults() {
    return {
      version: 1,
      samples: 0,          // валюта лаборатории — «образцы»
      totalSamples: 0,
      upgrades: {},
      unlocked: E1.START_UNLOCKED.slice(),
      fossils: [],         // { id, name, run, wave, kills, node }
      selectedFossils: [], // id окаменелостей, которые берём в забег
      runs: 0,
      bestWave: 0,
      totalKills: 0,
      seenHelp: false,
    };
  }

  E1.loadMeta = function () {
    const d = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return d;
      const m = JSON.parse(raw);
      return Object.assign(d, m, { upgrades: Object.assign({}, m.upgrades || {}) });
    } catch (e) {
      return d;
    }
  };

  E1.saveMeta = function (meta) {
    try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch (e) { /* приватный режим */ }
  };

  E1.resetMeta = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return defaults();
  };

  E1.upg = function (meta, id) { return meta.upgrades[id] || 0; };
})(window.E1);
