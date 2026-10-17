// Mete la pantalla de Sonora (la carpeta "public" del proyecto) dentro de la app de Android.
// Así la app abre aunque el servidor esté apagado y puede reproducir las canciones guardadas en el celular.
// Se ejecuta solo antes de cada "cap sync" (preparar-apk, GitHub Actions o `npm run sync`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(root, '..', 'public');
const out = path.join(root, 'www', 'app');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error(`No encontré la pantalla de Sonora en ${src}. Ejecuta esto desde dentro de la carpeta de Sonora completa.`);
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
// El service worker y el manifiesto son de la versión web; dentro de la app no hacen falta.
for (const f of ['sw.js', 'manifest.webmanifest']) fs.rmSync(path.join(out, f), { force: true });

// Las direcciones que empiezan con "/" apuntan a la raíz de la app: pasan a ser relativas a la carpeta "app".
const indexFile = path.join(out, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
html = html
  .replace(/<link rel="manifest"[^>]*>\s*/g, '')
  .replace(/(href|src)="\/(?!\/)/g, '$1="')
  .replace('<script src="offline.js"></script>', '<script src="bundle-config.js"></script>\n<script src="offline.js"></script>');
fs.writeFileSync(indexFile, html);
fs.writeFileSync(path.join(out, 'bundle-config.js'), 'window.SONORA_BUNDLED = true;\n');
// Cargador: baja la pantalla más reciente del servidor, o usa la última guardada, o esta copia.
fs.copyFileSync(path.join(root, 'scripts', 'start.html'), path.join(out, 'start.html'));

const left = (html.match(/(href|src)="\/[^/]/g) || []).length;
console.log(`✔ Pantalla de Sonora copiada a www/app (${fs.readdirSync(out).length} elementos${left ? `, quedan ${left} direcciones absolutas` : ''}).`);
