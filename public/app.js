/* Sonora · cliente web (sin dependencias, sin anuncios, sin rastreo) */

/* ============================== Utilidades ============================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fmtTime = (s) => {
  s = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtSize = (b) =>
  b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const fmtLong = (s) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.max(1, min)} min`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const hueOf = (str) => {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`sonora.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`sonora.${key}`, JSON.stringify(value));
    } catch {
      /* almacenamiento no disponible */
    }
  }
};

// Cambia el HTML de un elemento solo si de verdad cambió (evita parpadeos y trabajo de más).
const setHtml = (el, html) => {
  if (el._html !== html) {
    el.innerHTML = html;
    el._html = html;
  }
};

// Vibración corta al tocar un botón (Android). En pantallas táctiles da la sensación de "clic".
const isTouch = matchMedia('(hover: none)').matches;
// true cuando la página se abre dentro de la app de Android (APK)
const inApp = /SonoraAndroid/.test(navigator.userAgent);
// true cuando se abre desde la propia computadora donde corre Sonora
const onThisPc = ['localhost', '127.0.0.1'].includes(location.hostname) && !inApp;
// true cuando la pantalla viene empaquetada dentro del APK (origen http://localhost) y habla con el
// servidor que guardó la pantalla de conexión. Ahí no hay cookies: se usa un token.
const BUNDLED = !!window.SONORA_BUNDLED || (inApp && location.hostname === 'localhost');
const lsRaw = (k) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const BASE = BUNDLED ? lsRaw('sonora.server').replace(/\/+$/, '') : '';
// true cuando la app del celular funciona sola, sin servidor: la biblioteca vive dentro del teléfono.
const LOCAL = BUNDLED && !BASE && lsRaw('sonora.local') === '1';
let TOKEN = BUNDLED ? lsRaw('sonora.token') : '';
const setToken = (t) => {
  TOKEN = t || '';
  try {
    if (t) localStorage.setItem('sonora.token', t);
    else localStorage.removeItem('sonora.token');
  } catch {
    /* sin almacenamiento */
  }
};
const authInit = (init = {}) => (BUNDLED && TOKEN ? { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${TOKEN}` } } : init);
// Dirección completa para <audio>, <img> y descargas (que no pueden enviar cabeceras).
const apiUrl = (p) => BASE + p + (BUNDLED && TOKEN ? `${p.includes('?') ? '&' : '?'}t=${encodeURIComponent(TOKEN)}` : '');
const Offline = window.Offline || { supported: false, ready: Promise.resolve(), has: () => false, urlSync: () => null, coverUrl: () => null, count: () => 0, bytes: () => 0, ids: () => [], persist() {}, remove: async () => {}, saveLibrary: async () => {}, loadLibrary: async () => null };
const tap = () => {
  if (!isTouch) return;
  try {
    navigator.vibrate?.(8);
  } catch {
    /* sin vibración */
  }
};

/* ================================ Estado ================================ */

const state = {
  songs: [],
  playlists: [],
  authRequired: false,
  maxMb: 300,
  view: { name: 'songs' },
  query: '',
  sort: store.get('sort', 'recent'),
  visible: [],
  ctx: null,
  baseQueue: [],
  queue: [],
  index: -1,
  shuffle: store.get('shuffle', false),
  repeat: store.get('repeat', 'off'),
  current: null,
  offline: false, // true cuando se abrió sin servidor y solo se ven las canciones guardadas
  uploads: []
};
const songMap = new Map();
const audio = $('#audio');
// En la app del celular la música viene de otro origen: sin esto el amplificador no podría procesarla.
if (BUNDLED) audio.crossOrigin = 'anonymous';

const setSongs = (list) => {
  state.songs = list;
  songMap.clear();
  for (const s of list) songMap.set(s.id, s);
};
const artistOf = (s) => s?.artist || 'Artista desconocido';
const coverUrl = (s) => Offline.coverUrl(s.id) || apiUrl(`/api/songs/${s.id}/cover?v=${encodeURIComponent(s.cover)}`);
const coverEl = (s, { eq = false, cls = '' } = {}) =>
  s?.cover
    ? `<span class="cover ${cls}"><img loading="lazy" decoding="async" alt="" src="${coverUrl(s)}">${eq ? '<i class="eq"><b></b><b></b><b></b></i>' : ''}</span>`
    : `<span class="cover ph ${cls}" style="--h:${hueOf(s?.album || s?.title || '')}">${icon('music')}${eq ? '<i class="eq"><b></b><b></b><b></b></i>' : ''}</span>`;

/* ================================== API ================================= */

async function api(path, { method = 'GET', body } = {}) {
  if (LOCAL) return window.LocalLib.request(path, { method, body });
  const init = authInit({ method, credentials: 'same-origin', headers: {} });
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}/api${path}`, init);
  if (res.status === 401) {
    showLogin();
    throw new Error('No autorizado');
  }
  if (!res.ok) {
    let msg = 'Algo salió mal';
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* sin cuerpo */
    }
    throw new Error(msg);
  }
  return res.json();
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/* ============================ Hojas y diálogos ========================== */

const sheet = $('#sheet');
let sheetResolve = null;

function openSheet(html) {
  if (sheetResolve) {
    sheetResolve(null);
    sheetResolve = null;
  }
  sheet.innerHTML = `<div class="sheet-body">${html}</div>`;
  if (!sheet.open) sheet.showModal();
}
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) sheet.close();
});
sheet.addEventListener('close', () => {
  if (sheet.open) return; // se volvió a abrir con otro contenido
  if (sheetResolve) {
    const resolve = sheetResolve;
    sheetResolve = null;
    resolve(null);
  }
});

function menuSheet(title, subtitle, items) {
  openSheet(`
    <h2>${esc(title)}</h2>
    ${subtitle ? `<p class="sheet-sub">${esc(subtitle)}</p>` : ''}
    <div class="sheet-menu">
      ${items
        .map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon)}<span>${esc(it.label)}</span>${it.check ? icon('check', 'check') : ''}</button>`)
        .join('')}
    </div>`);
  $$('.sheet-menu button', sheet).forEach((b) =>
    b.addEventListener('click', () => {
      const item = items[Number(b.dataset.i)];
      sheet.close();
      item.run();
    })
  );
}

function formSheet({ title, fields, submit = 'Guardar' }) {
  return new Promise((resolve) => {
    openSheet(`
      <h2>${esc(title)}</h2>
      <form class="form" id="sheetForm">
        ${fields
          .map((f) => `<label class="field"><span>${esc(f.label)}</span><input name="${esc(f.name)}" value="${esc(f.value || '')}" maxlength="200" autocomplete="off" ${f.required ? 'required' : ''}></label>`)
          .join('')}
        <div class="sheet-actions">
          <button type="button" class="btn ghost" data-close>Cancelar</button>
          <button type="submit" class="btn primary">${esc(submit)}</button>
        </div>
      </form>`);
    sheetResolve = resolve;
    $('[data-close]', sheet).addEventListener('click', () => sheet.close());
    $('#sheetForm', sheet).addEventListener('submit', (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(e.target));
      sheetResolve = null;
      sheet.close();
      resolve(values);
    });
    setTimeout(() => $('input', sheet)?.select(), 50);
  });
}

function confirmSheet({ title, text, confirm = 'Eliminar', danger = true }) {
  return new Promise((resolve) => {
    openSheet(`
      <h2>${esc(title)}</h2>
      <p class="sheet-text">${esc(text)}</p>
      <div class="form"><div class="sheet-actions">
        <button class="btn ghost" data-close>Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirm)}</button>
      </div></div>`);
    sheetResolve = (v) => resolve(!!v);
    $('[data-close]', sheet).addEventListener('click', () => sheet.close());
    $('[data-ok]', sheet).addEventListener('click', () => {
      sheetResolve = null;
      sheet.close();
      resolve(true);
    });
  });
}

/* ============================ Reproducción ============================== */

function rebuildQueue(currentId) {
  const base = state.baseQueue.slice();
  if (state.shuffle) {
    const rest = base.filter((id) => id !== currentId);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.queue = currentId ? [currentId, ...rest] : rest;
    state.index = currentId ? 0 : -1;
  } else {
    state.queue = base;
    state.index = currentId ? base.indexOf(currentId) : -1;
  }
}

function startPlayback(ids, startId, { forceShuffle = false } = {}) {
  if (!ids.length) return;
  if (forceShuffle && !state.shuffle) {
    state.shuffle = true;
    store.set('shuffle', true);
  }
  state.baseQueue = ids.slice();
  let first = startId;
  if (!first || !ids.includes(first)) first = state.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
  rebuildQueue(first);
  loadCurrent(true);
}

function loadCurrent(autoplay = true, startAt = 0) {
  const song = songMap.get(state.queue[state.index]);
  if (!song) return;
  state.current = song;
  // Si la canción está guardada en el celular suena desde ahí (sin gastar datos ni necesitar el servidor).
  const remote = apiUrl(`/api/songs/${song.id}/stream`);
  const useSrc = (src) => {
    if (state.current !== song) return; // ya se eligió otra canción mientras tanto
    audio.src = src;
    AudioFX.reapplySpeed();
    if (startAt > 0) audio.addEventListener('loadedmetadata', () => (audio.currentTime = startAt), { once: true });
    if (autoplay) {
      const p = audio.play();
      if (p) p.catch((err) => err.name !== 'AbortError' && console.warn(err));
    }
  };
  if (Offline.has(song.id) && !Offline.urlSync(song.id)) {
    Offline.audioUrl(song.id).then((u) => useSrc(u || remote), () => useSrc(remote));
  } else useSrc(Offline.urlSync(song.id) || remote);
  setLoading(!!autoplay);
  store.set('last', song.id);
  syncPlayer();
  updateMediaSession();
  renderUpNext();
  updateProgress();
}

function togglePlay() {
  if (!state.current) {
    if (!state.songs.length) return;
    return startPlayback(sorted(state.songs).map((s) => s.id));
  }
  if (audio.paused) {
    audio.play().catch(() => {});
    if (!audio.paused && audio.readyState < 3) setLoading(true);
  } else audio.pause();
  syncPlayer(); // el icono cambia al instante, sin esperar al navegador
}

// Muestra una ruedita en el botón de play mientras la canción carga.
function setLoading(on) {
  $$('.js-play').forEach((b) => b.classList.toggle('loading', on));
}

function next(auto = false) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  let i = state.index + 1;
  if (i >= state.queue.length) {
    if (auto && state.repeat !== 'all') {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
    i = 0;
  }
  state.index = i;
  loadCurrent(true);
}

function prev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3 || state.index <= 0) {
    audio.currentTime = 0;
    return;
  }
  state.index -= 1;
  loadCurrent(true);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  store.set('shuffle', state.shuffle);
  if (state.queue.length) rebuildQueue(state.current?.id);
  syncPlayer();
  renderUpNext();
}

function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  store.set('repeat', state.repeat);
  syncPlayer();
}

function addToQueue(id) {
  if (!state.current) return startPlayback([id], id);
  state.baseQueue.push(id);
  state.queue.push(id);
  renderUpNext();
  toast('Añadida a la cola');
}

function restoreLast() {
  const id = store.get('last', null);
  if (!id || !songMap.has(id) || state.current) return;
  state.baseQueue = sorted(state.songs).map((s) => s.id);
  rebuildQueue(id);
  loadCurrent(false, store.get('pos', 0));
}

/* ------------------------- Interfaz del reproductor ---------------------- */

function syncPlayer() {
  const s = state.current;
  const playing = !audio.paused && !audio.ended;
  $('#app').classList.toggle('has-player', !!s);
  $('#bar').hidden = !s;
  if (s) {
    // Las carátulas y textos solo se vuelven a dibujar cuando cambia la canción.
    const key = `${s.id}|${s.title}|${s.artist}|${s.cover}`;
    if (syncPlayer.key !== key) {
      syncPlayer.key = key;
      $('#barCover').innerHTML = coverEl(s);
      $('#barTitle').textContent = s.title;
      $('#barArtist').textContent = artistOf(s);
      $('#npArt').innerHTML = coverEl(s);
      $('#npTitle').textContent = s.title;
      $('#npArtist').textContent = artistOf(s);
      tintFromCover(s);
    }
  }
  $$('.js-play').forEach((b) => {
    setHtml(b, icon(playing ? 'pause' : 'play', 'fill'));
    b.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  });
  $$('.js-prev').forEach((b) => setHtml(b, icon('prev')));
  $$('.js-next').forEach((b) => setHtml(b, icon('next')));
  $$('.js-shuffle').forEach((b) => {
    setHtml(b, icon('shuffle'));
    b.classList.toggle('on', state.shuffle);
    b.setAttribute('aria-pressed', state.shuffle);
  });
  $$('.js-repeat').forEach((b) => {
    setHtml(b, icon('repeat') + (state.repeat === 'one' ? '<b class="badge">1</b>' : ''));
    b.classList.toggle('on', state.repeat !== 'off');
    b.setAttribute('aria-label', { off: 'Repetir: desactivado', all: 'Repetir todo', one: 'Repetir esta canción' }[state.repeat]);
  });
  $$('.js-fav').forEach((b) => {
    setHtml(b, icon('heart', s?.favorite ? 'fill' : ''));
    b.classList.toggle('on', !!s?.favorite);
    b.setAttribute('aria-label', s?.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas');
  });
  document.title = playing && s ? `${s.title} · Sonora` : 'Sonora';
  markRows();
  syncVolumeIcon();
}

// Tiñe el fondo del reproductor grande con el color dominante de la carátula.
function tintFromCover(s) {
  const np = $('#np');
  np.style.setProperty('--np-h', hueOf(s.album || s.title));
  if (!s.cover) return;
  const img = new Image();
  img.onload = () => {
    if (state.current?.id !== s.id) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) {
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
      }
      const n = px.length / 4;
      [r, g, b] = [r / n / 255, g / n / 255, b / n / 255];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if (d < 0.04) return; // carátula casi gris: se queda el tono por defecto
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      np.style.setProperty('--np-h', Math.round(((h * 60) + 360) % 360));
    } catch {
      /* sin lectura de píxeles: se deja el tono por defecto */
    }
  };
  img.src = coverUrl(s);
}

function markRows() {
  const id = state.current?.id;
  const playing = !audio.paused && !audio.ended;
  for (const row of $$('#view .row')) {
    row.classList.toggle('is-current', row.dataset.id === id);
    row.classList.toggle('is-playing', row.dataset.id === id && playing);
  }
}

let lastSave = 0;
let lastPos = 0;
function updateProgress() {
  const d = audio.duration;
  const t = audio.currentTime;
  const p = Number.isFinite(d) && d > 0 ? Math.min(1, t / d) : 0;
  for (const r of $$('.js-seek')) {
    if (!r.dataset.drag) r.value = Math.round(p * 1000);
    r.style.setProperty('--p', `${p * 100}%`);
  }
  $$('.js-cur').forEach((el) => (el.textContent = fmtTime(t)));
  $$('.js-dur').forEach((el) => (el.textContent = fmtTime(Number.isFinite(d) ? d : state.current?.duration)));
  $('#miniProg i').style.width = `${p * 100}%`;
  const now = Date.now();
  if (now - lastSave > 4000 && state.current) {
    lastSave = now;
    store.set('pos', Math.floor(t));
  }
  if ('mediaSession' in navigator && Number.isFinite(d) && d > 0 && now - lastPos > 1000) {
    lastPos = now;
    try {
      navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(t, d) });
    } catch {
      /* no soportado */
    }
  }
}

function renderUpNext() {
  const el = $('#upnext');
  const items = state.queue.slice(state.index + 1, state.index + 31);
  el.innerHTML =
    `<h3>A continuación</h3>` +
    (items.length
      ? items
          .map((id, i) => {
            const s = songMap.get(id);
            return s
              ? `<button class="up" data-jump="${state.index + 1 + i}">${coverEl(s)}<span class="meta"><span class="t">${esc(s.title)}</span><span class="s">${esc(artistOf(s))}</span></span></button>`
              : '';
          })
          .join('')
      : '<p class="muted">No hay más canciones en la cola.</p>');
}

function openNowPlaying(open) {
  const np = $('#np');
  np.classList.toggle('open', open);
  np.setAttribute('aria-hidden', String(!open));
  if (open) $('#npClose').focus({ preventScroll: true });
}

/* Controles en pantalla de bloqueo, auriculares y teclas multimedia */
function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.current) return;
  const s = state.current;
  const art = new URL(s.cover ? coverUrl(s) : 'icons/icon-512.png', location.href).href;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title,
      artist: artistOf(s),
      album: s.album || '',
      artwork: [{ src: art, sizes: '512x512' }]
    });
  } catch {
    /* no soportado */
  }
}

function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* acción no soportada */
    }
  };
  set('play', () => audio.play().catch(() => {}));
  set('pause', () => audio.pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekbackward', (d) => (audio.currentTime = Math.max(0, audio.currentTime - (d?.seekOffset || 10))));
  set('seekforward', (d) => (audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (d?.seekOffset || 10))));
  set('seekto', (d) => {
    if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime);
    else audio.currentTime = d.seekTime;
  });
}

/* Eventos del elemento de audio */
audio.addEventListener('play', () => {
  AudioFX.attach(audio);
  syncPlayer();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
audio.addEventListener('pause', () => {
  setLoading(false);
  syncPlayer();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});
audio.addEventListener('playing', () => setLoading(false));
audio.addEventListener('canplay', () => !audio.paused && setLoading(false));
audio.addEventListener('waiting', () => !audio.paused && setLoading(true));
audio.addEventListener('ended', () => {
  if (AudioFX.consumeSongEnd()) {
    toast('Temporizador: música detenida');
    return;
  }
  next(true);
});
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', updateProgress);
audio.addEventListener('durationchange', updateProgress);
audio.addEventListener('error', () => {
  setLoading(false);
  if (!audio.getAttribute('src')) return;
  toast('No se pudo reproducir esta canción');
});

/* Controles de la barra y del reproductor grande */
document.addEventListener(
  'click',
  (e) => {
    if (e.target.closest('button')) tap();
  },
  true
);
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-player]');
  if (!btn) return;
  switch (btn.dataset.player) {
    case 'toggle': togglePlay(); break;
    case 'next': next(); break;
    case 'prev': prev(); break;
    case 'shuffle': toggleShuffle(); break;
    case 'repeat': cycleRepeat(); break;
    case 'fav': if (state.current) toggleFav(state.current.id); break;
  }
});
document.addEventListener('input', (e) => {
  const r = e.target.closest?.('.js-seek');
  if (!r || !Number.isFinite(audio.duration)) return;
  audio.currentTime = (Number(r.value) / 1000) * audio.duration;
  r.style.setProperty('--p', `${Number(r.value) / 10}%`);
});
document.addEventListener('pointerdown', (e) => {
  const r = e.target.closest?.('.js-seek');
  if (r) r.dataset.drag = '1';
});
for (const ev of ['pointerup', 'pointercancel']) {
  document.addEventListener(ev, () => $$('.js-seek').forEach((r) => delete r.dataset.drag));
}
$('#barOpen').addEventListener('click', () => openNowPlaying(true));
$('#barExpand').addEventListener('click', () => openNowPlaying(true));
$('#npClose').addEventListener('click', () => openNowPlaying(false));
$('#npMore').addEventListener('click', () => state.current && songMenu(state.current.id, null));
$('#upnext').addEventListener('click', (e) => {
  const b = e.target.closest('[data-jump]');
  if (!b) return;
  state.index = Number(b.dataset.jump);
  loadCurrent(true);
});

/* Volumen */
const vol = $('#vol');
let lastVolume = store.get('volume', 1);
audio.volume = lastVolume;
vol.value = Math.round(lastVolume * 100);
vol.style.setProperty('--p', `${vol.value}%`);
vol.addEventListener('input', () => {
  audio.muted = false;
  audio.volume = Number(vol.value) / 100;
  if (audio.volume > 0) lastVolume = audio.volume;
  store.set('volume', lastVolume);
  vol.style.setProperty('--p', `${vol.value}%`);
  syncVolumeIcon();
});
$('#muteBtn').addEventListener('click', () => {
  if (audio.muted || audio.volume === 0) {
    audio.muted = false;
    audio.volume = lastVolume || 1;
  } else audio.muted = true;
  vol.value = audio.muted ? 0 : Math.round(audio.volume * 100);
  vol.style.setProperty('--p', `${vol.value}%`);
  syncVolumeIcon();
});
function syncVolumeIcon() {
  $('#muteBtn').innerHTML = icon(audio.muted || audio.volume === 0 ? 'mute' : 'volume');
}


/* Sonido: amplificador, ecualizador, velocidad y temporizador */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEPS = [
  { v: 0, t: 'Apagado' },
  { v: 15, t: '15 min' },
  { v: 30, t: '30 min' },
  { v: 45, t: '45 min' },
  { v: 60, t: '1 hora' },
  { v: 'end', t: 'Al terminar la canción' }
];
function soundSheetHtml() {
  const c = AudioFX.get();
  const sl = AudioFX.sleepState();
  const chip = (act, val, text, on) => `<button class="chip ${on ? 'on' : ''}" data-fx="${act}" data-v="${val}">${esc(text)}</button>`;
  return `<h2>Sonido</h2>
  <div class="fx">
    <section>
      <div class="fx-row"><span>Amplificador</span><output id="fxBoostV">${c.boost}%</output></div>
      <input type="range" id="fxBoost" min="100" max="300" step="5" value="${c.boost}" style="--p:${(c.boost - 100) / 2}%" aria-label="Amplificador de volumen">
      <p class="note ${c.boost > 200 ? 'warn' : ''}" id="fxBoostN">${c.boost > 200 ? 'Muy alto: puede dañar tus oídos o las bocinas. Bájalo si se escucha raro.' : 'Sube el volumen más allá del máximo del dispositivo. Usa con cuidado.'}</p>
    </section>
    <section>
      <h3>Ecualizador</h3>
      <div class="chips" id="fxPresets">${Object.entries(AudioFX.PRESETS).map(([k, p]) => chip('preset', k, p.name, c.preset === k)).join('')}</div>
      <div class="fxeq">${AudioFX.BAND_LABELS.map(
        (l, i) => `<label><span>${l}</span><input type="range" data-band="${i}" min="-12" max="12" step="1" value="${c.eq[i]}" style="--p:${((c.eq[i] + 12) / 24) * 100}%" aria-label="${l}"><output>${c.eq[i] > 0 ? '+' : ''}${c.eq[i]} dB</output></label>`
      ).join('')}</div>
    </section>
    <section>
      <h3>Velocidad</h3>
      <div class="chips" id="fxSpeeds">${SPEEDS.map((v) => chip('speed', v, v === 1 ? 'Normal' : `${v}×`, c.speed === v)).join('')}</div>
    </section>
    <section>
      <h3>Temporizador de apagado</h3>
      <div class="chips" id="fxSleeps">${SLEEPS.map((o) => chip('sleep', o.v, o.t, o.v === 0 ? !sl.on : o.v === 'end' ? sl.atSongEnd : sl.minutes && o.v === sl.minutes)).join('')}</div>
      <p class="note" id="fxSleepN">${sl.minutes ? `La música se detendrá en unos ${sl.minutes} min.` : sl.atSongEnd ? 'La música se detendrá cuando termine esta canción.' : ''}</p>
    </section>
    <label class="fx-switch"><span>Proteger de la distorsión (limitador)</span><input type="checkbox" id="fxLimiter" ${c.limiter ? 'checked' : ''}></label>
    <p class="fx-keys">Teclado: <kbd>Espacio</kbd> pausa · <kbd>←</kbd> <kbd>→</kbd> ±10 s · <kbd>↑</kbd> <kbd>↓</kbd> volumen · <kbd>M</kbd> silencio · <kbd>N</kbd> siguiente · <kbd>P</kbd> anterior</p>
    <div class="sheet-actions"><button class="btn ghost" data-fx="reset">Restablecer</button><button class="btn primary" data-fx="close">Listo</button></div>
  </div>`;
}
function openSoundSheet() {
  if (!AudioFX.supported) return toast('Este navegador no permite ajustar el sonido');
  openSheet(soundSheetHtml());
  const ping = () => AudioFX.attach(audio); // por si todavía no se ha reproducido nada
  if (!audio.paused) ping();
}
const syncSheetChips = (sel, attr, val) =>
  $$(`${sel} .chip`, sheet).forEach((b) => b.classList.toggle('on', String(b.dataset[attr]) === String(val)));
sheet.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'fxBoost') {
    AudioFX.setBoost(Number(t.value));
    const v = Number(t.value);
    t.style.setProperty('--p', `${(v - 100) / 2}%`);
    $('#fxBoostV', sheet).textContent = `${v}%`;
    const n = $('#fxBoostN', sheet);
    n.classList.toggle('warn', v > 200);
    n.textContent = v > 200 ? 'Muy alto: puede dañar tus oídos o las bocinas. Bájalo si se escucha raro.' : 'Sube el volumen más allá del máximo del dispositivo. Usa con cuidado.';
  } else if (t.dataset.band !== undefined) {
    const i = Number(t.dataset.band);
    const v = Number(t.value);
    AudioFX.setBand(i, v);
    t.style.setProperty('--p', `${((v + 12) / 24) * 100}%`);
    t.nextElementSibling.textContent = `${v > 0 ? '+' : ''}${v} dB`;
    syncSheetChips('#fxPresets', 'v', AudioFX.get().preset);
  }
});
sheet.addEventListener('change', (e) => {
  if (e.target.id === 'fxLimiter') AudioFX.setLimiter(e.target.checked);
});
sheet.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fx]');
  if (!b) return;
  const { fx, v } = b.dataset;
  if (fx === 'close') sheet.close();
  else if (fx === 'reset') {
    AudioFX.reset();
    AudioFX.setSleep(0);
    openSheet(soundSheetHtml());
  } else if (fx === 'preset') {
    AudioFX.setPreset(v);
    openSheet(soundSheetHtml());
  } else if (fx === 'speed') {
    AudioFX.setSpeed(Number(v));
    syncSheetChips('#fxSpeeds', 'v', v);
  } else if (fx === 'sleep') {
    const val = v === 'end' ? 'end' : Number(v);
    AudioFX.setSleep(val, () => audio.pause());
    syncSheetChips('#fxSleeps', 'v', v);
    const sl = AudioFX.sleepState();
    $('#fxSleepN', sheet).textContent = sl.minutes ? `La música se detendrá en unos ${sl.minutes} min.` : sl.atSongEnd ? 'La música se detendrá cuando termine esta canción.' : '';
  }
});
$('#fxBtn').addEventListener('click', openSoundSheet);
$('#npFx').addEventListener('click', openSoundSheet);

/* Atajos de teclado (computadora) */
document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select, dialog')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10);
  else if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 10);
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    vol.value = Math.min(100, Math.max(0, Number(vol.value) + (e.key === 'ArrowUp' ? 5 : -5)));
    vol.dispatchEvent(new Event('input'));
  } else if (e.key === 'm' || e.key === 'M') $('#muteBtn').click();
  else if (e.key === 'n' || e.key === 'N') next();
  else if (e.key === 'p' || e.key === 'P') prev();
  else if (e.key === 'Escape') openNowPlaying(false);
});

/* ============================ Datos y acciones ========================== */

// Actualiza solo el corazón de la fila (sin redibujar toda la lista).
function patchFavUI(id) {
  const s = songMap.get(id);
  const btn = $(`#view .row[data-id="${id}"] .fav`);
  if (!s || !btn) return;
  btn.classList.toggle('on', s.favorite);
  btn.innerHTML = icon('heart', s.favorite ? 'fill' : '');
  btn.setAttribute('aria-label', s.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas');
}

async function toggleFav(id) {
  const s = songMap.get(id);
  if (!s) return;
  const refresh = () => {
    patchFavUI(id);
    syncPlayer();
    if (state.view.name === 'favorites') render(); // aquí la fila debe aparecer o desaparecer
  };
  s.favorite = !s.favorite;
  refresh();
  try {
    await api(`/songs/${id}`, { method: 'PATCH', body: { favorite: s.favorite } });
  } catch {
    s.favorite = !s.favorite;
    toast('No se pudo actualizar la favorita');
    refresh();
  }
}

async function editSong(id) {
  const s = songMap.get(id);
  const values = await formSheet({
    title: 'Editar información',
    fields: [
      { name: 'title', label: 'Título', value: s.title, required: true },
      { name: 'artist', label: 'Artista', value: s.artist },
      { name: 'album', label: 'Álbum', value: s.album }
    ]
  });
  if (!values) return;
  try {
    Object.assign(s, await api(`/songs/${id}`, { method: 'PATCH', body: values }));
    syncPlayer();
    updateMediaSession();
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteSong(id) {
  const s = songMap.get(id);
  const ok = await confirmSheet({ title: 'Eliminar canción', text: LOCAL ? `«${s.title}» se borrará de este celular. No se puede deshacer.` : `«${s.title}» se borrará de tu biblioteca y del servidor. No se puede deshacer.` });
  if (!ok) return;
  try {
    await api(`/songs/${id}`, { method: 'DELETE' });
  } catch (err) {
    return toast(err.message);
  }
  const wasCurrent = state.current?.id === id;
  Offline.remove(id).catch(() => {});
  setSongs(state.songs.filter((x) => x.id !== id));
  for (const p of state.playlists) p.songIds = p.songIds.filter((x) => x !== id);
  state.baseQueue = state.baseQueue.filter((x) => x !== id);
  const at = state.queue.indexOf(id);
  if (at !== -1) {
    state.queue.splice(at, 1);
    if (at < state.index) state.index -= 1;
  }
  if (wasCurrent) {
    if (state.queue.length) {
      state.index = Math.min(state.index, state.queue.length - 1);
      loadCurrent(!audio.paused);
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      state.current = null;
      state.index = -1;
      openNowPlaying(false);
    }
  }
  syncPlayer();
  renderUpNext();
  renderSide();
  render();
  toast('Canción eliminada');
}

function downloadSong(id) {
  const a = document.createElement('a');
  a.href = apiUrl(`/api/songs/${id}/download`);
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

/* ============== Guardar en el celular (escuchar sin conexión) ============== */

let saving = false;
const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const wifiOk = () => navigator.connection?.type !== 'cellular'; // el guardado automático no gasta datos móviles

async function fetchBlob(path) {
  const res = await fetch(BASE + path, authInit());
  if (res.status === 401) {
    showLogin();
    throw new Error('No autorizado');
  }
  if (!res.ok) throw new Error('No se pudo descargar');
  return res.blob();
}

function setSaveStatus(text) {
  const el = $('#saveStatus');
  if (el) el.textContent = text;
}

// Marca con un ✓ las canciones guardadas, sin volver a dibujar la lista.
function refreshBadges() {
  for (const row of $$('#view .row')) row.classList.toggle('saved', !LOCAL && Offline.has(row.dataset.id));
}

function renderOfflineBox() {
  const box = $('#offlineBox');
  if (!box) return;
  const n = Offline.count();
  const auto = store.get('autosave', false);
  if (LOCAL) {
    return setHtml(
      box,
      `<h3>En este celular</h3>
       <p class="muted small">Tu música se guarda dentro del celular y suena sin internet ni computadora. Si desinstalas la app o borras sus datos, se pierde.</p>
       <p class="muted small">Guardadas: <b>${plural(n, 'canción', 'canciones')}</b>${n ? ` · ${fmtBytes(Offline.bytes())}` : ''}</p>
       <div class="conn-actions">${n ? `<button class="btn ghost" data-act="clear-offline">${icon('trash')} Borrar toda la música</button>` : ''}</div>`
    );
  }
  setHtml(
    box,
    `<h3>Sin conexión</h3>
     <p class="muted small">Guarda canciones en el celular para escucharlas sin internet y con la computadora apagada. Las nuevas canciones que subas a tu biblioteca se pueden guardar solas.</p>
     <p class="small" id="saveStatus"></p>
     <p class="muted small">Guardadas en el celular: <b>${plural(n, 'canción', 'canciones')}</b>${n ? ` · ${fmtBytes(Offline.bytes())}` : ''}</p>
     <div class="conn-actions">
       ${state.offline ? '' : `<button class="btn" data-act="save-all">${icon('download')} Guardar toda la biblioteca</button>`}
       ${state.offline ? '' : `<button class="btn ghost" data-act="toggle-autosave">Guardar las nuevas solas: ${auto ? 'Sí' : 'No'}</button>`}
       ${n ? `<button class="btn ghost" data-act="clear-offline">${icon('trash')} Borrar las guardadas</button>` : ''}
     </div>`
  );
}

async function saveSongs(ids, { silent = false } = {}) {
  if (!Offline.supported) return toast('Este dispositivo no permite guardar música sin conexión.');
  if (state.offline) return toast('Necesitas conexión con tu servidor para guardar canciones.');
  if (saving) return toast('Ya se están guardando canciones…');
  const todo = ids.filter((id) => songMap.has(id) && !Offline.has(id));
  if (!todo.length) {
    if (!silent) toast('Ya está guardado en el celular');
    return;
  }
  saving = true;
  Offline.persist();
  let done = 0;
  let failed = 0;
  if (!silent) toast(todo.length === 1 ? 'Guardando en el celular…' : `Guardando ${todo.length} canciones…`);
  for (const id of todo) {
    const s = songMap.get(id);
    setSaveStatus(`Guardando ${done + failed + 1} de ${todo.length}: ${s.title}`);
    try {
      const audioBlob = await fetchBlob(`/api/songs/${id}/stream`);
      let coverBlob = null;
      if (s.cover) coverBlob = await fetchBlob(`/api/songs/${id}/cover`).catch(() => null);
      await Offline.save(id, audioBlob, coverBlob);
      done += 1;
      refreshBadges();
    } catch (err) {
      failed += 1;
      if (err?.name === 'QuotaExceededError') {
        toast('No hay espacio suficiente en el celular');
        break;
      }
      if (err?.message === 'No autorizado') break;
    }
  }
  saving = false;
  setSaveStatus('');
  refreshBadges();
  renderOfflineBox();
  if (failed) toast(`${done} guardadas, ${failed} con error`);
  else if (!silent) toast(done === 1 ? 'Guardada en el celular' : `${done} canciones guardadas en el celular`);
}

async function unsaveSong(id) {
  await Offline.remove(id).catch(() => {});
  refreshBadges();
  renderOfflineBox();
  if (state.offline) {
    // Sin conexión solo se muestran las guardadas: esta ya no puede sonar.
    setSongs(state.songs.filter((x) => x.id !== id));
    if (state.current?.id === id) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      state.current = null;
      syncPlayer();
    }
    render();
  }
  toast('Quitada del celular');
}

async function clearOffline() {
  const ok = await confirmSheet({
    title: LOCAL ? 'Borrar toda la música' : 'Borrar canciones guardadas',
    text: LOCAL ? 'Se borrarán TODAS las canciones y listas de este celular. No se puede deshacer.' : 'Se borrarán las copias que están en el celular. Tu biblioteca en el servidor no se toca.'
  });
  if (!ok) return;
  if (LOCAL) {
    await window.LocalLib.clearAll().catch(() => {});
    setSongs([]);
    state.playlists = [];
    state.baseQueue = [];
    state.queue = [];
    state.index = -1;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.current = null;
    syncPlayer();
    renderSide();
    render();
    return toast('Se borró toda la música');
  }
  await Offline.clear().catch(() => {});
  if (state.offline) {
    setSongs([]);
    audio.pause();
    audio.removeAttribute('src');
    state.current = null;
    syncPlayer();
  }
  refreshBadges();
  renderOfflineBox();
  if (state.offline) render();
  toast('Se borraron las canciones guardadas');
}

// Con "guardar las nuevas solas" activado, al abrir la app se guardan las canciones que falten.
function maybeAutoSave() {
  if (!BUNDLED || LOCAL || state.offline || !Offline.supported || !store.get('autosave', false) || !wifiOk()) return;
  saveSongs(state.songs.map((s) => s.id), { silent: true });
}

function showOfflineBar() {
  let bar = $('#offlineBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offlineBar';
    bar.className = 'offline-bar';
    bar.innerHTML = '<span>Sin conexión con tu servidor. Se muestran solo las canciones guardadas en el celular.</span><button type="button">Reintentar</button>';
    bar.querySelector('button').addEventListener('click', () => location.reload());
    $('.topbar').after(bar);
  }
  bar.hidden = false;
}

async function createPlaylist(songIds = []) {
  const values = await formSheet({ title: 'Nueva lista', fields: [{ name: 'name', label: 'Nombre de la lista', required: true }], submit: 'Crear' });
  if (!values) return null;
  try {
    const p = await api('/playlists', { method: 'POST', body: { name: values.name, songIds } });
    state.playlists.push(p);
    renderSide();
    render();
    toast(`Lista «${p.name}» creada`);
    return p;
  } catch (err) {
    toast(err.message);
    return null;
  }
}

function addToPlaylistSheet(ids) {
  const items = [
    { icon: 'plus', label: 'Nueva lista…', run: () => createPlaylist(ids) },
    ...state.playlists.map((p) => ({
      icon: 'list',
      label: p.name,
      check: ids.every((id) => p.songIds.includes(id)),
      run: async () => {
        try {
          Object.assign(p, await api(`/playlists/${p.id}`, { method: 'PATCH', body: { add: ids } }));
          toast(`Añadida a «${p.name}»`);
          render();
        } catch (err) {
          toast(err.message);
        }
      }
    }))
  ];
  menuSheet('Añadir a una lista', '', items);
}

async function removeFromPlaylist(pid, sid) {
  const p = state.playlists.find((x) => x.id === pid);
  try {
    Object.assign(p, await api(`/playlists/${pid}`, { method: 'PATCH', body: { remove: [sid] } }));
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function renamePlaylist(pid) {
  const p = state.playlists.find((x) => x.id === pid);
  const values = await formSheet({ title: 'Renombrar lista', fields: [{ name: 'name', label: 'Nombre', value: p.name, required: true }] });
  if (!values) return;
  try {
    Object.assign(p, await api(`/playlists/${pid}`, { method: 'PATCH', body: { name: values.name } }));
    renderSide();
    render();
  } catch (err) {
    toast(err.message);
  }
}

async function deletePlaylist(pid) {
  const p = state.playlists.find((x) => x.id === pid);
  const ok = await confirmSheet({ title: 'Eliminar lista', text: `Se eliminará la lista «${p.name}». Tus canciones no se borran.` });
  if (!ok) return;
  try {
    await api(`/playlists/${pid}`, { method: 'DELETE' });
    state.playlists = state.playlists.filter((x) => x.id !== pid);
    go({ name: 'playlists' });
    renderSide();
  } catch (err) {
    toast(err.message);
  }
}

function songMenu(id, ctx) {
  const s = songMap.get(id);
  if (!s) return;
  menuSheet(s.title, artistOf(s), [
    { icon: 'plus', label: 'Añadir a una lista', run: () => addToPlaylistSheet([id]) },
    { icon: 'list', label: 'Añadir a la cola', run: () => addToQueue(id) },
    { icon: 'heart', label: s.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas', run: () => toggleFav(id) },
    ...(ctx?.type === 'playlist' ? [{ icon: 'x', label: 'Quitar de esta lista', run: () => removeFromPlaylist(ctx.id, id) }] : []),
    { icon: 'edit', label: 'Editar información', run: () => editSong(id) },
    ...(BUNDLED && Offline.supported && !LOCAL
      ? [Offline.has(id) ? { icon: 'x', label: 'Quitar del celular', run: () => unsaveSong(id) } : { icon: 'download', label: 'Guardar en el celular', run: () => saveSongs([id]) }]
      : []),
    ...(inApp ? [] : [{ icon: 'download', label: 'Descargar', run: () => downloadSong(id) }]),
    { icon: 'trash', label: 'Eliminar', danger: true, run: () => deleteSong(id) }
  ]);
}

/* =============================== Vistas ================================= */

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function filtered(list) {
  const q = state.query.trim().toLowerCase();
  return q ? list.filter((s) => `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(q)) : list;
}

function sorted(list) {
  const arr = list.slice();
  if (state.sort === 'title') arr.sort((a, b) => collator.compare(a.title, b.title));
  else if (state.sort === 'artist')
    arr.sort((a, b) => collator.compare(a.artist || '￿', b.artist || '￿') || collator.compare(a.album, b.album) || (a.track || 0) - (b.track || 0) || collator.compare(a.title, b.title));
  else arr.sort((a, b) => b.addedAt - a.addedAt);
  return arr;
}

function albumGroups() {
  const map = new Map();
  for (const s of state.songs) {
    const name = s.album || 'Sin álbum';
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, { key, name, songs: [] });
    map.get(key).songs.push(s);
  }
  return [...map.values()]
    .map((a) => {
      a.songs.sort((x, y) => (x.track || 0) - (y.track || 0) || collator.compare(x.title, y.title));
      a.cover = a.songs.find((s) => s.cover) || a.songs[0];
      const artists = new Set(a.songs.map((s) => s.artist).filter(Boolean));
      a.artist = artists.size === 1 ? [...artists][0] : artists.size > 1 ? 'Varios artistas' : '';
      return a;
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

const navKey = (v) => ({ album: 'albums', playlist: 'playlists' })[v.name] || v.name;

function go(view) {
  state.view = view;
  openNowPlaying(false);
  render();
  $('#main').scrollTo({ top: 0 });
}

const cacheLibrary = debounce(() => {
  if (BUNDLED && !LOCAL && !state.offline && state.songs.length) Offline.saveLibrary(state.songs, state.playlists);
}, 800);

function render() {
  cacheLibrary();
  const v = state.view;
  const root = $('#view');
  $$('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === navKey(v)));
  if (!state.songs.length && !['upload', 'playlists'].includes(v.name) && v.name !== 'albums') return renderEmptyLibrary(root);
  switch (v.name) {
    case 'upload': return renderUpload(root);
    case 'albums': return renderAlbums(root);
    case 'playlists': return renderPlaylists(root);
    case 'favorites':
      return renderSongView(root, { title: 'Favoritas', songs: state.songs.filter((s) => s.favorite), sortable: true, emptyIcon: 'heart', emptyTitle: 'Aún no tienes favoritas', emptyText: 'Toca el corazón de una canción para guardarla aquí.' });
    case 'album': {
      const a = albumGroups().find((x) => x.key === v.key);
      if (!a) return go({ name: 'albums' });
      return renderSongView(root, { title: a.name, subtitle: a.artist, songs: a.songs, back: 'albums', hero: a.cover });
    }
    case 'playlist': {
      const p = state.playlists.find((x) => x.id === v.id);
      if (!p) return go({ name: 'playlists' });
      const songs = p.songIds.map((id) => songMap.get(id)).filter(Boolean);
      return renderSongView(root, {
        title: p.name, songs, back: 'playlists', hero: songs.find((s) => s.cover) || songs[0], ctx: { type: 'playlist', id: p.id },
        emptyIcon: 'list', emptyTitle: 'Esta lista está vacía', emptyText: 'Abre el menú ⋮ de cualquier canción y elige «Añadir a una lista».',
        actions: `<button class="icon-btn" data-act="rename-playlist" aria-label="Renombrar lista">${icon('edit')}</button><button class="icon-btn" data-act="delete-playlist" aria-label="Eliminar lista">${icon('trash')}</button>`
      });
    }
    default:
      return renderSongView(root, { title: 'Canciones', songs: state.songs, sortable: true });
  }
}

function renderEmptyLibrary(root) {
  root.innerHTML = `
    <div class="empty">
      <div class="ico">${icon('music')}</div>
      <h2>Tu biblioteca está vacía</h2>
      <p>Sube las canciones que tienes en tu celular o en tu computadora y escúchalas en todos tus dispositivos, sin anuncios.</p>
      <button class="btn primary lg" data-act="go-upload">${icon('upload')} Subir música</button>
    </div>`;
}

function rowHtml(s) {
  return `
    <li class="row${!LOCAL && Offline.has(s.id) ? ' saved' : ''}" data-id="${s.id}">
      <button class="row-main" data-act="play" aria-label="Reproducir ${esc(s.title)}">
        ${coverEl(s, { eq: true })}
        <span class="meta"><span class="t">${esc(s.title)}</span><span class="s">${esc(artistOf(s))}${s.album ? ` · ${esc(s.album)}` : ''}</span></span>
      </button>
      <span class="dur">${fmtTime(s.duration)}</span>
      <button class="icon-btn fav ${s.favorite ? 'on' : ''}" data-act="fav" aria-label="${s.favorite ? 'Quitar de favoritas' : 'Añadir a favoritas'}">${icon('heart', s.favorite ? 'fill' : '')}</button>
      <button class="icon-btn" data-act="more" aria-label="Más opciones">${icon('more')}</button>
    </li>`;
}

function renderSongView(root, { title, subtitle = '', songs, ctx = null, sortable = false, back = null, hero = null, actions = '', emptyIcon = 'music', emptyTitle = '', emptyText = '' }) {
  const shown = sortable ? sorted(filtered(songs)) : filtered(songs);
  state.visible = shown.map((s) => s.id);
  state.ctx = ctx;
  const total = songs.reduce((n, s) => n + (s.duration || 0), 0);
  const sub = [subtitle, plural(songs.length, 'canción', 'canciones'), total ? fmtLong(total) : ''].filter(Boolean).join(' · ');
  const hasSongs = shown.length > 0;
  root.innerHTML = `
    ${back ? `<button class="back" data-act="back" data-to="${back}">${icon('chevron-left')}${back === 'albums' ? 'Álbumes' : 'Listas'}</button>` : ''}
    <div class="head ${hero ? 'has-hero' : ''}">
      ${hero ? `<div class="hero-cover">${coverEl(hero)}</div>` : ''}
      <div class="head-text"><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div>
      <div class="head-actions">
        ${hasSongs ? `<button class="btn primary" data-act="play-all">${icon('play', 'fill')} Reproducir</button><button class="btn" data-act="shuffle-all">${icon('shuffle')} Aleatorio</button>` : ''}
        ${actions}
      </div>
    </div>
    ${sortable && songs.length > 1 ? `<div class="toolbar"><span></span><label class="sort">Ordenar por
      <select id="sortSel" aria-label="Ordenar">
        <option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Recientes</option>
        <option value="title" ${state.sort === 'title' ? 'selected' : ''}>Título</option>
        <option value="artist" ${state.sort === 'artist' ? 'selected' : ''}>Artista</option>
      </select></label></div>` : ''}
    ${hasSongs
      ? `<ul class="list">${shown.map(rowHtml).join('')}</ul>`
      : `<div class="empty"><div class="ico">${icon(state.query ? 'search' : emptyIcon)}</div><h2>${state.query ? 'Sin resultados' : esc(emptyTitle || 'Nada por aquí')}</h2><p>${state.query ? `No encontramos nada para «${esc(state.query)}».` : esc(emptyText)}</p></div>`}`;
  markRows();
}

function renderAlbums(root) {
  const albums = albumGroups().filter((a) => !state.query || filtered(a.songs).length);
  state.visible = [];
  root.innerHTML = `
    <div class="head"><div class="head-text"><h1>Álbumes</h1><p class="sub">${plural(albums.length, 'álbum', 'álbumes')}</p></div></div>
    ${albums.length
      ? `<div class="grid">${albums.map((a) => `
        <button class="card" data-act="open-album" data-key="${esc(a.key)}">
          ${coverEl(a.cover)}
          <span class="meta"><span class="t">${esc(a.name)}</span><span class="s">${esc(a.artist || plural(a.songs.length, 'canción', 'canciones'))}</span></span>
        </button>`).join('')}</div>`
      : `<div class="empty"><div class="ico">${icon('disc')}</div><h2>${state.songs.length ? 'Sin resultados' : 'Aún no hay álbumes'}</h2><p>Los álbumes aparecen automáticamente al subir canciones.</p></div>`}`;
}

function renderPlaylists(root) {
  state.visible = [];
  root.innerHTML = `
    <div class="head"><div class="head-text"><h1>Listas</h1><p class="sub">${plural(state.playlists.length, 'lista', 'listas')}</p></div></div>
    <div class="grid">
      <button class="card new" data-act="new-playlist"><span class="cover">${icon('plus')}</span><span class="meta"><span class="t">Nueva lista</span><span class="s">Organiza tu música</span></span></button>
      ${state.playlists.map((p) => {
        const songs = p.songIds.map((id) => songMap.get(id)).filter(Boolean);
        const cover = songs.find((s) => s.cover) || songs[0];
        return `<button class="card" data-act="open-playlist" data-pid="${p.id}">${cover ? coverEl(cover) : `<span class="cover ph" style="--h:${hueOf(p.name)}">${icon('list')}</span>`}<span class="meta"><span class="t">${esc(p.name)}</span><span class="s">${plural(songs.length, 'canción', 'canciones')}</span></span></button>`;
      }).join('')}
    </div>`;
}

function renderSide() {
  const total = state.songs.reduce((n, s) => n + (s.size || 0), 0);
  $('#sideStats').textContent = state.songs.length ? `${plural(state.songs.length, 'canción', 'canciones')} · ${fmtSize(total)}` : 'Biblioteca vacía';
  $('#logoutBtn').hidden = !state.authRequired;
  $('#sideLists').innerHTML = state.playlists.length
    ? `<h3>Tus listas</h3>${state.playlists.map((p) => `<button data-act="open-playlist" data-pid="${p.id}">${esc(p.name)}</button>`).join('')}`
    : '';
}

/* ---------------------------------- Subida ---------------------------------- */

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav)$/i;

function renderUpload(root) {
  state.visible = [];
  const touch = matchMedia('(hover: none)').matches;
  root.innerHTML = `
    <div class="head"><div class="head-text"><h1>Subir música</h1><p class="sub">${LOCAL ? 'Añade canciones a tu biblioteca. Quedarán guardadas en este celular y suenan sin internet ni computadora.' : 'Añade canciones a tu biblioteca. Quedarán guardadas en tu servidor y disponibles en todos tus dispositivos.'}</p></div></div>
    <div class="drop" id="drop">
      <div class="drop-ico">${icon('upload')}</div>
      <h2>Sube tu música</h2>
      <p>${touch ? 'Elige las canciones que tienes en tu celular. Puedes seleccionar varias a la vez.' : 'Arrastra tus archivos aquí o elige canciones de tu computadora.'}</p>
      <button class="btn primary lg" data-act="pick-files">${icon('plus')} Elegir canciones</button>
      <small>MP3, M4A, AAC, FLAC, OGG, OPUS y WAV${LOCAL ? '' : ` · hasta ${state.maxMb} MB por archivo`}</small>
    </div>
    <div id="uploadList"></div>
    ${inApp || state.authRequired || onThisPc
      ? `<section class="conn">
          <h3>Conexión</h3>
          <p class="muted small">${LOCAL ? 'Modo: solo en este celular (sin servidor)' : `Servidor: ${esc(BUNDLED ? BASE.replace(/^https?:\/\//, '') : location.host)}`}</p>
          ${onThisPc ? `<div id="lanInfo" class="lan" hidden></div>` : ''}
          <div class="conn-actions">
            ${inApp ? `<button class="btn ghost" data-act="change-server">${icon('edit')} ${LOCAL ? 'Conectar con un servidor' : 'Cambiar servidor'}</button>` : ''}
            ${state.authRequired ? `<button class="btn ghost" data-act="logout">${icon('logout')} Cerrar sesión</button>` : ''}
          </div>
        </section>`
      : ''}
    ${BUNDLED && Offline.supported ? '<section class="conn" id="offlineBox"></section>' : ''}`;
  renderUploadList();
  renderOfflineBox();
  if (onThisPc) showLanInfo();
}

// Muestra la dirección que se escribe en el celular para conectarse a esta computadora.
async function showLanInfo() {
  try {
    const { addresses } = await api('/info');
    const box = $('#lanInfo');
    if (!box || !addresses?.length) return;
    box.hidden = false;
    box.innerHTML = `<p class="small"><b>Para conectar tu celular</b> (mismo Wi-Fi), escribe esta dirección en la app:</p>${addresses
      .slice(0, 2)
      .map((a) => `<button class="lan-addr" data-act="copy-addr" data-addr="${esc(a)}" title="Tocar para copiar">${esc(a)}</button>`)
      .join('')}`;
  } catch {
    /* sin información de red */
  }
}

const upStatusText = (u) =>
  ({ wait: 'En cola', up: `${Math.round(u.progress * 100)}%`, proc: 'Procesando…', done: 'Añadida', dup: 'Ya estaba en tu biblioteca', error: u.error || 'Error' })[u.status];
const upIcon = (u) => ({ done: 'check', error: 'alert', dup: 'check' })[u.status] || 'music';

function uploadRowHtml(u) {
  return `<li class="up-row ${u.status}" data-uid="${u.id}">
    <span class="up-ico">${icon(upIcon(u))}</span>
    <span><div class="up-name">${esc(u.name)}</div><div class="up-bar"><i style="width:${Math.round(u.progress * 100)}%"></i></div></span>
    <span class="up-state">${esc(upStatusText(u))} · ${fmtSize(u.file.size)}</span>
  </li>`;
}

function renderUploadList() {
  const el = $('#uploadList');
  if (!el) return;
  const finished = state.uploads.filter((u) => ['done', 'dup', 'error'].includes(u.status)).length;
  el.innerHTML = state.uploads.length
    ? `<div class="uploads-head"><h3>${finished} de ${state.uploads.length} listas</h3>${finished ? `<button class="btn ghost" data-act="clear-uploads">Limpiar</button>` : ''}</div><ul class="uploads">${state.uploads.map(uploadRowHtml).join('')}</ul>`
    : '';
}

const dirty = new Set();
function touchUploadRow(u) {
  if (dirty.has(u.id)) return;
  dirty.add(u.id);
  requestAnimationFrame(() => {
    dirty.delete(u.id);
    const row = $(`[data-uid="${u.id}"]`);
    if (row) row.outerHTML = uploadRowHtml(u);
    else renderUploadList();
  });
}

function enqueueFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  for (const file of files) {
    const u = { id: Math.random().toString(36).slice(2), file, name: file.name, progress: 0, status: 'wait', error: '' };
    if (!AUDIO_EXT.test(file.name)) Object.assign(u, { status: 'error', error: 'Formato no compatible' });
    else if (file.size > state.maxMb * 1048576) Object.assign(u, { status: 'error', error: `Supera ${state.maxMb} MB` });
    state.uploads.push(u);
  }
  if (state.view.name !== 'upload') go({ name: 'upload' });
  else renderUploadList();
  pumpUploads();
}

const MAX_PARALLEL = 3; // canciones que se suben al mismo tiempo
let activeUploads = 0;
let addedInBatch = 0;
function pumpUploads() {
  while (activeUploads < MAX_PARALLEL) {
    const u = state.uploads.find((x) => x.status === 'wait');
    if (!u) break;
    u.status = 'up';
    activeUploads += 1;
    uploadOne(u).then((ok) => {
      activeUploads -= 1;
      if (ok) addedInBatch += 1;
      if (state.uploads.some((x) => x.status === 'wait')) return pumpUploads();
      if (activeUploads === 0) {
        if (addedInBatch) {
          toast(addedInBatch === 1 ? '1 canción añadida' : `${addedInBatch} canciones añadidas`);
          renderSide();
        }
        addedInBatch = 0;
      }
    });
  }
}

function uploadOne(u) {
  return new Promise((resolve) => {
    u.status = 'up';
    touchUploadRow(u);
    if (LOCAL) {
      // Sin servidor: la canción se guarda directo dentro del celular.
      u.status = 'proc';
      touchUploadRow(u);
      window.LocalLib.addFile(u.file).then(
        ({ song, duplicate }) => {
          u.progress = 1;
          if (duplicate) u.status = 'dup';
          else {
            u.status = 'done';
            setSongs([song, ...state.songs]);
          }
          touchUploadRow(u);
          resolve(!duplicate);
        },
        (err) => {
          Object.assign(u, { status: 'error', error: err?.name === 'QuotaExceededError' ? 'No hay espacio en el celular' : err?.message || 'No se pudo guardar' });
          touchUploadRow(u);
          resolve(false);
        }
      );
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/api/upload`);
    if (BUNDLED && TOKEN) xhr.setRequestHeader('Authorization', `Bearer ${TOKEN}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      u.progress = e.loaded / e.total;
      if (e.loaded >= e.total) u.status = 'proc';
      touchUploadRow(u);
    };
    const fail = (msg) => {
      Object.assign(u, { status: 'error', error: msg });
      touchUploadRow(u);
      resolve(false);
    };
    xhr.onerror = () => fail('Sin conexión con el servidor');
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* respuesta no válida */
      }
      if (xhr.status === 401) {
        showLogin();
        return fail('Sesión expirada');
      }
      if (xhr.status >= 400) return fail(body.error || 'No se pudo subir');
      const item = body.results?.[0];
      if (!item) return fail('Respuesta inesperada');
      if (item.error) return fail(item.error);
      u.progress = 1;
      if (item.duplicate) u.status = 'dup';
      else {
        u.status = 'done';
        setSongs([item.song, ...state.songs]);
      }
      touchUploadRow(u);
      resolve(!item.duplicate);
    };
    const form = new FormData();
    form.append('files', u.file, u.name);
    xhr.send(form);
  });
}

/* ============================ Eventos de la interfaz ==================== */

$('#view').addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const id = t.closest('[data-id]')?.dataset.id;
  switch (t.dataset.act) {
    case 'play':
      if (state.current?.id === id) togglePlay();
      else startPlayback(state.visible, id);
      break;
    case 'fav': toggleFav(id); break;
    case 'more': songMenu(id, state.ctx); break;
    case 'play-all': startPlayback(state.visible, null); break;
    case 'shuffle-all': startPlayback(state.visible, null, { forceShuffle: true }); break;
    case 'back': go({ name: t.dataset.to }); break;
    case 'open-album': go({ name: 'album', key: t.dataset.key }); break;
    case 'open-playlist': go({ name: 'playlist', id: t.dataset.pid }); break;
    case 'new-playlist': createPlaylist(); break;
    case 'rename-playlist': renamePlaylist(state.view.id); break;
    case 'delete-playlist': deletePlaylist(state.view.id); break;
    case 'go-upload': go({ name: 'upload' }); break;
    case 'change-server': location.href = BUNDLED ? '../index.html?cambiar=1' : 'http://localhost/?cambiar=1'; break;
    case 'reload': location.reload(); break;
    case 'save-all': saveSongs(state.songs.map((x) => x.id)); break;
    case 'clear-offline': clearOffline(); break;
    case 'toggle-autosave':
      store.set('autosave', !store.get('autosave', false));
      renderOfflineBox();
      if (store.get('autosave', false)) maybeAutoSave();
      break;
    case 'logout': logout(); break;
    case 'copy-addr':
      navigator.clipboard?.writeText(t.dataset.addr).then(() => toast('Dirección copiada'), () => toast(t.dataset.addr));
      break;
    case 'pick-files': $('#filePicker').click(); break;
    case 'clear-uploads':
      state.uploads = state.uploads.filter((u) => ['wait', 'up', 'proc'].includes(u.status));
      renderUploadList();
      break;
  }
  if (state.view.name === 'songs' || state.view.name === 'favorites') markRows();
});
$('#view').addEventListener('change', (e) => {
  if (e.target.id !== 'sortSel') return;
  state.sort = e.target.value;
  store.set('sort', state.sort);
  render();
});

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) go({ name: nav.dataset.nav });
  const side = e.target.closest('#sideLists [data-act="open-playlist"]');
  if (side) go({ name: 'playlist', id: side.dataset.pid });
});
async function logout() {
  await fetch(`${BASE}/api/logout`, authInit({ method: 'POST', credentials: 'same-origin' })).catch(() => {});
  if (BUNDLED) setToken('');
  audio.pause();
  location.reload();
}
$('#logoutBtn').addEventListener('click', logout);

$('#q').addEventListener(
  'input',
  debounce((e) => {
    state.query = e.target.value;
    if (!['songs', 'favorites', 'album', 'playlist', 'albums'].includes(state.view.name)) state.view = { name: 'songs' };
    render();
  }, 120)
);

$('#filePicker').addEventListener('change', (e) => {
  enqueueFiles(e.target.files);
  e.target.value = '';
});

/* Arrastrar y soltar (computadora) */
let dragDepth = 0;
const veil = $('#dropVeil');
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || $('#app').hidden) return;
  dragDepth += 1;
  veil.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) veil.hidden = true;
});
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  if (!$('#app').hidden) enqueueFiles(e.dataTransfer.files);
});

/* ================================ Arranque ============================== */

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  audio.pause();
  setTimeout(() => $('#loginPass').focus(), 50);
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#loginError');
  err.hidden = true;
  try {
    const res = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#loginPass').value })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo entrar');
    if (BUNDLED) setToken(data.token || '');
    $('#loginPass').value = '';
    await start();
  } catch (error) {
    err.textContent = error.message;
    err.hidden = false;
  }
});

function showFatal(message) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#view').innerHTML = `<div class="empty"><div class="ico">${icon('alert')}</div><h2>No hay conexión</h2><p>${esc(message)}</p><div class="conn-actions" style="justify-content:center"><button class="btn primary" data-act="reload">Reintentar</button>${BUNDLED ? `<button class="btn ghost" data-act="change-server">Cambiar servidor</button>` : ''}</div></div>`;
}

// Abre la app sin servidor con la copia de la biblioteca: solo canciones ya guardadas en el celular.
async function startOffline() {
  if (!BUNDLED || !Offline.supported) return false;
  await Offline.ready;
  const lib = await Offline.loadLibrary();
  const saved = (lib?.songs || []).filter((s) => Offline.has(s.id));
  if (!saved.length) return false;
  state.offline = true;
  setSongs(saved);
  const have = new Set(saved.map((s) => s.id));
  state.playlists = (lib.playlists || []).map((p) => ({ ...p, songIds: (p.songIds || []).filter((id) => have.has(id)) })).filter((p) => p.songIds.length);
  $('#login').hidden = true;
  $('#app').hidden = false;
  showOfflineBar();
  return true;
}

function finishStart() {
  syncPlayer();
  restoreLast();
  renderSide();
  render();
  maybeAutoSave();
}

async function start() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  try {
    const [songs, playlists] = await Promise.all([api('/songs'), api('/playlists')]);
    state.offline = false;
    $('#offlineBar')?.setAttribute('hidden', '');
    setSongs(songs);
    state.playlists = playlists;
    if (BUNDLED) Offline.saveLibrary(songs, playlists);
  } catch (err) {
    if (err.message === 'No autorizado') return;
    if (!(await startOffline())) showFatal('No se pudo cargar tu biblioteca. Revisa que el servidor de Sonora esté encendido y que tengas internet.');
    else finishStart();
    return;
  }
  finishStart();
}

// La app funciona sola en el celular: no hay servidor, todo está guardado dentro del teléfono.
async function startLocal() {
  if (!Offline.supported) return showFatal('Este dispositivo no permite guardar música dentro de la app.');
  await window.LocalLib.init();
  state.authRequired = false;
  state.maxMb = 2000;
  setSongs([...window.LocalLib.songs()]);
  state.playlists = [...window.LocalLib.playlists()];
  $('#login').hidden = true;
  $('#app').hidden = false;
  finishStart();
}

async function boot() {
  initMediaSession();
  syncPlayer();
  if (BUNDLED) {
    await Offline.ready;
    if (LOCAL) return startLocal();
    if (!BASE) return void (location.href = '../index.html?cambiar=1'); // todavía no se eligió servidor
  }
  let session;
  try {
    session = await (await fetch(`${BASE}/api/session`, authInit({ credentials: 'same-origin' }))).json();
  } catch {
    if (await startOffline()) return finishStart();
    return showFatal('No se pudo conectar con tu servidor Sonora. Revisa que esté encendido y que tengas internet o estés en la misma red.');
  }
  state.authRequired = session.authRequired;
  state.maxMb = session.maxMb || 300;
  if (session.authRequired && !session.authed) return showLogin();
  await start();
}

if ('serviceWorker' in navigator && !BUNDLED) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
