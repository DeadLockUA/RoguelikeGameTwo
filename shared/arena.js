// Общая арена для экспериментов 03+: корабль, враги, волны, опыт, снаряды, джойстик, HUD.
// Эксперимент подключает своё оружие через хуки update / renderWorld / renderHud.
window.E99 = window.E99 || {};

(function (E99) {
  'use strict';

  const TAU = Math.PI * 2;
  const GCELL = 64;

  E99.ENEMIES = {
    grunt:    { hp: 22,   speed: 75,  r: 12, dmg: 10, color: '#ff5c5c', xp: 1 },
    runner:   { hp: 11,   speed: 150, r: 8,  dmg: 7,  color: '#ff9f43', xp: 1 },
    splitter: { hp: 45,   speed: 65,  r: 15, dmg: 12, color: '#1dd1a1', xp: 2, split: true },
    brute:    { hp: 140,  speed: 48,  r: 22, dmg: 20, color: '#c56cf0', xp: 4 },
    spitter:  { hp: 32,   speed: 70,  r: 12, dmg: 8,  color: '#54a0ff', xp: 2, ranged: true },
    boss:     { hp: 1800, speed: 40,  r: 42, dmg: 30, color: '#ff3f34', xp: 40, boss: true },
  };

  E99.createArena = function (canvas, cfg) {
    const ctx = canvas.getContext('2d');
    const hooks = cfg.hooks || {};
    const pal = Object.assign({ bg: '#080a14', grid: 'rgba(120,140,255,0.06)', accent: '#7df9ff', xp: '#51cf66' }, cfg.palette || {});
    const ARENA = cfg.arena || 1400;
    const WAVE = cfg.waveDuration || 30;

    const st = {
      time: 0, wave: 1, waveTime: 0, spawnAcc: 0, kills: 0, bossKills: 0,
      xp: 0, level: 1, xpNext: 3, paused: false, over: false, shake: 0,
    };
    const pc = cfg.player || {};
    const player = {
      x: 0, y: 0, r: pc.r || 13, angle: -Math.PI / 2,
      maxHp: pc.maxHp || 100, hp: pc.maxHp || 100, inv: 0,
      speed: pc.speed || 230, magnet: pc.magnet || 90, xpMul: pc.xpMul || 1,
      vx: 0, vy: 0, // направление движения (единичный вектор или 0)
    };

    let enemies = [];
    let shots = [];
    let ebullets = [];
    let gems = [];
    let particles = [];
    let rings = [];
    let nextId = 1;

    const keys = Object.create(null);
    const mouse = { x: 0, y: 0, down: false };
    const JOY_R = 60;
    const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    let touchUsed = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    let view = { w: 800, h: 600, dpr: 1 };

    // ---------- сетка врагов ----------
    const grid = new Map();
    const gkey = (cx, cy) => (cx + 512) * 1024 + (cy + 512);
    function rebuildGrid() {
      grid.clear();
      for (const e of enemies) {
        if (e.dead) continue;
        const k = gkey(Math.floor(e.x / GCELL), Math.floor(e.y / GCELL));
        let a = grid.get(k);
        if (!a) { a = []; grid.set(k, a); }
        a.push(e);
      }
    }
    function forNear(x, y, r, fn) {
      const x0 = Math.floor((x - r) / GCELL), x1 = Math.floor((x + r) / GCELL);
      const y0 = Math.floor((y - r) / GCELL), y1 = Math.floor((y + r) / GCELL);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const a = grid.get(gkey(cx, cy));
        if (a) for (let i = 0; i < a.length; i++) if (!a[i].dead && fn(a[i]) === false) return;
      }
    }
    function nearestEnemy(x, y, maxR, exclude) {
      let best = null, bd = maxR * maxR;
      forNear(x, y, maxR, (e) => {
        if (exclude && exclude.has(e.id)) return;
        const dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = e; }
      });
      return best;
    }

    // ---------- враги ----------
    const hpMul = () => Math.pow(1.17, st.wave - 1);
    function spawnEnemy(type, x, y) {
      if (enemies.length >= 450 && type !== 'boss') return;
      const d = E99.ENEMIES[type];
      if (x === undefined) {
        const a = Math.random() * TAU;
        const dist = Math.hypot(view.w, view.h) / 2 + 60;
        x = Math.max(-ARENA, Math.min(ARENA, player.x + Math.cos(a) * dist));
        y = Math.max(-ARENA, Math.min(ARENA, player.y + Math.sin(a) * dist));
      }
      const hp = d.hp * hpMul() * (d.boss ? 1 + 0.5 * Math.floor(st.wave / 5 - 1) : 1);
      enemies.push({
        id: nextId++, def: d, x, y, r: d.r, hp, maxHp: hp,
        speed: d.speed * (0.9 + Math.random() * 0.2), flash: 0, dead: false,
        shootT: 1 + Math.random() * 2, kx: 0, ky: 0, slowT: 0, slow: 0, burnT: 0, burnDps: 0,
      });
    }
    function pickType() {
      const w = st.wave;
      const t = [['grunt', 10], ['runner', w >= 2 ? 6 : 0], ['splitter', w >= 3 ? 4 : 0], ['brute', w >= 4 ? 3 : 0], ['spitter', w >= 5 ? 3 : 0]];
      let total = 0;
      for (const x of t) total += x[1];
      let r = Math.random() * total;
      for (const x of t) { r -= x[1]; if (r <= 0) return x[0]; }
      return 'grunt';
    }

    function damageEnemy(e, dmg, o) {
      if (e.dead) return;
      e.hp -= dmg;
      e.flash = 0.08;
      if (o) {
        if (o.kx && !e.def.boss) { e.kx += o.kx; e.ky += o.ky; }
        if (o.slow) { e.slow = Math.max(e.slow, o.slow); e.slowT = Math.max(e.slowT, o.slowT || 0.5); }
        if (o.burn) { e.burnDps = Math.max(e.burnDps, o.burn); e.burnT = 3; }
      }
      if (e.hp <= 0) killEnemy(e);
    }
    function killEnemy(e) {
      if (e.dead) return;
      e.dead = true;
      st.kills++;
      dropGems(e.x, e.y, e.def.xp);
      burst(e.x, e.y, e.def.color, e.def.boss ? 60 : 8);
      if (e.def.split) for (let i = 0; i < 3; i++) spawnEnemy('runner', e.x + (Math.random() - 0.5) * 20, e.y + (Math.random() - 0.5) * 20);
      if (e.def.boss) { st.bossKills++; st.shake = 0.6; }
      if (hooks.onKill) hooks.onKill(e, api);
    }
    function dropGems(x, y, v) {
      if (gems.length > 500) { gems[(Math.random() * gems.length) | 0].v += v; return; }
      const big = v >= 10, n = big ? 10 : 1;
      for (let i = 0; i < n; i++) gems.push({ x: x + (big ? (Math.random() - 0.5) * 60 : 0), y: y + (big ? (Math.random() - 0.5) * 60 : 0), v: v / n, pull: false });
    }
    function burst(x, y, color, n) {
      for (let i = 0; i < n && particles.length < 900; i++) {
        const a = Math.random() * TAU, s = 40 + Math.random() * 160;
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, color });
      }
    }

    function updateEnemies(dt) {
      for (const e of enemies) {
        if (e.dead) continue;
        if (e.burnT > 0) { e.burnT -= dt; e.hp -= e.burnDps * dt; if (e.hp <= 0) { killEnemy(e); continue; } }
        if (e.slowT > 0) e.slowT -= dt; else e.slow = 0;
        const dx = player.x - e.x, dy = player.y - e.y, dist = Math.hypot(dx, dy) || 1;
        let mx = dx / dist, my = dy / dist;
        if (e.def.ranged && dist < 260) { mx = -mx * 0.6; my = -my * 0.6; }
        const sp = e.speed * (1 - e.slow);
        e.x += (mx * sp + e.kx) * dt;
        e.y += (my * sp + e.ky) * dt;
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
        if (dist < e.r + player.r) hurtPlayer(e.def.dmg);
      }
      for (const a of grid.values()) {
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

    function hurtPlayer(dmg) {
      if (player.inv > 0 || st.over) return;
      if (hooks.beforeHurt) { dmg = hooks.beforeHurt(dmg, api); if (dmg <= 0) { player.inv = 0.4; return; } }
      player.hp -= dmg;
      player.inv = 0.6;
      st.shake = Math.max(st.shake, 0.25);
      burst(player.x, player.y, '#ffffff', 10);
      if (player.hp <= 0) {
        player.hp = 0;
        st.over = true;
        if (hooks.onDeath) setTimeout(() => hooks.onDeath(api.stats()), 700);
      }
    }

    // ---------- снаряды игрока ----------
    // { x, y, vx, vy, r, dmg, pierce, life, color, onHit(e, shot, api), fx: {slow, burn, kx} }
    function spawnShot(s) {
      if (shots.length > 2500) return null;
      const sh = Object.assign({ r: 4, pierce: 0, life: 1, color: pal.accent, hits: null }, s);
      shots.push(sh);
      return sh;
    }
    function updateShots(dt) {
      for (const s of shots) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        if (s.life <= 0 || Math.abs(s.x) > ARENA + 50 || Math.abs(s.y) > ARENA + 50) { s.life = 0; continue; }
        forNear(s.x, s.y, s.r + 45, (e) => {
          const dx = e.x - s.x, dy = e.y - s.y, rr = e.r + s.r;
          if (dx * dx + dy * dy > rr * rr) return;
          if (!s.hits) s.hits = new Set();
          if (s.hits.has(e.id)) return;
          s.hits.add(e.id);
          const sp = Math.hypot(s.vx, s.vy) || 1;
          const fx = Object.assign({ kx: (s.vx / sp) * (s.knock || 40), ky: (s.vy / sp) * (s.knock || 40) }, s.fx || {});
          damageEnemy(e, s.dmg, fx);
          if (s.onHit) s.onHit(e, s, api);
          s.pierce--;
          if (s.pierce < 0) { s.life = 0; return false; }
        });
      }
      shots = shots.filter((s) => s.life > 0);
    }

    // Кольцо-волна: урон всем в радиусе (визуально расходится)
    function ring(x, y, radius, dmg, color, fx) {
      rings.push({ x, y, r: 0, max: radius, color: color || pal.accent, life: 0.3 });
      forNear(x, y, radius + 40, (e) => {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < radius + e.r) {
          const k = (fx && fx.knock) || 0;
          damageEnemy(e, dmg, Object.assign({ kx: ((e.x - x) / (d || 1)) * k, ky: ((e.y - y) / (d || 1)) * k }, fx || {}));
        }
      });
    }

    // ---------- игрок ----------
    function updatePlayer(dt) {
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
      player.vx = mx; player.vy = my;
      player.x = Math.max(-ARENA, Math.min(ARENA, player.x + mx * player.speed * dt));
      player.y = Math.max(-ARENA, Math.min(ARENA, player.y + my * player.speed * dt));
      player.inv -= dt;
    }
    function updateGems(dt) {
      for (const g of gems) {
        const dx = player.x - g.x, dy = player.y - g.y, d = Math.hypot(dx, dy);
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
      st.xp += v * player.xpMul;
      while (st.xp >= st.xpNext) {
        st.xp -= st.xpNext;
        st.level++;
        st.xpNext = Math.floor(4 + 3 * st.level + 0.55 * st.level * st.level);
        if (hooks.onLevelUp) hooks.onLevelUp(api);
      }
    }

    function update(dt) {
      st.time += dt;
      st.waveTime += dt;
      if (st.waveTime >= WAVE) {
        st.waveTime -= WAVE;
        st.wave++;
        if (st.wave % 5 === 0) spawnEnemy('boss');
        if (hooks.onWave) hooks.onWave(st.wave, api);
      }
      st.spawnAcc += dt;
      const interval = Math.max(0.06, 0.6 * Math.pow(0.87, st.wave - 1));
      while (st.spawnAcc >= interval) { st.spawnAcc -= interval; spawnEnemy(pickType()); }

      rebuildGrid();
      updatePlayer(dt);
      if (hooks.update) hooks.update(dt, api);
      updateShots(dt);
      updateEnemies(dt);
      enemies = enemies.filter((e) => !e.dead);
      for (const b of ebullets) {
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        const dx = b.x - player.x, dy = b.y - player.y, rr = b.r + player.r - 3;
        if (dx * dx + dy * dy < rr * rr) { b.life = 0; hurtPlayer(b.dmg); }
      }
      ebullets = ebullets.filter((b) => b.life > 0);
      updateGems(dt);
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt; }
      particles = particles.filter((p) => p.life > 0);
      for (const r of rings) { r.life -= dt; r.r = r.max * (1 - r.life / 0.3); }
      rings = rings.filter((r) => r.life > 0);
      st.shake = Math.max(0, st.shake - dt);
    }

    // ---------- отрисовка ----------
    function render() {
      const { w, h, dpr } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, w, h);
      let sx = 0, sy = 0;
      if (st.shake > 0) { sx = (Math.random() - 0.5) * st.shake * 24; sy = (Math.random() - 0.5) * st.shake * 24; }
      const camX = player.x - w / 2 + sx, camY = player.y - h / 2 + sy;
      api.cam = { x: camX, y: camY };
      ctx.save();
      ctx.translate(-camX, -camY);
      if (hooks.renderBackground) hooks.renderBackground(ctx, api);
      ctx.strokeStyle = pal.grid;
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

      ctx.fillStyle = pal.xp;
      for (const g of gems) { if (inView(g.x, g.y, 10)) { const s = g.v >= 3 ? 4 : 3; ctx.fillRect(g.x - s, g.y - s, s * 2, s * 2); } }
      for (const e of enemies) {
        if (!inView(e.x, e.y, e.r + 5)) continue;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.def.color + '55';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = e.burnT > 0 ? '#ff922b' : e.slowT > 0 ? '#74c0fc' : e.def.color;
        ctx.stroke();
        if (e.def.boss || e.def.hp >= 100) {
          ctx.fillStyle = '#222';
          ctx.fillRect(e.x - e.r, e.y - e.r - 9, e.r * 2, 4);
          ctx.fillStyle = e.def.color;
          ctx.fillRect(e.x - e.r, e.y - e.r - 9, e.r * 2 * Math.max(0, e.hp / e.maxHp), 4);
        }
      }
      ctx.fillStyle = '#ff4d6d';
      for (const b of ebullets) { if (inView(b.x, b.y, 10)) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); } }

      ctx.globalCompositeOperation = 'lighter';
      for (const s of shots) {
        if (!inView(s.x, s.y, 20)) continue;
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      }
      for (const r of rings) {
        ctx.globalAlpha = Math.max(0, r.life / 0.3);
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (hooks.renderWorld) hooks.renderWorld(ctx, api);
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (!(player.inv > 0 && Math.floor(st.time * 20) % 2 === 0)) {
        if (hooks.renderPlayer) hooks.renderPlayer(ctx, api);
        else {
          ctx.save();
          ctx.translate(player.x, player.y);
          ctx.rotate(player.angle);
          ctx.beginPath();
          ctx.moveTo(18, 0); ctx.lineTo(-11, 11); ctx.lineTo(-5, 0); ctx.lineTo(-11, -11); ctx.closePath();
          ctx.fillStyle = '#0e1a2b'; ctx.fill();
          ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
      drawHud();
    }

    function drawHud() {
      const { w, h } = view;
      const narrow = w < 600;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, 0, w, 6);
      ctx.fillStyle = pal.xp;
      ctx.fillRect(0, 0, w * Math.min(1, st.xp / st.xpNext), 6);
      const hpW = narrow ? 130 : 220;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
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
      const left = Math.ceil(WAVE - st.waveTime);
      ctx.fillText(narrow ? `${left} с` : `${left} с до следующей`, wx, 44);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#cfd8ff';
      ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(`☠ ${st.kills}`, w - 16, 24);
      if (!touchUsed && cfg.hint) {
        ctx.fillStyle = '#5c6390';
        ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText(cfg.hint, w - 16, 44);
      }
      ctx.textAlign = 'left';
      if (hooks.renderHud) hooks.renderHud(ctx, api);

      if (joy.id !== null) {
        let jx = joy.x - joy.ox, jy = joy.y - joy.oy;
        const jl = Math.hypot(jx, jy);
        if (jl > JOY_R) { jx = (jx / jl) * JOY_R; jy = (jy / jl) * JOY_R; }
        ctx.beginPath(); ctx.arc(joy.ox, joy.oy, JOY_R, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
        ctx.strokeStyle = pal.accent; ctx.globalAlpha = 0.4; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(joy.ox + jx, joy.oy + jy, 24, 0, TAU);
        ctx.fillStyle = pal.accent; ctx.fill();
        ctx.globalAlpha = 1;
      } else if (touchUsed && st.time < 6) {
        ctx.textAlign = 'center';
        ctx.globalAlpha = Math.min(1, 6 - st.time) * 0.8;
        ctx.fillStyle = '#e3e7ff';
        ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillText('Коснись и веди пальцем — движение', w / 2, h - (cfg.hintOffset || 110));
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
      }
    }

    // ---------- цикл и ввод ----------
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
      api.view = view;
      canvas.width = view.w * dpr; canvas.height = view.h * dpr;
      canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
    }
    const onKeyDown = (e) => { keys[e.code] = true; };
    const onKeyUp = (e) => { keys[e.code] = false; };
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) { mouse.down = true; mouse.x = e.clientX; mouse.y = e.clientY; } return; }
      touchUsed = true;
      e.preventDefault();
      if (joy.id !== null) return;
      joy.id = e.pointerId; joy.ox = joy.x = e.clientX; joy.oy = joy.y = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    const onPointerMove = (e) => {
      if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; return; }
      if (e.pointerId !== joy.id) return;
      e.preventDefault();
      joy.x = e.clientX; joy.y = e.clientY;
      const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy);
      if (d > JOY_R * 1.6) { const k = (d - JOY_R * 1.6) / d; joy.ox += dx * k; joy.oy += dy * k; }
    };
    const onPointerUp = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) mouse.down = false; return; }
      if (e.pointerId === joy.id) joy.id = null;
    };
    const onBlur = () => { for (const k in keys) keys[k] = false; mouse.down = false; joy.id = null; };

    const api = {
      player, st, view, cam: { x: 0, y: 0 }, mouse, pal,
      get enemies() { return enemies; },
      get touch() { return touchUsed; },
      nearestEnemy, forNear, damageEnemy, spawnShot, ring, burst, hurtPlayer,
      shake(v) { st.shake = Math.max(st.shake, v); },
      mouseWorld() { return { x: mouse.x + api.cam.x, y: mouse.y + api.cam.y }; },
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
      stats: () => ({ wave: st.wave, kills: st.kills, bossKills: st.bossKills, time: st.time, level: st.level }),
      step: update, // для тестов
    };
    return api;
  };
})(window.E99);
