// Боевая симуляция: корабль, рекурсивные снаряды, враги, волны.
(function (E1) {
  'use strict';

  const ARENA = 1400;          // половина стороны арены
  const PROJ_CAP = 2600;       // бюджет снарядов — защита от экспоненциального взрыва
  const ENEMY_CAP = 450;
  const CELL = 64;
  const TAU = Math.PI * 2;

  E1.createGame = function (canvas, opts) {
    const ctx = canvas.getContext('2d');
    const meta = opts.meta;
    const hooks = opts.hooks || {};

    const st = {
      time: 0, wave: 1, waveTime: 0, spawnAcc: 0,
      kills: 0, bossKills: 0,
      xp: 0, level: 1, xpNext: 3,
      paused: false, over: false,
      spec: null,
      shake: 0,
    };
    const player = {
      x: 0, y: 0, r: 13,
      maxHp: 100 + 25 * E1.upg(meta, 'hp'),
      hp: 0, inv: 0, fireT: 0, angle: -Math.PI / 2,
      speed: 230 * (1 + 0.1 * E1.upg(meta, 'move')),
      magnet: 90 * (1 + 0.25 * E1.upg(meta, 'magnet')),
    };
    player.hp = player.maxHp;
    const xpMul = 1 + 0.1 * E1.upg(meta, 'xp');

    let enemies = [];
    let projs = [];
    let ebullets = [];
    let gems = [];
    let particles = [];
    let nextEnemyId = 1;

    const keys = Object.create(null);
    const mouse = { x: 0, y: 0, down: false };
    // Плавающий сенсорный джойстик: касание в любом месте задаёт центр, смещение пальца — направление.
    const JOY_R = 60;
    const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    let touchUsed = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    let view = { w: 800, h: 600, dpr: 1 };

    // ---------- Пространственная сетка для врагов ----------
    const grid = new Map();
    const gkey = (cx, cy) => (cx + 512) * 1024 + (cy + 512);
    function rebuildGrid() {
      grid.clear();
      for (const e of enemies) {
        if (e.dead) continue;
        const k = gkey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(e);
      }
    }
    function queryNear(x, y, r, out) {
      out.length = 0;
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
      const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const arr = grid.get(gkey(cx, cy));
          if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
        }
      }
      return out;
    }
    const nearBuf = [];
    function nearestEnemy(x, y, maxR, exclude) {
      queryNear(x, y, maxR, nearBuf);
      let best = null, bd = maxR * maxR;
      for (const e of nearBuf) {
        if (e.dead || (exclude && exclude.has(e.id))) continue;
        const dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }

    // ---------- Снаряды ----------
    function emit(spec, x, y, a, mode, parent, ignoreId) {
      const n = 1 + spec.multi;
      const spread = mode === 'orbit' ? 0.6 : 0.16;
      for (let i = 0; i < n; i++) {
        spawnProj(spec, x, y, a + (i - (n - 1) / 2) * spread, mode, parent, ignoreId);
      }
    }

    function spawnProj(spec, x, y, a, mode, parent, ignoreId) {
      if (projs.length >= PROJ_CAP) return;
      const sp = mode === 'mine' ? 0 : spec.speed;
      const p = {
        spec, x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: spec.life * (mode === 'mine' ? 3.5 : mode === 'orbit' ? 5 : 1),
        pierce: spec.pierce,
        hits: null, mode: mode || 'normal', parent: parent || null,
        oa: a, dead: false, done: false, timers: null, target: null, ht: 0,
      };
      if (ignoreId) p.hits = new Set([ignoreId]);
      if (spec.triggers.length) {
        p.timers = spec.triggers.map((t) => (t.interval ? t.interval * (0.1 + Math.random() * 0.4) : 0));
      }
      projs.push(p);
      for (const t of spec.triggers) {
        if (t.kind === 'orbit') {
          for (let k = 0; k < t.count; k++) emit(t.child, x, y, (k / t.count) * TAU, 'orbit', p);
        }
      }
    }

    const hitBuf = [];
    function updateProj(p, dt) {
      const s = p.spec;
      p.life -= dt;
      if (p.mode === 'orbit') {
        if (!p.parent || p.parent.dead) { p.dead = true; return; }
        p.oa += 4 * dt;
        const R = p.parent.spec.r + 22;
        p.x = p.parent.x + Math.cos(p.oa) * R;
        p.y = p.parent.y + Math.sin(p.oa) * R;
      } else {
        if (s.homing > 0 && p.mode !== 'mine') {
          p.ht -= dt;
          if (p.ht <= 0 || (p.target && p.target.dead)) {
            p.ht = 0.12;
            p.target = nearestEnemy(p.x, p.y, 280, p.hits);
          }
          if (p.target) {
            const want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
            const cur = Math.atan2(p.vy, p.vx);
            let d = want - cur;
            while (d > Math.PI) d -= TAU;
            while (d < -Math.PI) d += TAU;
            const maxTurn = s.homing * dt;
            const na = cur + Math.max(-maxTurn, Math.min(maxTurn, d));
            const sp = Math.hypot(p.vx, p.vy);
            p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
          }
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (p.life <= 0 || Math.abs(p.x) > ARENA + 50 || Math.abs(p.y) > ARENA + 50) { p.dead = true; return; }

      // Таймерные триггеры: турель, минёр, окаменелость.
      if (p.timers) {
        for (let i = 0; i < s.triggers.length; i++) {
          const t = s.triggers[i];
          if (!t.interval) continue;
          p.timers[i] -= dt;
          if (p.timers[i] > 0) continue;
          p.timers[i] += t.interval;
          if (t.kind === 'mine') {
            emit(t.child, p.x, p.y, Math.random() * TAU, 'mine', null);
          } else {
            const tgt = nearestEnemy(p.x, p.y, t.kind === 'fossil' ? 420 : 340, null);
            if (tgt) emit(t.child, p.x, p.y, Math.atan2(tgt.y - p.y, tgt.x - p.x), 'normal', null);
          }
        }
      }

      // Столкновения.
      queryNear(p.x, p.y, s.r + 45, hitBuf);
      for (let i = 0; i < hitBuf.length; i++) {
        const e = hitBuf[i];
        if (e.dead) continue;
        const dx = e.x - p.x, dy = e.y - p.y, rr = e.r + s.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (p.mode === 'orbit') {
          if (!p.hits) p.hits = new Map();
          const last = p.hits.get(e.id);
          if (last !== undefined && st.time - last < 0.35) continue;
          p.hits.set(e.id, st.time);
        } else {
          if (!p.hits) p.hits = new Set();
          if (p.hits.has(e.id)) continue;
          p.hits.add(e.id);
        }
        damageEnemy(e, s.dmg, p.vx, p.vy);
        for (const t of s.triggers) {
          if (t.kind !== 'spark') continue;
          const chosen = new Set([e.id]);
          for (let k = 0; k < t.count; k++) {
            const o = nearestEnemy(e.x, e.y, 300, chosen);
            let a;
            if (o) { chosen.add(o.id); a = Math.atan2(o.y - e.y, o.x - e.x); } else a = Math.random() * TAU;
            emit(t.child, e.x, e.y, a, 'normal', null, e.id);
          }
        }
        if (p.mode !== 'orbit') {
          p.pierce--;
          if (p.pierce < 0) { p.dead = true; break; }
        }
      }
    }

    function onProjDeath(p) {
      for (const t of p.spec.triggers) {
        if (t.kind !== 'shards') continue;
        const off = Math.random() * TAU;
        for (let k = 0; k < t.count; k++) emit(t.child, p.x, p.y, off + (k / t.count) * TAU, 'normal', null);
      }
    }

    // ---------- Враги ----------
    function hpMul() { return Math.pow(1.17, st.wave - 1); }

    function spawnEnemy(type, x, y) {
      if (enemies.length >= ENEMY_CAP && type !== 'boss') return;
      const d = E1.ENEMIES[type];
      if (x === undefined) {
        const a = Math.random() * TAU;
        const dist = Math.hypot(view.w, view.h) / 2 + 60;
        x = Math.max(-ARENA, Math.min(ARENA, player.x + Math.cos(a) * dist));
        y = Math.max(-ARENA, Math.min(ARENA, player.y + Math.sin(a) * dist));
      }
      const hp = d.hp * hpMul() * (d.boss ? 1 + 0.5 * Math.floor(st.wave / 5 - 1) : 1);
      enemies.push({
        id: nextEnemyId++, type, def: d, x, y, r: d.r,
        hp, maxHp: hp, speed: d.speed * (0.9 + Math.random() * 0.2),
        flash: 0, dead: false, shootT: 1 + Math.random() * 2, kx: 0, ky: 0,
      });
    }

    function damageEnemy(e, dmg, vx, vy) {
      e.hp -= dmg;
      e.flash = 0.08;
      if (!e.def.boss) {
        const sp = Math.hypot(vx, vy) || 1;
        e.kx += (vx / sp) * 40; e.ky += (vy / sp) * 40;
      }
      if (e.hp <= 0 && !e.dead) killEnemy(e);
    }

    function killEnemy(e) {
      e.dead = true;
      st.kills++;
      const d = e.def;
      dropGems(e.x, e.y, d.xp);
      burst(e.x, e.y, d.color, d.boss ? 60 : 8);
      if (d.split) for (let i = 0; i < 3; i++) spawnEnemy('runner', e.x + (Math.random() - 0.5) * 20, e.y + (Math.random() - 0.5) * 20);
      if (d.boss) { st.bossKills++; st.shake = 0.6; }
    }

    function dropGems(x, y, v) {
      if (gems.length > 500) { gems[(Math.random() * gems.length) | 0].v += v; return; }
      const big = v >= 10;
      const n = big ? 10 : 1;
      for (let i = 0; i < n; i++) {
        gems.push({ x: x + (big ? (Math.random() - 0.5) * 60 : 0), y: y + (big ? (Math.random() - 0.5) * 60 : 0), v: v / n, pull: false });
      }
    }

    function burst(x, y, color, n) {
      for (let i = 0; i < n && particles.length < 900; i++) {
        const a = Math.random() * TAU, s = 40 + Math.random() * 160;
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, color });
      }
    }

    function pickType() {
      const w = st.wave;
      const table = [['grunt', 10], ['runner', w >= 2 ? 6 : 0], ['splitter', w >= 3 ? 4 : 0], ['brute', w >= 4 ? 3 : 0], ['spitter', w >= 5 ? 3 : 0]];
      let total = 0;
      for (const t of table) total += t[1];
      let r = Math.random() * total;
      for (const t of table) { r -= t[1]; if (r <= 0) return t[0]; }
      return 'grunt';
    }

    function updateEnemies(dt) {
      for (const e of enemies) {
        if (e.dead) continue;
        const dx = player.x - e.x, dy = player.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;
        let mx = dx / dist, my = dy / dist;
        if (e.def.ranged && dist < 260) { mx = -mx * 0.6; my = -my * 0.6; }
        e.x += (mx * e.speed + e.kx) * dt;
        e.y += (my * e.speed + e.ky) * dt;
        e.kx *= 0.85; e.ky *= 0.85;
        e.flash -= dt;
        e.x = Math.max(-ARENA, Math.min(ARENA, e.x));
        e.y = Math.max(-ARENA, Math.min(ARENA, e.y));

        if (e.def.ranged || e.def.boss) {
          e.shootT -= dt;
          if (e.shootT <= 0) {
            if (e.def.boss) {
              e.shootT = 2.6;
              const off = Math.random() * TAU;
              for (let k = 0; k < 18; k++) {
                const a = off + (k / 18) * TAU;
                ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, life: 6, r: 6, dmg: 12 });
              }
              for (let k = 0; k < 3; k++) spawnEnemy('grunt', e.x + (Math.random() - 0.5) * 60, e.y + (Math.random() - 0.5) * 60);
            } else if (dist < 520) {
              e.shootT = 2.2;
              ebullets.push({ x: e.x, y: e.y, vx: (dx / dist) * 230, vy: (dy / dist) * 230, life: 4, r: 5, dmg: e.def.dmg });
            }
          }
        }

        if (dist < e.r + player.r && player.inv <= 0) hurtPlayer(e.def.dmg);
      }
      // Лёгкое расталкивание внутри одной клетки.
      for (const arr of grid.values()) {
        for (let i = 0; i < arr.length; i++) {
          const a = arr[i];
          for (let j = i + 1; j < arr.length; j++) {
            const b = arr[j];
            const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 > 0.01 && d2 < rr * rr) {
              const d = Math.sqrt(d2), push = (rr - d) * 0.5;
              const ux = dx / d, uy = dy / d;
              if (!a.def.boss) { a.x -= ux * push; a.y -= uy * push; }
              if (!b.def.boss) { b.x += ux * push; b.y += uy * push; }
            }
          }
        }
      }
    }

    function hurtPlayer(dmg) {
      if (player.inv > 0 || st.over) return;
      player.hp -= dmg;
      player.inv = 0.6;
      st.shake = Math.max(st.shake, 0.25);
      burst(player.x, player.y, '#ffffff', 10);
      if (player.hp <= 0) {
        player.hp = 0;
        st.over = true;
        if (hooks.onDeath) hooks.onDeath(api.stats());
      }
    }

    // ---------- Игрок ----------
    function updatePlayer(dt) {
      let mx = 0, my = 0;
      if (keys.KeyW || keys.ArrowUp) my -= 1;
      if (keys.KeyS || keys.ArrowDown) my += 1;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
      const l = Math.hypot(mx, my);
      if (l > 0) { mx /= l; my /= l; }
      if (joy.id !== null) {
        const jx = joy.x - joy.ox, jy = joy.y - joy.oy;
        const jl = Math.hypot(jx, jy);
        if (jl > 8) {
          const k = Math.min(1, jl / JOY_R) / jl; // аналоговая скорость
          mx = jx * k; my = jy * k;
        }
      }
      player.x = Math.max(-ARENA, Math.min(ARENA, player.x + mx * player.speed * dt));
      player.y = Math.max(-ARENA, Math.min(ARENA, player.y + my * player.speed * dt));
      player.inv -= dt;

      player.fireT -= dt;
      if (player.fireT <= 0 && st.spec) {
        let a = null;
        if (mouse.down) {
          a = Math.atan2(mouse.y - view.h / 2, mouse.x - view.w / 2);
        } else {
          const t = nearestEnemy(player.x, player.y, 650, null);
          if (t) a = Math.atan2(t.y - player.y, t.x - player.x);
        }
        if (a !== null) {
          player.angle = a;
          emit(st.spec, player.x + Math.cos(a) * 16, player.y + Math.sin(a) * 16, a, 'normal', null);
          player.fireT = st.spec.fireInterval;
        } else player.fireT = 0.05;
      }
    }

    function updateGems(dt) {
      for (const g of gems) {
        const dx = player.x - g.x, dy = player.y - g.y;
        const d = Math.hypot(dx, dy);
        if (d < player.magnet) g.pull = true;
        if (g.pull) {
          const sp = 480 * dt;
          g.x += (dx / (d || 1)) * Math.min(sp, d);
          g.y += (dy / (d || 1)) * Math.min(sp, d);
          if (d < player.r + 6) { g.dead = true; gainXp(g.v); }
        }
      }
      gems = gems.filter((g) => !g.dead);
    }

    function gainXp(v) {
      st.xp += v * xpMul;
      while (st.xp >= st.xpNext) {
        st.xp -= st.xpNext;
        st.level++;
        st.xpNext = Math.floor(4 + 3 * st.level + 0.55 * st.level * st.level);
        if (hooks.onLevelUp) hooks.onLevelUp();
      }
    }

    // ---------- Главный шаг ----------
    function update(dt) {
      st.time += dt;
      st.waveTime += dt;
      if (st.waveTime >= E1.WAVE_DURATION) {
        st.waveTime -= E1.WAVE_DURATION;
        st.wave++;
        if (st.wave % 5 === 0) spawnEnemy('boss');
        if (hooks.onWave) hooks.onWave(st.wave);
      }
      st.spawnAcc += dt;
      const interval = Math.max(0.06, 0.6 * Math.pow(0.87, st.wave - 1));
      while (st.spawnAcc >= interval) { st.spawnAcc -= interval; spawnEnemy(pickType()); }

      rebuildGrid();
      updatePlayer(dt);
      for (let i = 0; i < projs.length; i++) {
        const p = projs[i];
        if (!p.dead) updateProj(p, dt);
        if (p.dead && !p.done) { p.done = true; onProjDeath(p); }
      }
      projs = projs.filter((p) => !p.dead);
      updateEnemies(dt);
      enemies = enemies.filter((e) => !e.dead);

      for (const b of ebullets) {
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        const dx = b.x - player.x, dy = b.y - player.y, rr = b.r + player.r - 3;
        if (dx * dx + dy * dy < rr * rr) { b.life = 0; hurtPlayer(b.dmg); }
      }
      ebullets = ebullets.filter((b) => b.life > 0);
      updateGems(dt);
      for (const pt of particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= 0.92; pt.vy *= 0.92; pt.life -= dt; }
      particles = particles.filter((pt) => pt.life > 0);
      st.shake = Math.max(0, st.shake - dt);
    }

    // ---------- Отрисовка ----------
    function render() {
      const { w, h, dpr } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#080a14';
      ctx.fillRect(0, 0, w, h);

      let sx = 0, sy = 0;
      if (st.shake > 0) { sx = (Math.random() - 0.5) * st.shake * 24; sy = (Math.random() - 0.5) * st.shake * 24; }
      const camX = player.x - w / 2 + sx, camY = player.y - h / 2 + sy;
      ctx.save();
      ctx.translate(-camX, -camY);

      // сетка
      ctx.strokeStyle = 'rgba(120,140,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 80;
      for (let x = Math.floor(camX / step) * step; x < camX + w; x += step) { ctx.moveTo(x, camY); ctx.lineTo(x, camY + h); }
      for (let y = Math.floor(camY / step) * step; y < camY + h; y += step) { ctx.moveTo(camX, y); ctx.lineTo(camX + w, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,80,120,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(-ARENA - 15, -ARENA - 15, ARENA * 2 + 30, ARENA * 2 + 30);

      const inView = (x, y, m) => x > camX - m && x < camX + w + m && y > camY - m && y < camY + h + m;

      ctx.fillStyle = '#51cf66';
      for (const g of gems) {
        if (!inView(g.x, g.y, 10)) continue;
        const s = g.v >= 3 ? 4 : 3;
        ctx.fillRect(g.x - s, g.y - s, s * 2, s * 2);
      }

      for (const e of enemies) {
        if (!inView(e.x, e.y, e.r + 5)) continue;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.def.color + '55';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = e.def.color;
        ctx.stroke();
        if (e.def.boss || e.def.hp >= 100) {
          const bw = e.r * 2;
          ctx.fillStyle = '#222';
          ctx.fillRect(e.x - e.r, e.y - e.r - 9, bw, 4);
          ctx.fillStyle = e.def.color;
          ctx.fillRect(e.x - e.r, e.y - e.r - 9, bw * Math.max(0, e.hp / e.maxHp), 4);
        }
      }

      ctx.fillStyle = '#ff4d6d';
      for (const b of ebullets) {
        if (!inView(b.x, b.y, 10)) continue;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      }

      ctx.globalCompositeOperation = 'lighter';
      for (const p of projs) {
        if (!inView(p.x, p.y, 20)) continue;
        const s = p.spec;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = p.mode === 'mine' ? 0.55 + 0.45 * Math.sin(st.time * 10) : 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.r, 0, TAU);
        ctx.fill();
        if (s.triggers.length) {
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = s.triggers[0].child.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, s.r + 3, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      for (const pt of particles) {
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = Math.max(0, pt.life * 2);
        ctx.fillRect(pt.x - 1.5, pt.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // корабль
      if (!(player.inv > 0 && Math.floor(st.time * 20) % 2 === 0)) {
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle);
        ctx.beginPath();
        ctx.moveTo(18, 0); ctx.lineTo(-11, 11); ctx.lineTo(-5, 0); ctx.lineTo(-11, -11); ctx.closePath();
        ctx.fillStyle = '#0e1a2b';
        ctx.fill();
        ctx.strokeStyle = '#7df9ff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.magnet, 0, TAU);
      ctx.strokeStyle = 'rgba(81,207,102,0.07)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      drawHud();
    }

    function drawHud() {
      const { w } = view;
      // XP
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, 0, w, 6);
      ctx.fillStyle = '#51cf66';
      ctx.fillRect(0, 0, w * Math.min(1, st.xp / st.xpNext), 6);
      // HP
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      const narrow = w < 600;
      const hpW = narrow ? 130 : 220;
      ctx.fillRect(16, 18, hpW, 14);
      ctx.fillStyle = player.hp / player.maxHp > 0.3 ? '#ff6b6b' : '#ff2d55';
      ctx.fillRect(16, 18, hpW * (player.hp / player.maxHp), 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(16.5, 18.5, hpW, 14);
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.ceil(player.hp)} / ${player.maxHp}`, 22, 25.5);

      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#cfd8ff';
      ctx.fillText(`Уровень ${st.level}`, 16, 50);
      ctx.textAlign = 'center';
      ctx.font = `bold ${narrow ? 15 : 18}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = st.wave % 5 === 0 ? '#ff6b6b' : '#ffffff';
      const wx = narrow ? w / 2 + 40 : w / 2;
      ctx.fillText(`ВОЛНА ${st.wave}`, wx, 24);
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = '#8b93b8';
      ctx.fillText(narrow ? `${Math.ceil(E1.WAVE_DURATION - st.waveTime)} с` : `${Math.ceil(E1.WAVE_DURATION - st.waveTime)} с до следующей`, wx, 44);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#cfd8ff';
      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`☠ ${st.kills}`, w - 16, 24);
      ctx.fillStyle = projs.length >= PROJ_CAP ? '#ffa94d' : '#8b93b8';
      ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(narrow ? `◦ ${projs.length}` : `снарядов: ${projs.length}${projs.length >= PROJ_CAP ? ' (лимит)' : ''}`, w - 16, 44);
      if (!touchUsed) {
        ctx.fillStyle = '#5c6390';
        ctx.fillText('E / Tab — схема · ЛКМ — ручной прицел', w - 16, 64);
      }
      ctx.textAlign = 'left';

      // джойстик
      if (joy.id !== null) {
        let jx = joy.x - joy.ox, jy = joy.y - joy.oy;
        const jl = Math.hypot(jx, jy);
        if (jl > JOY_R) { jx = (jx / jl) * JOY_R; jy = (jy / jl) * JOY_R; }
        ctx.beginPath();
        ctx.arc(joy.ox, joy.oy, JOY_R, 0, TAU);
        ctx.fillStyle = 'rgba(125,249,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(125,249,255,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(joy.ox + jx, joy.oy + jy, 24, 0, TAU);
        ctx.fillStyle = 'rgba(125,249,255,0.35)';
        ctx.fill();
      } else if (touchUsed && st.time < 6) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(207,216,255,' + Math.min(1, 6 - st.time) * 0.8 + ')';
        ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText('Коснись и веди пальцем — движение', w / 2, view.h - 110);
        ctx.fillText('Стрельба — автоматическая', w / 2, view.h - 88);
        ctx.textAlign = 'left';
      }
    }

    // ---------- Цикл ----------
    let raf = 0, last = 0, running = false;
    function frame(t) {
      if (!running) return;
      const dt = Math.min(0.05, (t - last) / 1000 || 0);
      last = t;
      if (!st.paused && !st.over) update(dt);
      render();
      raf = requestAnimationFrame(frame);
    }

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      view = { w: window.innerWidth, h: window.innerHeight, dpr };
      canvas.width = view.w * dpr;
      canvas.height = view.h * dpr;
      canvas.style.width = view.w + 'px';
      canvas.style.height = view.h + 'px';
    }

    const onKeyDown = (e) => { keys[e.code] = true; };
    const onKeyUp = (e) => { keys[e.code] = false; };
    // Pointer Events: мышь — ручной прицел, касание/перо — джойстик.
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; }
        return;
      }
      touchUsed = true;
      e.preventDefault();
      if (joy.id !== null) return;
      joy.id = e.pointerId;
      joy.ox = joy.x = e.clientX;
      joy.oy = joy.y = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    const onPointerMove = (e) => {
      if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; return; }
      if (e.pointerId !== joy.id) return;
      e.preventDefault();
      joy.x = e.clientX; joy.y = e.clientY;
      // «перетаскивание» базы, если палец ушёл далеко — джойстик следует за пальцем
      const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy);
      if (d > JOY_R * 1.6) { const k = (d - JOY_R * 1.6) / d; joy.ox += dx * k; joy.oy += dy * k; }
    };
    const onPointerUp = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) mouse.down = false; return; }
      if (e.pointerId === joy.id) joy.id = null;
    };
    const onBlur = () => { for (const k in keys) keys[k] = false; mouse.down = false; joy.id = null; };

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
      setTree(root) { st.spec = E1.compile(root, meta); },
      pause() { st.paused = true; onBlur(); },
      resume() { st.paused = false; last = performance.now(); },
      isOver: () => st.over,
      isPaused: () => st.paused,
      stats: () => ({ wave: st.wave, kills: st.kills, bossKills: st.bossKills, time: st.time, level: st.level }),
      // для отладки и тестов
      _debug: { st, player, step: update, counts: () => ({ projs: projs.length, enemies: enemies.length }) },
    };
    return api;
  };
})(window.E1);
