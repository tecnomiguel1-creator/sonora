// Sonora sin conexión: guarda canciones (y sus carátulas) dentro del celular, en IndexedDB,
// y una copia de la lista de la biblioteca para poder abrir la app aunque el servidor esté apagado.
// Es un archivo normal (no módulo): se carga antes de app.js y deja `window.Offline`.
(function () {
  'use strict';

  const DB_NAME = 'sonora-offline';
  const index = new Map(); // id -> { size, savedAt }
  const audioUrls = new Map(); // id -> blob: URL (se crea al reproducir)
  const coverUrls = new Map(); // id -> blob: URL (se crean al abrir, son pequeñas)
  let db = null;

  const api = {
    supported: !!window.indexedDB,
    ready: null,
    has: (id) => index.has(id),
    count: () => index.size,
    bytes: () => [...index.values()].reduce((n, v) => n + (v.size || 0), 0),
    ids: () => [...index.keys()],
    urlSync: (id) => audioUrls.get(id) || null,
    coverUrl: (id) => coverUrls.get(id) || null
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('audio');
        d.createObjectStore('covers');
        d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Ejecuta `fn(transaction)` y resuelve con el resultado de la petición que devuelva.
  function run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      const req = fn(tx);
      if (req) req.onsuccess = () => (result = req.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Almacenamiento no disponible'));
    });
  }

  const saveIndex = () => run('meta', 'readwrite', (tx) => tx.objectStore('meta').put(Object.fromEntries(index), 'index'));

  function setCoverUrl(id, blob) {
    const old = coverUrls.get(id);
    if (old) URL.revokeObjectURL(old);
    if (blob) coverUrls.set(id, URL.createObjectURL(blob));
    else coverUrls.delete(id);
  }

  async function init() {
    if (!api.supported) return;
    try {
      db = await openDb();
      const saved = await run('meta', 'readonly', (tx) => tx.objectStore('meta').get('index'));
      for (const [id, v] of Object.entries(saved || {})) index.set(id, v);
      // Las carátulas son pequeñas: se dejan listas para mostrarlas al instante, incluso sin conexión.
      await new Promise((resolve) => {
        const tx = db.transaction('covers', 'readonly');
        const cur = tx.objectStore('covers').openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          if (index.has(c.key)) setCoverUrl(c.key, c.value);
          c.continue();
        };
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      });
    } catch (err) {
      console.warn('Sin almacenamiento local:', err);
      api.supported = false;
      db = null;
    }
  }

  api.save = async function (id, audioBlob, coverBlob) {
    if (!db) throw new Error('Este dispositivo no permite guardar música sin conexión.');
    await run(['audio', 'covers'], 'readwrite', (tx) => {
      tx.objectStore('audio').put(audioBlob, id);
      if (coverBlob) tx.objectStore('covers').put(coverBlob, id);
    });
    index.set(id, { size: audioBlob.size + (coverBlob ? coverBlob.size : 0), savedAt: Date.now() });
    if (coverBlob) setCoverUrl(id, coverBlob);
    await saveIndex();
  };

  api.audioUrl = async function (id) {
    if (audioUrls.has(id)) return audioUrls.get(id);
    if (!db || !index.has(id)) return null;
    const blob = await run('audio', 'readonly', (tx) => tx.objectStore('audio').get(id));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    audioUrls.set(id, url);
    return url;
  };

  api.remove = async function (id) {
    if (!db || !index.has(id)) return;
    await run(['audio', 'covers'], 'readwrite', (tx) => {
      tx.objectStore('audio').delete(id);
      tx.objectStore('covers').delete(id);
    });
    const url = audioUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    audioUrls.delete(id);
    setCoverUrl(id, null);
    index.delete(id);
    await saveIndex();
  };

  api.clear = async function () {
    if (!db) return;
    await run(['audio', 'covers'], 'readwrite', (tx) => {
      tx.objectStore('audio').clear();
      tx.objectStore('covers').clear();
    });
    for (const u of audioUrls.values()) URL.revokeObjectURL(u);
    audioUrls.clear();
    for (const id of [...coverUrls.keys()]) setCoverUrl(id, null);
    index.clear();
    await saveIndex();
  };

  // Copia de la lista de la biblioteca (canciones y listas) para abrir la app sin servidor.
  api.saveLibrary = (songs, playlists) =>
    db ? run('meta', 'readwrite', (tx) => tx.objectStore('meta').put({ songs, playlists, savedAt: Date.now() }, 'library')).catch(() => {}) : Promise.resolve();
  api.loadLibrary = () => (db ? run('meta', 'readonly', (tx) => tx.objectStore('meta').get('library')).catch(() => null) : Promise.resolve(null));

  // Pide al sistema que no borre estos datos por falta de espacio.
  api.persist = () => {
    try {
      return navigator.storage?.persist?.();
    } catch {
      return undefined;
    }
  };

  api.ready = init();
  window.Offline = api;
})();
