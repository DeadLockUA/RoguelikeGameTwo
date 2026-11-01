// Сохранение мета-прогресса.
(function (E2) {
  'use strict';
  const KEY = 'e99.exp2';
  E2.SAVE_KEY = KEY;

  function defaults() {
    return {
      version: 1,
      biomass: 0,
      upgrades: {},
      unlocked: E2.START_UNLOCKED.slice(),
      strains: [],      // { id, name, run, wave, cells, size, mutations, peak }
      lastSeed: null,   // { size, cells: [type|null], strainId }
      runs: 0,
      bestWave: 0,
      bestPeak: 0,
      totalKills: 0,
      seenHelp: false,
    };
  }

  E2.loadMeta = function () {
    const d = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return d;
      const m = JSON.parse(raw);
      return Object.assign(d, m, { upgrades: Object.assign({}, m.upgrades || {}) });
    } catch (e) { return d; }
  };
  E2.saveMeta = function (meta) {
    try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch (e) { /* ignore */ }
  };
  E2.resetMeta = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    return defaults();
  };
  E2.upg = (meta, id) => meta.upgrades[id] || 0;
  E2.gridSize = (meta) => 7 + 2 * E2.upg(meta, 'gridSize');
  E2.seedSlots = (meta) => 6 + 4 * E2.upg(meta, 'seedSlots');
  E2.tickInterval = (meta, rules) => (0.5 - 0.05 * E2.upg(meta, 'tick')) * (rules ? rules.tickMul : 1);
})(window.E2);
