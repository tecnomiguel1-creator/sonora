// Sonora en el celular, sin servidor: la biblioteca (canciones, listas y favoritas) vive en el propio teléfono.
// Las canciones y carátulas se guardan con `window.Offline` (IndexedDB); aquí se guarda la lista y se leen las
// etiquetas de cada archivo. Archivo normal (no módulo): deja `window.LocalLib`.
(function () {
  'use strict';

  const lib = { songs: [], playlists: [] };
  const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const persist = () => window.Offline.saveMeta('locallib', { songs: lib.songs, playlists: lib.playlists });
  const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

  /* ------------------------------ Lectura de etiquetas ---------------------------- */

  const readBytes = async (file, start, len) => new Uint8Array(await file.slice(start, start + len).arrayBuffer());
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ascii = (b, o, n) => String.fromCharCode(...b.slice(o, o + n));

  function decodeText(b, enc) {
    // enc: 0 = latin1, 1 = UTF-16 con BOM, 2 = UTF-16 BE, 3 = UTF-8
    try {
      const label = enc === 1 ? (b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : 'utf-16be') : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'windows-1252';
      const start = enc === 1 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) ? 2 : 0;
      return new TextDecoder(label).decode(b.slice(start)).replace(/\0+$/, '').trim();
    } catch {
      return '';
    }
  }

  async function readId3(file) {
    const head = await readBytes(file, 0, 10);
    if (ascii(head, 0, 3) !== 'ID3') return {};
    const ver = head[3];
    const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    if (ver < 3 || size <= 0 || size > 30 * 1048576) return {};
    const tag = await readBytes(file, 10, size);
    const out = {};
    let o = 0;
    while (o + 10 <= tag.length) {
      const id = ascii(tag, o, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fsize = ver === 4 ? ((tag[o + 4] & 0x7f) << 21) | ((tag[o + 5] & 0x7f) << 14) | ((tag[o + 6] & 0x7f) << 7) | (tag[o + 7] & 0x7f) : u32(tag, o + 4);
      const body = tag.subarray(o + 10, o + 10 + fsize);
      if (fsize <= 0 || o + 10 + fsize > tag.length) break;
      if (id === 'TIT2') out.title = decodeText(body.subarray(1), body[0]);
      else if (id === 'TPE1') out.artist = decodeText(body.subarray(1), body[0]);
      else if (id === 'TALB') out.album = decodeText(body.subarray(1), body[0]);
      else if (id === 'TRCK') out.track = parseInt(decodeText(body.subarray(1), body[0]), 10) || 0;
      else if (id === 'APIC' && !out.cover) {
        const enc = body[0];
        let p = 1;
        let mime = '';
        while (p < body.length && body[p] !== 0) mime += String.fromCharCode(body[p++]);
        p += 1; // fin del tipo
        p += 1; // tipo de imagen
        // descripción: termina en 0 (o 0 0 si es UTF-16)
        if (enc === 1 || enc === 2) while (p + 1 < body.length && !(body[p] === 0 && body[p + 1] === 0)) p += 2;
        else while (p < body.length && body[p] !== 0) p++;
        p += enc === 1 || enc === 2 ? 2 : 1;
        const data = body.slice(p);
        if (data.length > 100) out.cover = new Blob([data], { type: /^image\//.test(mime) ? mime : data[0] === 0x89 ? 'image/png' : 'image/jpeg' });
      }
      o += 10 + fsize;
    }
    return out;
  }

  // M4A/AAC (etiquetas de iTunes): busca moov > udta > meta > ilst.
  async function readMp4(file) {
    const out = {};
    let off = 0;
    let moov = null;
    while (off + 8 <= file.size) {
      const h = await readBytes(file, off, 16);
      let size = u32(h, 0);
      const type = ascii(h, 4, 4);
      let hdr = 8;
      if (size === 1) {
        size = u32(h, 12); // los 4 bytes bajos bastan
        hdr = 16;
      } else if (size === 0) size = file.size - off;
      if (size < hdr) break;
      if (type === 'moov') {
        if (size > 40 * 1048576) return out;
        moov = await readBytes(file, off + hdr, size - hdr);
        break;
      }
      off += size;
    }
    if (!moov) return out;
    const children = (buf, start, end) => {
      const list = [];
      let p = start;
      while (p + 8 <= end) {
        const s = u32(buf, p);
        if (s < 8 || p + s > end) break;
        list.push({ type: ascii(buf, p + 4, 4), start: p + 8, end: p + s });
        p += s;
      }
      return list;
    };
    const find = (buf, node, type) => children(buf, node.start, node.end).find((c) => c.type === type);
    const udta = find(moov, { start: 0, end: moov.length }, 'udta');
    const meta = udta && find(moov, udta, 'meta');
    const ilst = meta && find(moov, { start: meta.start + 4, end: meta.end }, 'ilst');
    if (!ilst) return out;
    for (const item of children(moov, ilst.start, ilst.end)) {
      const data = children(moov, item.start, item.end).find((c) => c.type === 'data');
      if (!data) continue;
      const bytes = moov.subarray(data.start + 8, data.end);
      if (item.type === '©nam') out.title = new TextDecoder().decode(bytes).trim();
      else if (item.type === '©ART') out.artist = new TextDecoder().decode(bytes).trim();
      else if (item.type === '©alb') out.album = new TextDecoder().decode(bytes).trim();
      else if (item.type === 'covr' && bytes.length > 100) out.cover = new Blob([bytes.slice()], { type: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg' });
    }
    return out;
  }

  async function readTags(file) {
    try {
      const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
      if (ext === 'mp3') return await readId3(file);
      if (ext === 'm4a' || ext === 'aac') return await readMp4(file);
    } catch (err) {
      console.warn('No se pudieron leer las etiquetas:', err);
    }
    return {};
  }

  function durationOf(file) {
    return new Promise((resolve) => {
      const a = new Audio();
      const url = URL.createObjectURL(file);
      const done = (d) => {
        clearTimeout(t);
        a.removeAttribute('src');
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : 0);
      };
      const t = setTimeout(() => done(0), 8000);
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(a.duration);
      a.onerror = () => done(0);
      a.src = url;
    });
  }

  // Huella rápida para detectar repetidas: tamaño + inicio y final del archivo.
  async function fingerprint(file) {
    const part = 262144;
    const a = await file.slice(0, part).arrayBuffer();
    const b = file.size > part ? await file.slice(Math.max(part, file.size - part)).arrayBuffer() : new ArrayBuffer(0);
    const all = new Uint8Array(a.byteLength + b.byteLength + 8);
    all.set(new Uint8Array(a), 0);
    all.set(new Uint8Array(b), a.byteLength);
    new DataView(all.buffer).setFloat64(a.byteLength + b.byteLength, file.size);
    try {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
      return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch {
      return `${file.size}-${file.name}`;
    }
  }

  const fromName = (name) => {
    const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
  };

  /* ---------------------------------- Biblioteca ---------------------------------- */

  const pending = new Map();
  async function addNew(file, hash) {
    const dup = lib.songs.find((s) => s.hash === hash);
    if (dup) return { duplicate: true, song: dup };
    const [tags, duration] = await Promise.all([readTags(file), durationOf(file)]);
    if (!(duration > 0)) throw new Error('El archivo no parece ser audio válido');
    const guess = fromName(file.name);
    const id = newId();
    const song = {
      id,
      hash,
      title: (tags.title || guess.title || 'Sin título').slice(0, 200),
      artist: (tags.artist || guess.artist || '').slice(0, 200),
      album: (tags.album || '').slice(0, 200),
      track: tags.track || 0,
      duration,
      size: file.size,
      ext: `.${(file.name.match(/\.([^.]+)$/) || [, 'mp3'])[1].toLowerCase()}`,
      cover: tags.cover ? 'local' : null,
      favorite: false,
      addedAt: Date.now()
    };
    await window.Offline.save(id, file, tags.cover || null); // puede fallar por falta de espacio
    lib.songs.unshift(song);
    await persist();
    return { song };
  }

  const api = {
    async init(migrate = false) {
      await window.Offline.ready;
      // La biblioteca del modo "solo celular" tiene su propio lugar. Si no existe aún, se aprovecha la versión anterior.
      const saved = (await window.Offline.loadMeta('locallib')) || (migrate ? await window.Offline.loadLibrary() : null);
      const have = new Set(window.Offline.ids());
      lib.songs = (saved?.songs || []).filter((s) => have.has(s.id));
      const ids = new Set(lib.songs.map((s) => s.id));
      lib.playlists = (saved?.playlists || []).map((p) => ({ ...p, songIds: (p.songIds || []).filter((id) => ids.has(id)) }));
      window.Offline.persist?.();
    },
    songs: () => lib.songs,
    get: (id) => lib.songs.find((s) => s.id === id),
    count: () => lib.songs.length,
    // Quita una canción de la biblioteca del celular (por ejemplo, después de enviarla al servidor).
    async discard(id, { keepFiles = false } = {}) {
      lib.songs = lib.songs.filter((s) => s.id !== id);
      for (const p of lib.playlists) p.songIds = p.songIds.filter((x) => x !== id);
      if (!keepFiles) await window.Offline.remove(id).catch(() => {});
      await persist();
    },
    playlists: () => lib.playlists,

    async addFile(file) {
      const hash = await fingerprint(file);
      // Si hay otra copia idéntica procesándose ahora mismo, se espera a que termine para detectarla como repetida.
      const prev = pending.get(hash);
      const job = (prev ? prev.catch(() => {}) : Promise.resolve()).then(() => addNew(file, hash));
      pending.set(hash, job);
      try {
        return await job;
      } finally {
        if (pending.get(hash) === job) pending.delete(hash);
      }
    },
    async clearAll() {
      await window.Offline.clear();
      lib.songs.length = 0;
      lib.playlists.length = 0;
      await persist();
    },

    // Imita las rutas del servidor para que el resto de la app no note la diferencia.
    async request(path, { method = 'GET', body } = {}) {
      const song = (id) => lib.songs.find((s) => s.id === id);
      const list = (id) => lib.playlists.find((p) => p.id === id);
      let m;
      if (path === '/songs' && method === 'GET') return lib.songs;
      if (path === '/playlists' && method === 'GET') return lib.playlists;
      if (path === '/info') return { addresses: [] };

      if ((m = path.match(/^\/songs\/([a-f0-9]+)$/))) {
        const s = song(m[1]);
        if (!s) throw new Error('Canción no encontrada');
        if (method === 'PATCH') {
          const { title, artist, album, favorite } = body || {};
          const t = clean(title);
          if (t !== undefined) {
            if (!t) throw new Error('El título no puede estar vacío');
            s.title = t;
          }
          const a = clean(artist);
          if (a !== undefined) s.artist = a;
          const al = clean(album);
          if (al !== undefined) s.album = al;
          if (typeof favorite === 'boolean') s.favorite = favorite;
          await persist();
          return s;
        }
        if (method === 'DELETE') {
          lib.songs = lib.songs.filter((x) => x.id !== s.id);
          for (const p of lib.playlists) p.songIds = p.songIds.filter((id) => id !== s.id);
          await window.Offline.remove(s.id).catch(() => {});
          await persist();
          return { ok: true };
        }
      }
      if (path === '/playlists' && method === 'POST') {
        const name = clean(body?.name, 100);
        if (!name) throw new Error('Escribe un nombre para la lista');
        const p = { id: newId(), name, songIds: [...new Set((body?.songIds || []).filter((id) => song(id)))], createdAt: Date.now() };
        lib.playlists.push(p);
        await persist();
        return p;
      }
      if ((m = path.match(/^\/playlists\/([a-f0-9]+)$/))) {
        const p = list(m[1]);
        if (!p) throw new Error('Lista no encontrada');
        if (method === 'PATCH') {
          const n = clean(body?.name, 100);
          if (n !== undefined) {
            if (!n) throw new Error('El nombre no puede estar vacío');
            p.name = n;
          }
          if (Array.isArray(body?.add)) for (const id of body.add) if (song(id) && !p.songIds.includes(id)) p.songIds.push(id);
          if (Array.isArray(body?.remove)) p.songIds = p.songIds.filter((id) => !body.remove.includes(id));
          await persist();
          return p;
        }
        if (method === 'DELETE') {
          lib.playlists = lib.playlists.filter((x) => x.id !== p.id);
          await persist();
          return { ok: true };
        }
      }
      throw new Error('No encontrado');
    }
  };

  window.LocalLib = api;
})();
