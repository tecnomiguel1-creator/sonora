// Sonora: efectos de sonido (amplificador, ecualizador, velocidad y temporizador de apagado).
// Archivo normal (no módulo): se carga antes de app.js y deja `window.AudioFX`.
(function () {
  'use strict';

  const KEY = 'sonora.fx';
  const BANDS = [60, 230, 910, 3600, 14000];
  const BAND_LABELS = ['60 Hz', '230 Hz', '910 Hz', '3,6 kHz', '14 kHz'];
  const PRESETS = {
    normal: { name: 'Normal', eq: [0, 0, 0, 0, 0] },
    graves: { name: 'Más graves', eq: [8, 5, 0, -1, -2] },
    voces: { name: 'Voces', eq: [-2, -1, 4, 4, 1] },
    agudos: { name: 'Más agudos', eq: [-2, -1, 0, 4, 7] },
    rock: { name: 'Rock', eq: [5, 3, -1, 3, 5] },
    pop: { name: 'Pop', eq: [-1, 2, 4, 2, -1] },
    electronica: { name: 'Electrónica', eq: [6, 3, 0, 2, 5] },
    suave: { name: 'Suave', eq: [-3, -1, 1, 0, -3] }
  };

  const DEFAULTS = { boost: 100, preset: 'normal', eq: [0, 0, 0, 0, 0], speed: 1, limiter: true };
  let cfg = load();
  let ctx = null;
  let nodes = null;
  let audioEl = null;
  let fadeGain = 1;
  let sleepTimer = null;
  let sleepEnd = 0; // marca de tiempo en que se apaga (0 = sin temporizador)
  let sleepAtSongEnd = false;
  let tick = null;
  const listeners = new Set();

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      const c = { ...DEFAULTS, ...saved };
      c.boost = clamp(Number(c.boost) || 100, 100, 300);
      c.speed = clamp(Number(c.speed) || 1, 0.5, 2);
      c.eq = Array.isArray(c.eq) && c.eq.length === 5 ? c.eq.map((v) => clamp(Number(v) || 0, -12, 12)) : [0, 0, 0, 0, 0];
      return c;
    } catch {
      return { ...DEFAULTS };
    }
  }
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch {
      /* sin almacenamiento */
    }
  }
  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }
  function emit() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignorar */
      }
    });
  }

  function apply() {
    if (audioEl) {
      audioEl.defaultPlaybackRate = cfg.speed;
      audioEl.playbackRate = cfg.speed;
    }
    if (!nodes) return;
    const t = ctx.currentTime;
    nodes.eq.forEach((f, i) => f.gain.setTargetAtTime(cfg.eq[i], t, 0.02));
    nodes.gain.gain.setTargetAtTime((cfg.boost / 100) * fadeGain, t, 0.02);
    // El limitador evita que el sonido se distorsione cuando se amplifica por encima de 100 %.
    const limit = cfg.limiter || cfg.boost > 100;
    nodes.comp.threshold.setTargetAtTime(limit ? -8 : 0, t, 0.02);
    nodes.comp.ratio.setTargetAtTime(limit ? 14 : 1, t, 0.02);
  }

  const api = {
    BANDS,
    BAND_LABELS,
    PRESETS,
    supported: !!(window.AudioContext || window.webkitAudioContext),
    get: () => ({ ...cfg, eq: [...cfg.eq] }),
    onChange: (fn) => listeners.add(fn),

    // Conecta el <audio> al motor de sonido. Hay que llamarlo desde un gesto del usuario (al reproducir).
    attach(el) {
      audioEl = el;
      apply();
      if (!api.supported) return false;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          ctx = new AC();
          const src = ctx.createMediaElementSource(el);
          const eq = BANDS.map((f, i) => {
            const b = ctx.createBiquadFilter();
            b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
            b.frequency.value = f;
            if (b.type === 'peaking') b.Q.value = 1;
            b.gain.value = cfg.eq[i];
            return b;
          });
          const gain = ctx.createGain();
          const comp = ctx.createDynamicsCompressor();
          comp.knee.value = 10;
          comp.attack.value = 0.003;
          comp.release.value = 0.25;
          let node = src;
          for (const f of eq) {
            node.connect(f);
            node = f;
          }
          node.connect(gain);
          gain.connect(comp);
          comp.connect(ctx.destination);
          nodes = { eq, gain, comp };
          apply();
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return true;
      } catch (err) {
        console.warn('Sin motor de sonido:', err);
        return false;
      }
    },
    resume() {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    // Estado interno (para diagnóstico).
    debug: () => ({ state: ctx && ctx.state, gain: nodes && nodes.gain.gain.value, eq: nodes && nodes.eq.map((f) => f.gain.value), ratio: nodes && nodes.comp.ratio.value }),
    get active() {
      return !!nodes;
    },

    setBoost(pct) {
      cfg.boost = clamp(Math.round(pct), 100, 300);
      persist();
      apply();
      emit();
    },
    setBand(i, db) {
      cfg.eq[i] = clamp(Math.round(db), -12, 12);
      cfg.preset = Object.keys(PRESETS).find((k) => PRESETS[k].eq.every((v, j) => v === cfg.eq[j])) || 'custom';
      persist();
      apply();
      emit();
    },
    setPreset(key) {
      if (!PRESETS[key]) return;
      cfg.preset = key;
      cfg.eq = [...PRESETS[key].eq];
      persist();
      apply();
      emit();
    },
    setSpeed(v) {
      cfg.speed = clamp(Number(v) || 1, 0.5, 2);
      persist();
      apply();
      emit();
    },
    setLimiter(on) {
      cfg.limiter = !!on;
      persist();
      apply();
      emit();
    },
    reset() {
      cfg = { ...DEFAULTS, eq: [0, 0, 0, 0, 0] };
      persist();
      apply();
      emit();
    },
    // Hay que volver a fijar la velocidad cada vez que se carga una canción nueva.
    reapplySpeed() {
      if (audioEl) {
        audioEl.defaultPlaybackRate = cfg.speed;
        audioEl.playbackRate = cfg.speed;
      }
    },

    /* ---- Temporizador de apagado ---- */
    sleepState() {
      return { minutes: sleepEnd ? Math.max(0, Math.ceil((sleepEnd - Date.now()) / 60000)) : 0, atSongEnd: sleepAtSongEnd, on: !!sleepEnd || sleepAtSongEnd };
    },
    // minutes: número de minutos, 'end' = al terminar la canción, 0 = apagado
    setSleep(minutes, onStop) {
      clearTimeout(sleepTimer);
      clearInterval(tick);
      sleepEnd = 0;
      sleepAtSongEnd = false;
      fadeGain = 1;
      apply();
      if (minutes === 'end') sleepAtSongEnd = true;
      else if (minutes > 0) {
        sleepEnd = Date.now() + minutes * 60000;
        sleepTimer = setTimeout(() => api.fadeAndStop(onStop), minutes * 60000);
        tick = setInterval(emit, 30000);
      }
      api._onStop = onStop;
      emit();
    },
    // Si estaba programado "al terminar la canción", devuelve true una sola vez.
    consumeSongEnd() {
      if (!sleepAtSongEnd) return false;
      sleepAtSongEnd = false;
      emit();
      return true;
    },
    fadeAndStop(onStop) {
      sleepEnd = 0;
      clearInterval(tick);
      let n = 0;
      const steps = 20;
      const fade = setInterval(() => {
        n += 1;
        fadeGain = Math.max(0, 1 - n / steps);
        if (nodes) apply();
        if (n >= steps) {
          clearInterval(fade);
          (onStop || api._onStop || (() => {}))();
          fadeGain = 1;
          setTimeout(apply, 200);
          emit();
        }
      }, 250);
    }
  };

  window.AudioFX = api;
})();
