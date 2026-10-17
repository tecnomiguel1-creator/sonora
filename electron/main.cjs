'use strict';
// Sonora para escritorio: abre Sonora en su propia ventana, con el servidor incluido.
// Al cerrar la ventana sigue funcionando en la bandeja del sistema (junto al reloj),
// para que el celular pueda seguir escuchando tu música.

const { app, BrowserWindow, Tray, Menu, dialog, shell, clipboard, nativeImage, ipcMain } = require('electron');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// Sin consola en Windows, escribir en stdout/stderr no debe romper nada.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

const ICON = path.join(__dirname, 'icon.png');
const START_HIDDEN = process.argv.includes('--oculto');

let win = null;
let tray = null;
let port = 3000;
let dataDir = '';
let quitting = false;
let trayHintShown = false;
let autoUpdater = null;
let updateReady = null; // versión ya descargada, lista para instalar
let manualCheck = false;
let remoteUrl = ''; // si hay una dirección aquí, Sonora usa ese servidor en la nube en vez del servidor de esta PC

app.setAppUserModelId('app.sonora.music.desktop');
// Que la siguiente canción suene sola y que las teclas multimedia del teclado funcionen.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');

/* ------------------------- Servidor en la nube (opcional) ------------------ */
// Si guardas la dirección de tu servidor en la nube, esta app se conecta a él (igual que el celular):
// la música vive en el servidor y funciona aunque esta PC esté apagada o en otra red.

const configFile = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
}

function normalizeRemote(value) {
  value = String(value || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  try {
    const u = new URL(value);
    return u.origin;
  } catch {
    return null;
  }
}

function baseUrl() {
  return remoteUrl || `http://localhost:${port}`;
}

let remoteWin = null;
function openRemoteDialog() {
  if (remoteWin) return remoteWin.focus();
  remoteWin = new BrowserWindow({
    width: 520,
    height: 400,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: win && win.isVisible() ? win : undefined,
    modal: !!(win && win.isVisible()),
    autoHideMenuBar: true,
    title: 'Servidor en la nube',
    icon: ICON,
    backgroundColor: '#15151d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'nube-preload.cjs')
    }
  });
  remoteWin.setMenu(null);
  remoteWin.loadFile(path.join(__dirname, 'nube.html'), { query: { actual: remoteUrl } });
  remoteWin.on('closed', () => {
    remoteWin = null;
  });
}

ipcMain.handle('nube:guardar', async (_event, raw) => {
  const url = normalizeRemote(raw);
  if (url === null) return { ok: false, error: 'Esa dirección no parece válida. Ejemplo: https://sonora-abcd.onrender.com' };
  if (url) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`${url}/api/session`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      return {
        ok: false,
        error: 'No se pudo conectar con esa dirección. Revisa que esté bien escrita y que el servidor esté encendido (la primera vez puede tardar un minuto en despertar).'
      };
    }
  }
  saveConfig({ remoteUrl: url });
  setTimeout(() => {
    quitting = true;
    app.relaunch();
    app.exit(0);
  }, 300);
  return { ok: true };
});

ipcMain.on('nube:cerrar', () => remoteWin && remoteWin.close());

/* ------------------------------- Servidor -------------------------------- */

function isFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(p, '0.0.0.0');
  });
}

async function pickPort(start) {
  for (let p = start; p < start + 30; p++) if (await isFree(p)) return p;
  throw new Error(`No hay un puerto libre entre ${start} y ${start + 29}.`);
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${url}/api/session`);
      if (res.ok) return;
    } catch {
      /* todavía no responde */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('El servidor de Sonora no respondió.');
}

async function startServer() {
  dataDir = process.env.SONORA_DATA || path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.SONORA_DATA = dataDir;
  port = await pickPort(Number(process.env.PORT) || 3000);
  process.env.PORT = String(port);
  process.env.HOST = '0.0.0.0';
  await import(pathToFileURL(path.join(__dirname, '..', 'server.js')).href);
  await waitForServer(`http://127.0.0.1:${port}`);
}

/* -------------------------------- Ventana -------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#09090d',
    title: 'Sonora',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });

  win.once('ready-to-show', () => {
    if (!START_HIDDEN) win.show();
  });
  win.loadURL(baseUrl());

  // Si el servidor en la nube no responde (sin internet, por ejemplo), muestra un aviso con salida.
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (!remoteUrl || !isMainFrame || code === -3) return;
    const html = `<meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;height:100vh;background:#09090d;color:#f5f5f8;font:16px system-ui,sans-serif;text-align:center"><div style="max-width:420px;padding:24px"><h2>No se pudo conectar con tu Sonora</h2><p style="color:#a2a2b6">Revisa tu conexión a internet. Si usas un servidor gratis, puede tardar un minuto en despertar.</p><button onclick="location.href='${remoteUrl}'" style="padding:12px 22px;border:0;border-radius:99px;background:#ff6a3d;font-weight:700;cursor:pointer">Reintentar</button></div>`;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });

  // Los enlaces externos se abren en el navegador, no dentro de Sonora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl()) && !url.startsWith('data:')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // Cerrar la ventana la oculta: Sonora sigue funcionando en la bandeja.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
    if (process.platform === 'win32' && tray && !trayHintShown) {
      trayHintShown = true;
      tray.displayBalloon({
        iconType: 'info',
        title: 'Sonora sigue funcionando',
        content: 'Tu música sigue disponible para el celular. Para cerrarla del todo, usa el ícono de Sonora junto al reloj → Salir.'
      });
    }
  });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------------------------- Conectar el celular ------------------------- */

function lanAddresses() {
  const rank = (ip) =>
    /^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  const list = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) list.push(a.address);
  }
  return list.sort((a, b) => rank(a) - rank(b));
}

async function showConnect() {
  showWindow();
  if (remoteUrl) {
    const { response } = await dialog.showMessageBox(win && win.isVisible() ? win : undefined, {
      type: 'info',
      title: 'Conectar el celular',
      message: 'Tu Sonora está en la nube',
      detail: `En el celular abre la app Sonora y escribe esta dirección:\n\n      ${remoteUrl}\n\nFunciona en cualquier Wi-Fi o con datos, aunque esta computadora esté apagada. Inicia sesión con tu contraseña.`,
      buttons: ['Copiar dirección', 'Cerrar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (response === 0) clipboard.writeText(remoteUrl);
    return;
  }
  const list = lanAddresses();
  const main = list[0] ? `${list[0]}:${port}` : '';
  const others = list.slice(1).map((ip) => `${ip}:${port}`);
  const detail = main
    ? `1. Conecta el celular al mismo Wi-Fi que esta computadora.\n2. Abre la app Sonora en el celular.\n3. Escribe esta dirección y toca Conectar:\n\n      ${main}` +
      (others.length ? `\n\nOtras direcciones (VPN u otras redes):\n      ${others.join('\n      ')}` : '')
    : 'No se detectó ninguna red. Conecta esta computadora a tu Wi-Fi y vuelve a abrir esta ventana.';
  const { response } = await dialog.showMessageBox(win && win.isVisible() ? win : undefined, {
    type: 'info',
    title: 'Conectar el celular',
    message: 'Conecta tu celular a Sonora',
    detail,
    buttons: main ? ['Copiar dirección', 'Cerrar'] : ['Cerrar'],
    defaultId: 0,
    cancelId: main ? 1 : 0,
    noLink: true
  });
  if (main && response === 0) clipboard.writeText(main);
}

/* ------------------------------ Actualizaciones --------------------------- */
// Con el instalador que se descarga de GitHub (Releases), Sonora se actualiza sola:
// busca versiones nuevas al abrir y cada 6 horas, las descarga en segundo plano y
// te pregunta si reiniciar. Tu música (carpeta de datos) no se toca.

function updatesAvailable() {
  return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}

function dialogParent() {
  return win && win.isVisible() ? win : undefined;
}

async function askRestart(version) {
  const { response } = await dialog.showMessageBox(dialogParent(), {
    type: 'info',
    title: 'Actualización lista',
    message: `Sonora ${version} está lista para instalarse`,
    detail:
      'La app se reiniciará un momento. Tu música no se borra.\n\nSi eliges «Más tarde», se instalará sola la próxima vez que salgas de Sonora (clic derecho en su ícono → Salir).',
    buttons: ['Reiniciar ahora', 'Más tarde'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (response === 0) {
    quitting = true;
    autoUpdater.quitAndInstall(true, true);
  }
}

function checkUpdates() {
  if (!autoUpdater) return;
  if (updateReady) {
    if (win && win.isVisible()) askRestart(updateReady);
    return;
  }
  autoUpdater.checkForUpdates().catch(() => {});
}

function checkUpdatesManual() {
  if (!autoUpdater) {
    dialog.showMessageBox(dialogParent(), {
      type: 'info',
      title: 'Actualizaciones',
      message: 'Las actualizaciones automáticas no están activas en esta copia',
      detail: 'Solo funcionan con el instalador que se descarga de la página de versiones (Releases) de GitHub.',
      buttons: ['Cerrar'],
      noLink: true
    });
    return;
  }
  if (updateReady) return askRestart(updateReady);
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

function setupUpdates() {
  if (!updatesAvailable()) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('No se pudo cargar el actualizador:', err);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('update-not-available', () => {
    if (!manualCheck) return;
    manualCheck = false;
    dialog.showMessageBox(dialogParent(), {
      type: 'info',
      title: 'Estás al día',
      message: 'Ya tienes la última versión de Sonora',
      detail: `Versión ${app.getVersion()}`,
      buttons: ['Cerrar'],
      noLink: true
    });
  });
  autoUpdater.on('update-available', (info) => {
    if (!manualCheck) return;
    manualCheck = false;
    dialog.showMessageBox(dialogParent(), {
      type: 'info',
      title: 'Hay una versión nueva',
      message: `Descargando Sonora ${info.version}…`,
      detail: 'Puedes seguir usando la app. Te avisaremos cuando esté lista.',
      buttons: ['Cerrar'],
      noLink: true
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    manualCheck = false;
    updateReady = info.version;
    askRestart(info.version);
  });
  autoUpdater.on('error', () => {
    if (!manualCheck) return; // las búsquedas automáticas fallan en silencio (sin internet, etc.)
    manualCheck = false;
    dialog.showMessageBox(dialogParent(), {
      type: 'warning',
      title: 'No se pudo buscar actualizaciones',
      message: 'No se pudo conectar para buscar actualizaciones',
      detail: 'Revisa tu conexión a internet e inténtalo de nuevo más tarde.',
      buttons: ['Cerrar'],
      noLink: true
    });
  });

  setTimeout(checkUpdates, 15 * 1000);
  setInterval(checkUpdates, 6 * 60 * 60 * 1000);
}

/* ------------------------------ Bandeja y menú ---------------------------- */

function quitApp() {
  quitting = true;
  app.quit();
}

function toggleAutostart(item) {
  app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--oculto'] });
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Abrir Sonora', click: showWindow },
    { label: 'Conectar celular…', click: showConnect },
    { type: 'separator' },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      enabled: app.isPackaged && process.platform === 'win32',
      click: toggleAutostart
    },
    { label: 'Servidor en la nube…', click: openRemoteDialog },
    { label: 'Abrir carpeta de datos', enabled: !remoteUrl, click: () => shell.openPath(dataDir) },
    { type: 'separator' },
    { label: `Versión ${app.getVersion()}`, enabled: false },
    { label: 'Buscar actualizaciones…', click: checkUpdatesManual },
    { type: 'separator' },
    { label: 'Salir', click: quitApp }
  ]);
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('Sonora');
    tray.setContextMenu(trayMenu());
    tray.on('click', showWindow);
  } catch (err) {
    console.error('No se pudo crear el ícono de la bandeja:', err);
  }
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Sonora',
        submenu: [
          { label: 'Conectar celular…', accelerator: 'CmdOrCtrl+K', click: showConnect },
          { label: 'Servidor en la nube…', click: openRemoteDialog },
          { label: 'Abrir carpeta de datos', enabled: !remoteUrl, click: () => shell.openPath(dataDir) },
          { type: 'separator' },
          { label: `Versión ${app.getVersion()}`, enabled: false },
          { label: 'Buscar actualizaciones…', click: checkUpdatesManual },
          { type: 'separator' },
          { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: quitApp }
        ]
      },
      {
        label: 'Ver',
        submenu: [
          { role: 'reload', label: 'Recargar' },
          { role: 'togglefullscreen', label: 'Pantalla completa' },
          { type: 'separator' },
          { role: 'zoomIn', label: 'Acercar' },
          { role: 'zoomOut', label: 'Alejar' },
          { role: 'resetZoom', label: 'Tamaño normal' }
        ]
      }
    ])
  );
}

/* --------------------------------- Arranque ------------------------------- */

if (!app.requestSingleInstanceLock()) {
  // Ya hay una Sonora abierta: la otra se encarga de mostrarse.
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });
  // Con la ventana cerrada, la app sigue viva en la bandeja.
  app.on('window-all-closed', () => {});
  app.on('activate', showWindow);

  app.whenReady().then(async () => {
    try {
      remoteUrl = normalizeRemote(readConfig().remoteUrl) || '';
      if (!remoteUrl) await startServer();
    } catch (err) {
      dialog.showErrorBox('Sonora no pudo iniciar', String(err?.message || err));
      quitting = true;
      app.quit();
      return;
    }
    createMenu();
    createTray();
    createWindow();
    if (process.argv.includes('--nube')) openRemoteDialog();
    setupUpdates();
  });
}
