// Sonora · servidor de música personal
// Guarda tus canciones, lee sus datos (título, artista, carátula) y las sirve
// por streaming a cualquier dispositivo. Sin anuncios, sin rastreo.

import express from 'express';
import multer from 'multer';
import { parseFile, selectCover } from 'music-metadata';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/* ------------------------------ Configuración ----------------------------- */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.SONORA_PASSWORD || '';
const MAX_MB = Number(process.env.SONORA_MAX_MB) || 300;
// En un servidor público (nube) la contraseña es obligatoria: sin ella cualquiera podría ver o borrar tu música.
if (!PASSWORD && (process.env.RENDER || process.env.SONORA_REQUIRE_PASSWORD)) {
  console.error('\n  Falta la contraseña: define la variable SONORA_PASSWORD antes de publicar Sonora en internet.\n');
  process.exit(1);
}
const DATA_DIR = path.resolve(process.env.SONORA_DATA || path.join(__dirname, 'data'));
const MUSIC_DIR = path.join(DATA_DIR, 'music');
const COVER_DIR = path.join(DATA_DIR, 'covers');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const DB_FILE = path.join(DATA_DIR, 'library.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const PUBLIC_DIR = process.env.SONORA_PUBLIC ? path.resolve(process.env.SONORA_PUBLIC) : path.join(__dirname, 'public');

for (const dir of [MUSIC_DIR, COVER_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(TMP_DIR)) fs.rmSync(path.join(TMP_DIR, f), { force: true });

const AUDIO_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.weba': 'audio/webm'
};
const COVER_TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

/* ------------------------------ Base de datos ----------------------------- */
// Un único archivo JSON (data/library.json). Suficiente para bibliotecas personales.

let db = { songs: [], playlists: [] };
try {
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.songs = Array.isArray(raw.songs) ? raw.songs : [];
  db.playlists = Array.isArray(raw.playlists) ? raw.playlists : [];
} catch {
  /* primera ejecución */
}

let saving = Promise.resolve();
function saveDb() {
  saving = saving
    .then(async () => {
      const tmp = `${DB_FILE}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(db));
      await fsp.rename(tmp, DB_FILE);
    })
    .catch((err) => console.error('No se pudo guardar la biblioteca:', err));
  return saving;
}

const newId = () => crypto.randomBytes(6).toString('hex');
const findSong = (id) => (/^[a-f0-9]{12}$/.test(id) ? db.songs.find((s) => s.id === id) : undefined);
const findPlaylist = (id) => db.playlists.find((p) => p.id === id);

const publicSong = (s) => ({
  id: s.id,
  title: s.title,
  artist: s.artist,
  album: s.album,
  track: s.track || 0,
  duration: s.duration,
  size: s.size,
  ext: s.ext,
  cover: s.cover || null,
  favorite: !!s.favorite,
  addedAt: s.addedAt
});

/* ------------------------------ Autenticación ----------------------------- */
// Opcional: si defines SONORA_PASSWORD, todo requiere iniciar sesión.

let secret;
try {
  secret = fs.readFileSync(SECRET_FILE, 'utf8');
} catch {
  secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
}
const tokenFor = (password) => crypto.createHmac('sha256', secret).update(password).digest('hex');
const AUTH_TOKEN = PASSWORD ? tokenFor(PASSWORD) : '';

const safeEqual = (a, b) => {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}
// La sesión llega por cookie (navegador / app de escritorio) o por token (app del celular, que
// tiene su propia pantalla y habla con el servidor desde otro origen): cabecera Authorization o ?t=.
function tokenFromRequest(req) {
  const h = req.headers.authorization || '';
  if (/^Bearer /i.test(h)) return h.slice(7).trim();
  return typeof req.query?.t === 'string' ? req.query.t : '';
}
const isAuthed = (req) =>
  !PASSWORD || safeEqual(getCookie(req, 'sonora_auth'), AUTH_TOKEN) || safeEqual(tokenFromRequest(req), AUTH_TOKEN);

const loginAttempts = new Map();
const tooManyAttempts = (ip) => {
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  loginAttempts.set(ip, recent);
  return recent.length >= 10;
};

/* ---------------------------------- App ----------------------------------- */

const app = express();
app.disable('x-powered-by');
if (process.env.SONORA_TRUST_PROXY || process.env.RENDER) app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
  );
  next();
});
// CORS: la app del celular lleva su pantalla dentro (origen http://localhost) y consulta a este servidor.
// Solo se aceptan esos orígenes (más los que pongas en SONORA_CORS_ORIGINS, separados por comas).
const CORS_ORIGINS = new Set(
  ['http://localhost', 'https://localhost', 'capacitor://localhost', ...(process.env.SONORA_CORS_ORIGINS || '').split(',')]
    .map((o) => o.trim())
    .filter(Boolean)
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  next();
});
app.use(express.json({ limit: '100kb' }));

app.get('/api/session', (req, res) => {
  res.json({ authRequired: !!PASSWORD, authed: isAuthed(req), maxMb: MAX_MB });
});

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  const given = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(tokenFor(given), AUTH_TOKEN)) {
    loginAttempts.get(req.ip).push(Date.now());
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sonora_auth=${AUTH_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
  res.json({ ok: true, token: AUTH_TOKEN });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sonora_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// La app del celular lleva una copia de la pantalla, pero al abrirse con conexión baja de aquí la versión
// más reciente (así los cambios de diseño llegan sin reinstalar el APK).
const UI_FILES = ['index.html', 'styles.css', 'offline.js', 'audio-fx.js', 'app.js'];
let uiCache = { key: '', body: null };
app.get('/ui-bundle.json', (req, res) => {
  try {
    const key = UI_FILES.map((f) => fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs).join(',');
    if (uiCache.key !== key) {
      const files = {};
      const hash = crypto.createHash('sha1');
      for (const f of UI_FILES) {
        files[f] = fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');
        hash.update(f).update(files[f]);
      }
      uiCache = { key, body: { version: hash.digest('hex').slice(0, 12), files } };
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.json(uiCache.body);
  } catch {
    res.status(500).json({ error: 'No disponible' });
  }
});

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res, file) {
      if (/\.(html|js|css|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
    }
  })
);

// Todo lo que sigue requiere sesión (si hay contraseña).
app.use('/api', (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'No autorizado' })));

// Direcciones de esta computadora en la red local (para conectar el celular).
// Las de casa (192.168.x.x, 10.x.x.x) van primero; las de VPN (100.x.x.x) al final.
function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  }
  const rank = (ip) => (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(ip) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

app.get('/api/info', (req, res) => {
  res.json({ port: PORT, addresses: lanAddresses().map((ip) => `${ip}:${PORT}`) });
});

/* --------------------------------- Canciones ------------------------------- */

app.get('/api/songs', (req, res) => res.json(db.songs.map(publicSong)));

app.get('/api/songs/:id/stream', (req, res) => {
  const song = findSong(req.params.id);
  if (!song) return res.status(404).json({ error: 'Canción no encontrada' });
  res.type(song.mime);
  res.sendFile(path.join(MUSIC_DIR, song.file), { acceptRanges: true, headers: { 'Cache-Control': 'private, max-age=3600' } }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

app.get('/api/songs/:id/cover', (req, res) => {
  const song = findSong(req.params.id);
  if (!song?.cover) return res.status(404).end();
  const ext = path.extname(song.cover);
  res.type(COVER_TYPES[ext] || 'image/jpeg');
  res.sendFile(path.join(COVER_DIR, song.cover), { headers: { 'Cache-Control': 'private, max-age=31536000, immutable' } }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

app.get('/api/songs/:id/download', (req, res) => {
  const song = findSong(req.params.id);
  if (!song) return res.status(404).json({ error: 'Canción no encontrada' });
  const base = `${song.artist ? `${song.artist} - ` : ''}${song.title}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
  res.download(path.join(MUSIC_DIR, song.file), `${base}${song.ext}`);
});

const clean = (value, max = 200) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : undefined;

app.patch('/api/songs/:id', (req, res) => {
  const song = findSong(req.params.id);
  if (!song) return res.status(404).json({ error: 'Canción no encontrada' });
  const { title, artist, album, favorite } = req.body || {};
  const t = clean(title);
  if (t !== undefined) {
    if (!t) return res.status(400).json({ error: 'El título no puede estar vacío' });
    song.title = t;
  }
  const a = clean(artist);
  if (a !== undefined) song.artist = a;
  const al = clean(album);
  if (al !== undefined) song.album = al;
  if (typeof favorite === 'boolean') song.favorite = favorite;
  saveDb();
  res.json(publicSong(song));
});

app.delete('/api/songs/:id', async (req, res) => {
  const song = findSong(req.params.id);
  if (!song) return res.status(404).json({ error: 'Canción no encontrada' });
  db.songs = db.songs.filter((s) => s.id !== song.id);
  for (const p of db.playlists) p.songIds = p.songIds.filter((id) => id !== song.id);
  saveDb();
  await fsp.rm(path.join(MUSIC_DIR, song.file), { force: true });
  if (song.cover && !db.songs.some((s) => s.cover === song.cover)) {
    await fsp.rm(path.join(COVER_DIR, song.cover), { force: true });
  }
  res.json({ ok: true });
});

/* ----------------------------------- Subida -------------------------------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 50 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (AUDIO_TYPES[ext]) return cb(null, true);
    cb(Object.assign(new Error('Formato no compatible (usa MP3, M4A, AAC, FLAC, OGG, OPUS o WAV)'), { code: 'BAD_TYPE' }));
  }
});

// Los navegadores envían el nombre en UTF-8 pero multer lo lee como latin1.
function fixName(name) {
  if ([...name].some((c) => c.charCodeAt(0) > 255)) return name;
  const fixed = Buffer.from(name, 'latin1').toString('utf8');
  return fixed.includes('�') ? name : fixed;
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// Canciones que se están procesando ahora mismo: evita duplicados cuando se suben varias a la vez.
const inFlight = new Map();

async function ingest(file) {
  const originalName = fixName(file.originalname);
  const hash = await sha1File(file.path);
  const prev = inFlight.get(hash);
  if (prev) await prev.catch(() => {});
  const job = ingestOne(file, originalName, hash);
  inFlight.set(hash, job);
  try {
    return await job;
  } finally {
    if (inFlight.get(hash) === job) inFlight.delete(hash);
  }
}

async function ingestOne(file, originalName, hash) {
  const ext = path.extname(originalName).toLowerCase();

  const duplicate = db.songs.find((s) => s.hash === hash);
  if (duplicate) {
    await fsp.rm(file.path, { force: true });
    return { name: originalName, duplicate: true, song: publicSong(duplicate) };
  }

  const meta = await parseFile(file.path, { duration: true }); // lanza error si no es audio válido
  if (!(meta.format?.duration > 0)) throw new Error('Sin audio reproducible');
  const common = meta.common || {};

  let cover = null;
  const picture = selectCover(common.picture);
  if (picture?.data?.length) {
    const format = picture.format || '';
    const coverExt = format.includes('png') ? '.png' : format.includes('webp') ? '.webp' : format.includes('gif') ? '.gif' : '.jpg';
    cover = `${crypto.createHash('sha1').update(picture.data).digest('hex').slice(0, 16)}${coverExt}`;
    const coverPath = path.join(COVER_DIR, cover);
    if (!fs.existsSync(coverPath)) await fsp.writeFile(coverPath, picture.data);
  }

  const id = newId();
  const stored = `${id}${ext}`;
  await fsp.rename(file.path, path.join(MUSIC_DIR, stored));

  const song = {
    id,
    file: stored,
    ext,
    mime: AUDIO_TYPES[ext],
    originalName,
    hash,
    title: (common.title || path.basename(originalName, ext).replace(/_/g, ' ')).trim().slice(0, 200) || 'Sin título',
    artist: (common.artist || common.albumartist || '').trim().slice(0, 200),
    album: (common.album || '').trim().slice(0, 200),
    track: common.track?.no || 0,
    duration: Math.round((meta.format?.duration || 0) * 10) / 10,
    size: file.size,
    cover,
    favorite: false,
    addedAt: Date.now()
  };
  db.songs.push(song);
  saveDb();
  return { name: originalName, song: publicSong(song) };
}

app.post('/api/upload', upload.array('files', 50), async (req, res) => {
  const results = [];
  for (const file of req.files || []) {
    try {
      results.push(await ingest(file));
    } catch (err) {
      await fsp.rm(file.path, { force: true });
      results.push({ name: fixName(file.originalname), error: 'El archivo no parece ser audio válido' });
    }
  }
  if (!results.length) return res.status(400).json({ error: 'No se recibió ningún archivo' });
  res.json({ results });
});

/* --------------------------------- Listas ---------------------------------- */

app.get('/api/playlists', (req, res) => res.json(db.playlists));

app.post('/api/playlists', (req, res) => {
  const name = clean(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'Escribe un nombre para la lista' });
  const playlist = { id: newId(), name, songIds: [], createdAt: Date.now() };
  if (Array.isArray(req.body?.songIds)) {
    playlist.songIds = [...new Set(req.body.songIds.filter((id) => typeof id === 'string' && findSong(id)))];
  }
  db.playlists.push(playlist);
  saveDb();
  res.status(201).json(playlist);
});

app.patch('/api/playlists/:id', (req, res) => {
  const playlist = findPlaylist(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Lista no encontrada' });
  const { name, add, remove } = req.body || {};
  const n = clean(name, 100);
  if (n !== undefined) {
    if (!n) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    playlist.name = n;
  }
  if (Array.isArray(add)) {
    for (const id of add) if (typeof id === 'string' && findSong(id) && !playlist.songIds.includes(id)) playlist.songIds.push(id);
  }
  if (Array.isArray(remove)) playlist.songIds = playlist.songIds.filter((id) => !remove.includes(id));
  saveDb();
  res.json(playlist);
});

app.delete('/api/playlists/:id', (req, res) => {
  if (!findPlaylist(req.params.id)) return res.status(404).json({ error: 'Lista no encontrada' });
  db.playlists = db.playlists.filter((p) => p.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

/* --------------------------------- Errores --------------------------------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `El archivo supera el máximo de ${MAX_MB} MB` : 'Error al subir el archivo' });
  }
  if (err?.code === 'BAD_TYPE') return res.status(415).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Solicitud inválida' });
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

/* --------------------------------- Arranque -------------------------------- */

const server = app.listen(PORT, HOST, () => {
  console.log('\n  ♪  Sonora está funcionando\n');
  console.log(`  En esta computadora:  http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  En tu celular (misma red Wi-Fi):  http://${ip}:${PORT}`);
  console.log(`\n  Biblioteca: ${db.songs.length} canciones · Datos en: ${DATA_DIR}`);
  console.log(PASSWORD ? '  Acceso protegido con contraseña.\n' : '  Sin contraseña (define SONORA_PASSWORD para protegerla).\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\n  El puerto ${PORT} ya está en uso. Cierra la otra copia o usa otro: PORT=3001 npm start\n`);
  else console.error(err);
  process.exit(1);
});
