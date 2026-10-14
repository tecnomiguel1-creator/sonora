'use strict';
// Sonora para escritorio: abre Sonora en su propia ventana, con el servidor incluido.
// Al cerrar la ventana sigue funcionando en la bandeja del sistema (junto al reloj),
// para que el celular pueda seguir escuchando tu música.

const { app, BrowserWindow, Tray, Menu, dialog, shell, clipboard, nativeImage } = require('electron');
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

app.setAppUserModelId('app.sonora.music.desktop');
// Que la siguiente canción suene sola y que las teclas multimedia del teclado funcionen.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');

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
  win.loadURL(`http://localhost:${port}`);

  // Los enlaces externos se abren en el navegador, no dentro de Sonora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${port}`)) {
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
    { label: 'Abrir carpeta de datos', click: () => shell.openPath(dataDir) },
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
          { label: 'Abrir carpeta de datos', click: () => shell.openPath(dataDir) },
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
      await startServer();
    } catch (err) {
      dialog.showErrorBox('Sonora no pudo iniciar', String(err?.message || err));
      quitting = true;
      app.quit();
      return;
    }
    createMenu();
    createTray();
    createWindow();
    setupUpdates();
  });
}
