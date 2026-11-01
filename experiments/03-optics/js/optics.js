// Трассировка лучей по оптическому столу.
//
// Стол: { size, cells: [ {t, o} | null ] }, источник — в клетке (0, середина), светит на восток.
// Направления (экранные координаты, по часовой): 0=E 1=SE 2=S 3=SW 4=W 5=NW 6=N 7=NE.
// Зеркало с ориентацией o (линия под углом o·45°) отражает направление d в (2o − d) mod 8;
// луч, параллельный зеркалу, проходит насквозь.
(function (E3) {
  'use strict';

  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];
  E3.DX = DX; E3.DY = DY;

  E3.sourceIndex = (size) => ((size - 1) / 2 | 0) * size;

  E3.newBench = function (size) {
    const cells = new Array(size * size).fill(null);
    cells[E3.sourceIndex(size)] = { t: 'source', o: 0 };
    return { size, cells };
  };

  // Перенос стола на больший размер (по центру по вертикали, у левого края).
  E3.resizeBench = function (bench, size) {
    if (bench.size === size) return bench;
    const nb = E3.newBench(size);
    const offY = ((size - 1) / 2 | 0) - ((bench.size - 1) / 2 | 0);
    for (let y = 0; y < bench.size; y++) for (let x = 0; x < bench.size; x++) {
      const c = bench.cells[y * bench.size + x];
      if (!c || c.t === 'source') continue;
      const ny = y + offY;
      if (ny >= 0 && ny < size && x < size) nb.cells[ny * size + x] = c;
    }
    return nb;
  };

  function beamColor(f) {
    const cols = [];
    if (f.red) cols.push([255, 107, 107]);
    if (f.blue) cols.push([77, 171, 247]);
    if (f.green) cols.push([105, 219, 124]);
    if (!cols.length) return '#fff6d5';
    const m = [0, 1, 2].map((k) => Math.round(cols.reduce((s, c) => s + c[k], 0) / cols.length));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  }
  E3.beamColor = beamColor;

  // Возвращает { segments, exits }: координаты в клетках стола.
  E3.trace = function (bench, power) {
    const n = bench.size;
    const segments = [];
    const exits = [];
    const src = E3.sourceIndex(n);
    const queue = [{ x: src % n, y: (src / n) | 0, d: 0, p: power, f: {}, w: 1 }];
    const visited = new Set();
    let budget = 600;

    while (queue.length && budget > 0) {
      const b = queue.pop();
      let { x, y, d, p, w } = b;
      const f = Object.assign({}, b.f);
      for (;;) {
        if (--budget <= 0) break;
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) {
          segments.push({ x1: x, y1: y, x2: x + DX[d] * 0.5, y2: y + DY[d] * 0.5, p, w, color: beamColor(f) });
          exits.push({ x: x + DX[d] * 0.5, y: y + DY[d] * 0.5, d, p, w, burn: !!f.red, slow: !!f.blue, pierce: f.green ? 2 : 0, color: beamColor(f) });
          break;
        }
        segments.push({ x1: x, y1: y, x2: nx, y2: ny, p, w, color: beamColor(f) });
        x = nx; y = ny;
        const fbits = (f.red ? 1 : 0) | (f.blue ? 2 : 0) | (f.green ? 4 : 0) | (w > 1 ? 8 : 0);
        const key = ((y * n + x) * 8 + d) * 16 + fbits;
        if (visited.has(key)) break;   // петля
        visited.add(key);
        const c = bench.cells[y * n + x];
        if (!c) continue;
        if (c.t === 'source') break;
        if (c.t === 'mirror') {
          d = (2 * c.o - d + 16) & 7;
        } else if (c.t === 'splitter') {
          const r = (2 * c.o - d + 16) & 7;
          if (r !== d) { queue.push({ x, y, d: r, p: p * 0.55, f: Object.assign({}, f), w }); p *= 0.55; }
        } else if (c.t === 'amp') {
          p *= 1.6;
        } else if (c.t === 'prism') {
          queue.push({ x, y, d: (d + 1) & 7, p: p * 0.45, f: Object.assign({}, f), w });
          queue.push({ x, y, d: (d + 7) & 7, p: p * 0.45, f: Object.assign({}, f), w });
          p *= 0.45;
        } else if (c.t === 'turn') {
          d = (d + (c.o ? 7 : 1)) & 7;
        } else if (c.t === 'red' || c.t === 'blue' || c.t === 'green') {
          f[c.t] = true;
        } else if (c.t === 'wide') {
          w *= 2; p *= 0.9;
        }
        if (p < 0.5) break;
      }
    }
    return { segments, exits };
  };

  // Сводка для редактора.
  E3.summarize = function (exits) {
    let total = 0, forward = 0;
    for (const e of exits) {
      total += e.p;
      if (e.d === 0 || e.d === 1 || e.d === 7) forward += e.p * (e.d === 0 ? 1 : 0.7);
    }
    return { count: exits.length, total, forward };
  };

  // Отрисовка элемента в клетке (контекст уже смещён в центр клетки), s — размер клетки.
  E3.drawElement = function (ctx, c, s) {
    const def = E3.ELEMENTS[c.t];
    const h = s / 2;
    ctx.lineCap = 'round';
    if (c.t === 'source') {
      ctx.fillStyle = '#fff3bf';
      ctx.beginPath(); ctx.arc(0, 0, h * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd43b'; ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.beginPath(); ctx.moveTo(h * 0.2, 0); ctx.lineTo(h * 0.9, 0); ctx.stroke();
      return;
    }
    ctx.strokeStyle = def.color;
    ctx.fillStyle = def.color;
    ctx.lineWidth = Math.max(1.2, s * 0.1);
    if (c.t === 'mirror' || c.t === 'splitter') {
      const a = c.o * Math.PI / 4, L = h * 0.85;
      if (c.t === 'splitter') ctx.setLineDash([s * 0.12, s * 0.08]);
      ctx.beginPath(); ctx.moveTo(-Math.cos(a) * L, -Math.sin(a) * L); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke();
      ctx.setLineDash([]);
    } else if (c.t === 'amp') {
      ctx.beginPath(); ctx.ellipse(0, 0, h * 0.3, h * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
    } else if (c.t === 'prism') {
      ctx.beginPath(); ctx.moveTo(0, -h * 0.7); ctx.lineTo(h * 0.65, h * 0.55); ctx.lineTo(-h * 0.65, h * 0.55); ctx.closePath(); ctx.stroke();
    } else if (c.t === 'turn') {
      ctx.beginPath(); ctx.arc(0, 0, h * 0.5, c.o ? 0.3 : Math.PI + 0.3, c.o ? Math.PI * 1.5 : Math.PI * 2.5, !!c.o); ctx.stroke();
      ctx.font = `${Math.round(s * 0.35)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c.o ? '↺' : '↻', 0, 0);
    } else if (c.t === 'red' || c.t === 'blue' || c.t === 'green') {
      ctx.globalAlpha = 0.35; ctx.fillRect(-h * 0.7, -h * 0.7, h * 1.4, h * 1.4); ctx.globalAlpha = 1;
      ctx.strokeRect(-h * 0.7, -h * 0.7, h * 1.4, h * 1.4);
    } else if (c.t === 'wide') {
      ctx.beginPath(); ctx.moveTo(0, -h * 0.75); ctx.lineTo(0, h * 0.75);
      ctx.moveTo(-h * 0.3, -h * 0.45); ctx.lineTo(0, -h * 0.75); ctx.lineTo(h * 0.3, -h * 0.45);
      ctx.moveTo(-h * 0.3, h * 0.45); ctx.lineTo(0, h * 0.75); ctx.lineTo(h * 0.3, h * 0.45); ctx.stroke();
    }
  };
})(window.E3);
