// Логика секвенсора: что звучит на каждом шаге и с какой силой.
(function (E4) {
  'use strict';

  // Ровный ритм: ноты дорожки стоят с одинаковым шагом по кругу (минимум 2 ноты).
  E4.isGroove = function (row) {
    const pos = [];
    row.forEach((t, i) => { if (t && E4.NOTES[t].kind === 'note') pos.push(i); });
    if (pos.length < 2) return false;
    const gap = pos[1] - pos[0];
    for (let i = 1; i < pos.length; i++) if (pos[i] - pos[i - 1] !== gap) return false;
    return pos[0] + row.length - pos[pos.length - 1] === gap;
  };
  E4.GROOVE_MUL = 1.3;
  E4.CHORD_STEP = 0.2;
  E4.ACCENT_MUL = 1.8;

  // rows: [{ row: [type|null], power }] — дорожки игрока и пластинок (у пластинок своя длина: полиритм).
  // echoIn — ноты, отложенные «Эхом» с прошлого шага.
  E4.stepEvents = function (rows, tick, echoIn) {
    const notes = [];
    let accent = false, echo = false;
    for (const r of rows) {
      const len = r.row.length;
      if (!len) continue;
      const t = r.row[tick % len];
      if (!t) continue;
      if (t === 'accent') { accent = true; continue; }
      if (t === 'echo') { echo = true; continue; }
      notes.push({ type: t, power: r.power * (r.groove ? E4.GROOVE_MUL : 1) });
    }
    const distinct = new Set(notes.map((n) => n.type)).size;
    const chord = distinct > 1 ? 1 + E4.CHORD_STEP * (distinct - 1) : 1;
    const events = notes.map((n) => ({ type: n.type, mul: n.power * chord * (accent ? E4.ACCENT_MUL : 1) }));
    const echoOut = echo ? events.map((e) => ({ type: e.type, mul: e.mul * 0.5, echo: true })) : [];
    return { events: events.concat(echoIn || []), echoOut, chord: distinct, accent };
  };
})(window.E4);
