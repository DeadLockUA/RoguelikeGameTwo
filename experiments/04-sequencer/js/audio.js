// Синтезатор на WebAudio: все звуки генерируются кодом, без файлов.
(function (E4) {
  'use strict';

  // Пентатоника (ля минор) для мелодических инструментов.
  const SCALE = [0, 3, 5, 7, 10, 12, 15, 17];
  const freq = (semi, base) => base * Math.pow(2, semi / 12);

  const A = {
    ctx: null, master: null, noise: null, muted: false, voices: 0,

    init() {
      if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      A.ctx = new AC();
      A.master = A.ctx.createGain();
      A.master.gain.value = A.muted ? 0 : 0.5;
      const comp = A.ctx.createDynamicsCompressor();
      A.master.connect(comp);
      comp.connect(A.ctx.destination);
      const len = A.ctx.sampleRate;
      A.noise = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
      const d = A.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    },

    setMuted(m) {
      A.muted = m;
      if (A.master) A.master.gain.value = m ? 0 : 0.5;
    },

    env(g, t, a, peak, dur) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    },

    osc(type, f, t, dur, peak, f2) {
      const o = A.ctx.createOscillator();
      const g = A.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      A.env(g, t, 0.005, peak, dur);
      o.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
      return g;
    },

    noiseBurst(t, dur, peak, filterType, f, q) {
      const s = A.ctx.createBufferSource();
      s.buffer = A.noise;
      const fl = A.ctx.createBiquadFilter();
      fl.type = filterType; fl.frequency.value = f; if (q) fl.Q.value = q;
      const g = A.ctx.createGain();
      A.env(g, t, 0.002, peak, dur);
      s.connect(fl); fl.connect(g);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
      return g;
    },

    // type — инструмент; vol — громкость (сила ноты); step — номер шага (для высоты тона)
    play(type, vol, step) {
      if (!A.ctx || A.muted || A.ctx.state !== 'running') return;
      if (A.voices > 24) return;
      A.voices++;
      setTimeout(() => { A.voices--; }, 300);
      const t = A.ctx.currentTime + 0.01;
      const v = Math.min(1.5, vol || 1);
      const out = [];
      const note = SCALE[(step || 0) % SCALE.length];
      switch (type) {
        case 'kick': out.push(A.osc('sine', 150, t, 0.22, 0.9 * v, 42)); break;
        case 'snare':
          out.push(A.noiseBurst(t, 0.16, 0.45 * v, 'highpass', 1200));
          out.push(A.osc('triangle', 190, t, 0.08, 0.3 * v, 120));
          break;
        case 'hat': out.push(A.noiseBurst(t, 0.05, 0.25 * v, 'highpass', 7500)); break;
        case 'pad':
          for (const s of [0, 3, 7]) out.push(A.osc('triangle', freq(note + s, 220), t, 0.5, 0.12 * v));
          break;
        case 'bass': {
          const o = A.ctx.createOscillator(), fl = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
          o.type = 'sawtooth'; o.frequency.value = freq(note, 55);
          fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(120, t + 0.3);
          A.env(g, t, 0.005, 0.45 * v, 0.32);
          o.connect(fl); fl.connect(g); o.start(t); o.stop(t + 0.4);
          out.push(g);
          break;
        }
        case 'dash': {
          const s = A.ctx.createBufferSource(), fl = A.ctx.createBiquadFilter(), g = A.ctx.createGain();
          s.buffer = A.noise; fl.type = 'bandpass'; fl.Q.value = 4;
          fl.frequency.setValueAtTime(400, t); fl.frequency.exponentialRampToValueAtTime(4000, t + 0.18);
          A.env(g, t, 0.01, 0.4 * v, 0.2);
          s.connect(fl); fl.connect(g); s.start(t); s.stop(t + 0.25);
          out.push(g);
          break;
        }
        case 'clap':
          for (let k = 0; k < 3; k++) out.push(A.noiseBurst(t + k * 0.012, 0.09, 0.3 * v, 'bandpass', 1600, 1.5));
          break;
        case 'synth':
          out.push(A.osc('square', freq(note + 12, 440), t, 0.12, 0.1 * v));
          out.push(A.osc('square', freq(note + 19, 440), t + 0.06, 0.1, 0.07 * v));
          break;
        default: break;
      }
      for (const g of out) g.connect(A.master);
    },
  };

  E4.audio = A;
})(window.E4);
