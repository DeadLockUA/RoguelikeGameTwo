// Бой: корабль — это живая сетка клеток, по которой работает автомат.
(function (E2) {
  'use strict';

  const ARENA = 1500;
  const ENEMY_CAP = 380;
  const TAU = Math.PI * 2;
  const CELL = E2.CELL;
  const GCELL = 64;

  E2.createGame = function (canvas, opts) {
    const ctx = canvas.getContext('2d');
    const meta = opts.meta;
    const hooks = opts.hooks || {};

    const st = {
      time: 0, wave: 1, waveTime: 0, spawnAcc: 0,
      kills: 0, bossKills: 0, paused: false, over: false, shake: 0,
      peak: 0, peakTypes: null,
    };
    const ship = {
      x: 0, y: 0,
      grid: opts.grid,
      rules: opts.rules,
      seed: opts.seed >>> 0,
      tickNo: 0, tickT: 0,
      power: null, boost: null,
      speedBase: 210 * (1 + 0.1 * E2.upg(meta, 'engine')),
      zoom: 1,
    };
    ship.power = E2.computePower(ship.grid, ship.rules);
    ship.boost = E2.nerveBoost(ship.grid);

    let enemies = [];
    let shots = [];
    let ebullets = [];
    let particles = [];
    let nextEnemyId = 1;

    const keys = Object.create(null);
    let view = { w: 800, h: 600, dpr: 1 };
    const JOY_R = 60;
    const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    let touchUsed = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    // ---------- Геометрия корабля ----------
    const n = () => ship.grid.size;
    const half = () => (ship.grid.size - 1) / 2;
    const cellPos = (i) => {
      const s = n();
      return { x: ship.x + ((i % s) - half()) * CELL, y: ship.y + (((i / s) | 0) - half()) * CELL };
    };
    const toLocal = (x, y) => ({ lx: (x - ship.x) / CELL + half(), ly: (y - ship.y) / CELL + half() });

    function cellAtWorld(x, y) {
      const { lx, ly } = toLocal(x, y);
      const gx = Math.round(lx), gy = Math.round(ly), s = n();
      if (gx < 0 || gy < 0 || gx >= s || gy >= s) return -1;
      const i = gy * s + gx;
      return ship.grid.cells[i] ? i : -1;
    }

    // ---------- Сетка врагов ----------
    const egrid = new Map();
    const gkey = (cx, cy) => (cx + 512) * 1024 + (cy + 512);
    function rebuildGrid() {
      egrid.clear();
      for (const e of enemies) {
        if (e.dead) continue;
        const k = gkey(Math.floor(e.x / GCELL), Math.floor(e.y / GCELL));
        let a = egrid.get(k);
        if (!a) { a = []; egrid.set(k, a); }
        a.push(e);
      }
    }
    function forNear(x, y, r, fn) {
      const x0 = Math.floor((x - r) / GCELL), x1 = Math.floor((x + r) / GCELL);
      const y0 = Math.floor((y - r) / GCELL), y1 = Math.floor((y + r) / GCELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const a = egrid.get(gkey(cx, cy));
        if (a) for (let i = 0; i < a.length; i++) if (fn(a[i]) === false) return;
      }
    }
    function nearestEnemy(x, y, maxR) {
      let best = null, bd = maxR * maxR;
      forNear(x, y, maxR, (e) => {
        if (e.dead) return;
        const dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = e; }
      });
      return best;
    }

    // ---------- Такт автомата ----------
    function doTick() {
      const r = E2.tick(ship.grid, ship.rules, ship.tickNo, ship.seed);
      // переносим таймеры пушек и вспышки
      for (let i = 0; i < r.grid.cells.length; i++) {
        const nc = r.grid.cells[i], oc = ship.grid.cells[i];
        if (nc) { nc.ft = oc && oc.t === nc.t ? oc.ft : Math.random() * 0.5; nc.born = oc && oc.t === nc.t ? 0 : 0.35; }
      }
      for (const ev of r.events) {
        if (ev.type === 'sporeDeath' && ship.rules.sporeMine) {
          const p = cellPos(ev.i);
          explode(p.x, p.y, 46, 18, '#da77f2');
        }
      }
      ship.grid = r.grid;
      ship.power = r.power;
      ship.boost = E2.nerveBoost(ship.grid);
      ship.tickNo++;
      if (ship.rules.pulse && ship.tickNo % 8 === 0) volley();
      const cnt = E2.countCells(ship.grid);
      if (cnt.total > st.peak) { st.peak = cnt.total; st.peakTypes = E2.typesFromGrid(ship.grid); }
      if (!ship.grid.cells[E2.coreIndex(n())]) gameOver();
    }

    function volley() {
      ship.grid.cells.forEach((c, i) => {
        if (!c || c.t !== 'gun') return;
        const p = cellPos(i);
        const t = nearestEnemy(p.x, p.y, 320 * ship.rules.gunRange);
        if (!t) return;
        const a = Math.atan2(t.y - p.y, t.x - p.x);
        for (const da of [-0.2, 0, 0.2]) fire(p.x, p.y, a + da, gunDamage(i));
      });
    }

    function gunDamage(i) {
      let d = 8;
      if (ship.rules.heavyGun) {
        const s = n();
        let armor = 0;
        for (const j of E2.neighborsOf(i, s)) { const c = ship.grid.cells[j]; if (c && c.t === 'armor') armor++; }
        if (armor >= 4) d *= 2.5;
      }
      return d;
    }

    function fire(x, y, a, dmg) {
      if (shots.length > 1500) return;
      shots.push({ x, y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, life: 0.62 * ship.rules.gunRange, dmg, heavy: dmg > 10 });
    }

    function updateGuns(dt) {
      const cells = ship.grid.cells;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!c) continue;
        if (c.flash > 0) c.flash -= dt;
        if (c.born > 0) c.born -= dt;
        if (c.t !== 'gun' || !ship.power[i]) continue;
        c.ft = (c.ft || 0) - dt;
        if (c.ft > 0) continue;
        const p = cellPos(i);
        const t = nearestEnemy(p.x, p.y, 320 * ship.rules.gunRange);
        if (!t) { c.ft = 0.1; continue; }
        c.aim = Math.atan2(t.y - p.y, t.x - p.x);
        fire(p.x, p.y, c.aim, gunDamage(i));
        c.ft = 0.6 / ship.boost[i];
      }
    }

    // ---------- Урон ----------
    function damageCell(i, dmg) {
      const c = ship.grid.cells[i];
      if (!c) return;
      c.hp -= dmg;
      c.flash = 0.1;
      if (c.hp <= 0) {
        const p = cellPos(i);
        burst(p.x, p.y, E2.CELLS[c.t].color, 6);
        ship.grid.cells[i] = null;
        if (c.t === 'spore' && ship.rules.sporeMine) explode(p.x, p.y, 46, 18, '#da77f2');
        if (c.t === 'core') gameOver();
        else ship.power = E2.computePower(ship.grid, ship.rules);
      }
    }

    function damageEnemy(e, dmg) {
      if (e.dead) return;
      e.hp -= dmg;
      e.flash = 0.08;
      if (e.hp <= 0) {
        e.dead = true;
        st.kills++;
        burst(e.x, e.y, e.def.color, e.def.boss ? 50 : 7);
        if (e.def.boss) { st.bossKills++; st.shake = 0.6; }
      }
    }

    function explode(x, y, r, dmg, color) {
      forNear(x, y, r + 30, (e) => {
        if (!e.dead && Math.hypot(e.x - x, e.y - y) < r + e.r) damageEnemy(e, dmg);
      });
      burst(x, y, color, 10);
    }

    function burst(x, y, color, k) {
      for (let i = 0; i < k && particles.length < 800; i++) {
        const a = Math.random() * TAU, s = 40 + Math.random() * 150;
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, color });
      }
    }

    function gameOver() {
      if (st.over) return;
      st.over = true;
      st.shake = 0.8;
      if (hooks.onDeath) setTimeout(() => hooks.onDeath(api.stats()), 900);
    }

    // ---------- Враги ----------
    const hpMul = () => Math.pow(1.16, st.wave - 1);
    const dmgMul = () => 1 + 0.07 * (st.wave - 1);

    function spawnEnemy(type) {
      if (enemies.length >= ENEMY_CAP && type !== 'boss') return;
      const d = E2.ENEMIES[type];
      const a = Math.random() * TAU;
      const dist = Math.hypot(view.w, view.h) / 2 / ship.zoom + 60;
      const x = Math.max(-ARENA, Math.min(ARENA, ship.x + Math.cos(a) * dist));
      const y = Math.max(-ARENA, Math.min(ARENA, ship.y + Math.sin(a) * dist));
      const hp = d.hp * hpMul() * (d.boss ? 1 + 0.5 * Math.floor(st.wave / 5 - 1) : 1);
      enemies.push({ id: nextEnemyId++, def: d, x, y, r: d.r, hp, maxHp: hp, speed: d.speed * (0.9 + Math.random() * 0.2), flash: 0, bite: 0, shootT: 1 + Math.random() * 2, dead: false });
    }

    function pickType() {
      const w = st.wave;
      const table = [['grunt', 10], ['runner', w >= 2 ? 6 : 0], ['brute', w >= 3 ? 3 : 0], ['spitter', w >= 4 ? 3 : 0], ['acid', w >= 6 ? 4 : 0]];
      let total = 0;
      for (const t of table) total += t[1];
      let r = Math.random() * total;
      for (const t of table) { r -= t[1]; if (r <= 0) return t[0]; }
      return 'grunt';
    }

    // Контакт круга-врага с клетками корабля: выталкивание + укусы.
    function resolveContact(e, dt) {
      const { lx, ly } = toLocal(e.x, e.y);
      const s = n();
      const rr = e.r / CELL + 0.6;
      let touched = -1, bestPen = 0, nx = 0, ny = 0;
      const x0 = Math.max(0, Math.floor(lx - rr)), x1 = Math.min(s - 1, Math.ceil(lx + rr));
      const y0 = Math.max(0, Math.floor(ly - rr)), y1 = Math.min(s - 1, Math.ceil(ly + rr));
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          const i = gy * s + gx;
          if (!ship.grid.cells[i]) continue;
          // ближайшая точка квадрата клетки к центру врага (в мировых единицах)
          const cx = Math.max(gx - 0.5, Math.min(gx + 0.5, lx));
          const cy = Math.max(gy - 0.5, Math.min(gy + 0.5, ly));
          let dx = (lx - cx) * CELL, dy = (ly - cy) * CELL;
          let d = Math.hypot(dx, dy);
          if (d >= e.r) continue;
          if (d < 0.001) { dx = lx - gx; dy = ly - gy; d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d; d = 0; } else { dx /= d; dy /= d; }
          const pen = e.r - d;
          if (pen > bestPen) { bestPen = pen; touched = i; nx = dx; ny = dy; }
        }
      }
      if (touched < 0) return false;
      e.x += nx * bestPen;
      e.y += ny * bestPen;
      e.bite -= dt;
      if (e.bite <= 0) {
        e.bite = 0.6;
        const c = ship.grid.cells[touched];
        let dmg = e.def.dmg * dmgMul();
        if (e.def.acid && c.t === 'armor') dmg *= 4;
        // контактный урон клеток
        if (c.t === 'spike') damageEnemy(e, 16 * ship.rules.spikeMul);
        else if (c.t === 'spore') damageEnemy(e, 7);
        else if (c.t === 'armor' && ship.rules.thorns) damageEnemy(e, 6);
        damageCell(touched, dmg);
      }
      return true;
    }

    function updateEnemies(dt) {
      for (const e of enemies) {
        if (e.dead) continue;
        const dx = ship.x - e.x, dy = ship.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;
        let mx = dx / dist, my = dy / dist;
        const keepOff = e.def.ranged && dist < 230 + n() * CELL * 0.5;
        if (keepOff) { mx = -mx * 0.5; my = -my * 0.5; }
        e.x += mx * e.speed * dt;
        e.y += my * e.speed * dt;
        e.x = Math.max(-ARENA, Math.min(ARENA, e.x));
        e.y = Math.max(-ARENA, Math.min(ARENA, e.y));
        e.flash -= dt;
        if (dist < n() * CELL + e.r + 10) resolveContact(e, dt);

        if (e.def.ranged || e.def.boss) {
          e.shootT -= dt;
          if (e.shootT <= 0) {
            if (e.def.boss) {
              e.shootT = 2.8;
              const off = Math.random() * TAU;
              for (let k = 0; k < 16; k++) {
                const a = off + (k / 16) * TAU;
                ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, life: 6, r: 6, dmg: 14 * dmgMul() });
              }
              for (let k = 0; k < 3; k++) spawnEnemy('grunt');
            } else if (dist < 560) {
              e.shootT = 2.3;
              ebullets.push({ x: e.x, y: e.y, vx: (dx / dist) * 220, vy: (dy / dist) * 220, life: 4, r: 5, dmg: e.def.dmg * dmgMul() });
            }
          }
        }
      }
      // расталкивание
      for (const a of egrid.values()) {
        for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
          const p = a[i], q = a[j];
          const dx = q.x - p.x, dy = q.y - p.y, rr = p.r + q.r, d2 = dx * dx + dy * dy;
          if (d2 > 0.01 && d2 < rr * rr) {
            const d = Math.sqrt(d2), push = (rr - d) * 0.5, ux = dx / d, uy = dy / d;
            if (!p.def.boss) { p.x -= ux * push; p.y -= uy * push; }
            if (!q.def.boss) { q.x += ux * push; q.y += uy * push; }
          }
        }
      }
    }

    // ---------- Движение корабля ----------
    function updateShip(dt) {
      let mx = 0, my = 0;
      if (keys.KeyW || keys.ArrowUp) my -= 1;
      if (keys.KeyS || keys.ArrowDown) my += 1;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
      const l = Math.hypot(mx, my);
      if (l > 0) { mx /= l; my /= l; }
      if (joy.id !== null) {
        const jx = joy.x - joy.ox, jy = joy.y - joy.oy, jl = Math.hypot(jx, jy);
        if (jl > 8) { const k = Math.min(1, jl / JOY_R) / jl; mx = jx * k; my = jy * k; }
      }
      const cells = E2.countCells(ship.grid).total;
      const speed = ship.speedBase * Math.max(0.55, Math.min(1.15, 1.18 - cells * 0.006));
      const lim = ARENA - n() * CELL / 2;
      ship.x = Math.max(-lim, Math.min(lim, ship.x + mx * speed * dt));
      ship.y = Math.max(-lim, Math.min(lim, ship.y + my * speed * dt));
    }

    // ---------- Шаг ----------
    function update(dt) {
      st.time += dt;
      st.waveTime += dt;
      if (st.waveTime >= E2.WAVE_DURATION) {
        st.waveTime -= E2.WAVE_DURATION;
        st.wave++;
        if (st.wave % 5 === 0) spawnEnemy('boss');
        if (hooks.onWaveEnd) hooks.onWaveEnd(st.wave - 1);
      }
      st.spawnAcc += dt;
      const interval = Math.max(0.07, 0.85 * Math.pow(0.88, st.wave - 1));
      while (st.spawnAcc >= interval) { st.spawnAcc -= interval; spawnEnemy(pickType()); }

      ship.tickT += dt;
      const ti = E2.tickInterval(meta, ship.rules);
      if (ship.tickT >= ti) { ship.tickT -= ti; doTick(); if (st.over) return; }

      rebuildGrid();
      updateShip(dt);
      updateGuns(dt);

      for (const s of shots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.life <= 0) continue;
        forNear(s.x, s.y, 30, (e) => {
          if (e.dead) return;
          const dx = e.x - s.x, dy = e.y - s.y, rr = e.r + 3;
          if (dx * dx + dy * dy < rr * rr) { damageEnemy(e, s.dmg); s.life = 0; return false; }
        });
      }
      shots = shots.filter((s) => s.life > 0);

      updateEnemies(dt);
      enemies = enemies.filter((e) => !e.dead);

      for (const b of ebullets) {
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        const i = cellAtWorld(b.x, b.y);
        if (i >= 0) { damageCell(i, b.dmg); b.life = 0; }
      }
      ebullets = ebullets.filter((b) => b.life > 0);
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
      particles = particles.filter((p) => p.life > 0);
      st.shake = Math.max(0, st.shake - dt);
    }

    // ---------- Отрисовка ----------
    function shipRadius() {
      let r = 0;
      const s = n(), h = half();
      ship.grid.cells.forEach((c, i) => {
        if (!c) return;
        r = Math.max(r, Math.hypot((i % s) - h, ((i / s) | 0) - h));
      });
      return (r + 1) * CELL;
    }

    function render(dt) {
      const { w, h, dpr } = view;
      const targetZoom = Math.max(0.5, Math.min(1.5, Math.min(w, h) * 0.3 / Math.max(shipRadius(), 70)));
      ship.zoom += (targetZoom - ship.zoom) * Math.min(1, dt * 2);
      const z = ship.zoom;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#070b0d';
      ctx.fillRect(0, 0, w, h);
      let sx = 0, sy = 0;
      if (st.shake > 0) { sx = (Math.random() - 0.5) * st.shake * 20; sy = (Math.random() - 0.5) * st.shake * 20; }
      ctx.save();
      ctx.translate(w / 2 + sx, h / 2 + sy);
      ctx.scale(z, z);
      ctx.translate(-ship.x, -ship.y);
      const vw = w / z, vh = h / z;
      const camX = ship.x - vw / 2, camY = ship.y - vh / 2;

      // фон — «чашка Петри»
      ctx.strokeStyle = 'rgba(99,230,190,0.05)';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      const step = 90;
      for (let x = Math.floor(camX / step) * step; x < camX + vw; x += step) { ctx.moveTo(x, camY); ctx.lineTo(x, camY + vh); }
      for (let y = Math.floor(camY / step) * step; y < camY + vh; y += step) { ctx.moveTo(camX, y); ctx.lineTo(camX + vw, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,80,120,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(-ARENA - 10, -ARENA - 10, ARENA * 2 + 20, ARENA * 2 + 20);

      drawShip(ctx);

      const inView = (x, y, m) => x > camX - m && x < camX + vw + m && y > camY - m && y < camY + vh + m;
      for (const e of enemies) {
        if (!inView(e.x, e.y, e.r)) continue;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fillStyle = e.flash > 0 ? '#fff' : e.def.color + '55';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = e.def.color;
        ctx.stroke();
        if (e.def.boss || e.def.hp >= 100) {
          ctx.fillStyle = '#222';
          ctx.fillRect(e.x - e.r, e.y - e.r - 9, e.r * 2, 4);
          ctx.fillStyle = e.def.color;
          ctx.fillRect(e.x - e.r, e.y - e.r - 9, e.r * 2 * Math.max(0, e.hp / e.maxHp), 4);
        }
      }
      ctx.fillStyle = '#ff4d6d';
      for (const b of ebullets) { if (inView(b.x, b.y, 8)) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); } }

      ctx.globalCompositeOperation = 'lighter';
      for (const s of shots) {
        ctx.fillStyle = s.heavy ? '#ffd43b' : '#ffb3b3';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.heavy ? 4.5 : 3, 0, TAU);
        ctx.fill();
      }
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();

      drawHud();
    }

    function drawShip(c) {
      const s = n(), hh = half();
      const ox = ship.x - hh * CELL, oy = ship.y - hh * CELL;
      // область питания
      c.fillStyle = 'rgba(105,219,124,0.05)';
      for (let i = 0; i < s * s; i++) {
        if (!ship.power[i]) continue;
        c.fillRect(ox + (i % s) * CELL - CELL / 2, oy + ((i / s) | 0) * CELL - CELL / 2, CELL, CELL);
      }
      // граница сетки
      c.strokeStyle = 'rgba(99,230,190,0.12)';
      c.lineWidth = 1;
      c.strokeRect(ox - CELL / 2, oy - CELL / 2, s * CELL, s * CELL);

      const tickPhase = ship.tickT / E2.tickInterval(meta, ship.rules);
      for (let i = 0; i < s * s; i++) {
        const cell = ship.grid.cells[i];
        if (!cell) continue;
        const def = E2.CELLS[cell.t];
        const x = ox + (i % s) * CELL, y = oy + ((i / s) | 0) * CELL;
        const hpFrac = Math.max(0.15, Math.min(1, cell.hp / E2.maxHp(cell.t, ship.rules)));
        let size = CELL - 2;
        if (cell.born > 0) size *= 1 - cell.born / 0.35 * 0.6;
        const hs = size / 2;
        c.globalAlpha = ship.power[i] || cell.t === 'core' ? 1 : 0.45;
        c.fillStyle = cell.flash > 0 ? '#ffffff' : shade(def.color, 0.25 + 0.45 * hpFrac);
        c.fillRect(x - hs, y - hs, size, size);
        c.strokeStyle = def.color;
        c.lineWidth = 1.5;
        c.strokeRect(x - hs + 0.75, y - hs + 0.75, size - 1.5, size - 1.5);
        c.fillStyle = def.color;
        if (cell.t === 'core') {
          c.beginPath();
          c.arc(x, y, 5 + Math.sin(st.time * 4) * 1.2, 0, TAU);
          c.fill();
        } else if (cell.t === 'gun') {
          const a = cell.aim !== undefined ? cell.aim : -Math.PI / 2;
          c.beginPath();
          c.moveTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
          c.lineTo(x + Math.cos(a + 2.4) * 5, y + Math.sin(a + 2.4) * 5);
          c.lineTo(x + Math.cos(a - 2.4) * 5, y + Math.sin(a - 2.4) * 5);
          c.closePath();
          c.fill();
        } else if (cell.t === 'reactor') {
          const p = 3 + 2 * Math.sin((st.time + i) * 3);
          c.beginPath(); c.moveTo(x, y - p - 1); c.lineTo(x + p + 1, y); c.lineTo(x, y + p + 1); c.lineTo(x - p - 1, y); c.closePath(); c.fill();
        } else if (cell.t === 'spike') {
          c.fillRect(x - 1.5, y - 6, 3, 12); c.fillRect(x - 6, y - 1.5, 12, 3);
        } else if (cell.t === 'spore') {
          c.beginPath(); c.arc(x, y, 2.5, 0, TAU); c.fill();
        } else if (cell.t === 'nerve') {
          c.fillRect(x - 6, y - 1, 12, 2);
        } else if (cell.t === 'mutagen') {
          c.beginPath(); c.arc(x, y, 3.5 + 1.5 * Math.sin(st.time * 6 + i), 0, TAU); c.fill();
        }
      }
      c.globalAlpha = 1;
      // индикатор такта вокруг ядра
      const ci = E2.coreIndex(s);
      if (ship.grid.cells[ci]) {
        c.strokeStyle = 'rgba(255,212,59,0.5)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(ship.x, ship.y, CELL * 0.75, -Math.PI / 2, -Math.PI / 2 + TAU * tickPhase);
        c.stroke();
      }
    }

    function shade(hex, k) {
      const v = parseInt(hex.slice(1), 16);
      const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
      return `rgb(${(r * k) | 0},${(g * k) | 0},${(b * k) | 0})`;
    }

    function drawHud() {
      const { w, h } = view;
      const narrow = w < 600;
      const core = ship.grid.cells[E2.coreIndex(n())];
      const coreMax = E2.maxHp('core', ship.rules);
      const hpW = narrow ? 130 : 220;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(16, 16, hpW, 14);
      ctx.fillStyle = '#ffd43b';
      ctx.fillRect(16, 16, hpW * Math.max(0, core ? core.hp / coreMax : 0), 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(16.5, 16.5, hpW, 14);
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111';
      ctx.fillText(`ядро ${Math.ceil(core ? core.hp : 0)}`, 22, 23.5);
      const cnt = E2.countCells(ship.grid);
      ctx.fillStyle = '#cfe9df';
      ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`клеток ${cnt.total} · такт ${ship.tickNo}`, 16, 46);
      if (!narrow) {
        ctx.fillStyle = '#7b9b90';
        ctx.fillText(`▲${cnt.gun}  ■${cnt.armor}  ◆${cnt.reactor}${cnt.spore ? '  ✦' + cnt.spore : ''}${cnt.spike ? '  ✚' + cnt.spike : ''}${cnt.nerve ? '  ∿' + cnt.nerve : ''}`, 16, 66);
      }

      ctx.textAlign = 'center';
      ctx.font = `bold ${narrow ? 15 : 18}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = st.wave % 5 === 0 ? '#ff6b6b' : '#fff';
      const wx = narrow ? w / 2 + 40 : w / 2;
      ctx.fillText(`ВОЛНА ${st.wave}`, wx, 22);
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#7b9b90';
      const left = Math.ceil(E2.WAVE_DURATION - st.waveTime);
      ctx.fillText(narrow ? `${left} с` : `${left} с до мутации`, wx, 42);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#cfe9df';
      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`☠ ${st.kills}`, w - 16, 22);
      if (!touchUsed) {
        ctx.fillStyle = '#4f6b62';
        ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText('WASD — движение · E / Tab — геном', w - 16, 42);
      }
      ctx.textAlign = 'left';

      if (joy.id !== null) {
        let jx = joy.x - joy.ox, jy = joy.y - joy.oy;
        const jl = Math.hypot(jx, jy);
        if (jl > JOY_R) { jx = (jx / jl) * JOY_R; jy = (jy / jl) * JOY_R; }
        ctx.beginPath(); ctx.arc(joy.ox, joy.oy, JOY_R, 0, TAU);
        ctx.fillStyle = 'rgba(99,230,190,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(99,230,190,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(joy.ox + jx, joy.oy + jy, 24, 0, TAU);
        ctx.fillStyle = 'rgba(99,230,190,0.35)'; ctx.fill();
      } else if (touchUsed && st.time < 6) {
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(207,233,223,${Math.min(1, 6 - st.time) * 0.8})`;
        ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText('Коснись и веди пальцем — движение', w / 2, h - 110);
        ctx.fillText('Пушки стреляют сами', w / 2, h - 88);
        ctx.textAlign = 'left';
      }
    }

    // ---------- Цикл и ввод ----------
    let raf = 0, last = 0, running = false;
    function frame(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      if (!st.paused && !st.over) update(dt);
      render(dt);
      raf = requestAnimationFrame(frame);
    }
    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      view = { w: window.innerWidth, h: window.innerHeight, dpr };
      canvas.width = view.w * dpr; canvas.height = view.h * dpr;
      canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
    }
    const onKeyDown = (e) => { keys[e.code] = true; };
    const onKeyUp = (e) => { keys[e.code] = false; };
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') return;
      touchUsed = true;
      e.preventDefault();
      if (joy.id !== null) return;
      joy.id = e.pointerId; joy.ox = joy.x = e.clientX; joy.oy = joy.y = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    const onPointerMove = (e) => {
      if (e.pointerId !== joy.id) return;
      e.preventDefault();
      joy.x = e.clientX; joy.y = e.clientY;
      const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy);
      if (d > JOY_R * 1.6) { const k = (d - JOY_R * 1.6) / d; joy.ox += dx * k; joy.oy += dy * k; }
    };
    const onPointerUp = (e) => { if (e.pointerId === joy.id) joy.id = null; };
    const onBlur = () => { for (const k in keys) keys[k] = false; joy.id = null; };

    const api = {
      start() {
        resize();
        window.addEventListener('resize', resize);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      },
      destroy() {
        running = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      },
      pause() { st.paused = true; onBlur(); },
      resume() { st.paused = false; last = performance.now(); },
      isPaused: () => st.paused,
      isOver: () => st.over,
      getGrid: () => ship.grid,
      getRules: () => ship.rules,
      setRules(r) { ship.rules = r; ship.power = E2.computePower(ship.grid, r); },
      graft(i, t) {
        if (ship.grid.cells[i]) return false;
        ship.grid.cells[i] = E2.mkCell(t, ship.rules);
        ship.grid.cells[i].born = 0.35;
        ship.power = E2.computePower(ship.grid, ship.rules);
        ship.boost = E2.nerveBoost(ship.grid);
        return true;
      },
      getPower: () => ship.power,
      stats: () => ({ wave: st.wave, kills: st.kills, bossKills: st.bossKills, time: st.time, peak: st.peak, peakTypes: st.peakTypes, size: n() }),
      _debug: { st, ship, step: update, counts: () => ({ enemies: enemies.length, shots: shots.length }) },
    };
    st.peak = E2.countCells(ship.grid).total;
    st.peakTypes = E2.typesFromGrid(ship.grid);
    return api;
  };
})(window.E2);
