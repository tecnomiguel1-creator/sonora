// Ajusta el proyecto Android que genera Capacitor para Sonora:
// permite conectarse por http (red local), mantiene el audio con la pantalla apagada
// y pinta la ventana del color de la app para evitar destellos blancos.
import fs from 'node:fs';
import path from 'node:path';

const res = path.join('android', 'app', 'src', 'main');
const manifestPath = path.join(res, 'AndroidManifest.xml');
const stylesPath = path.join(res, 'res', 'values', 'styles.xml');
const colorsPath = path.join(res, 'res', 'values', 'sonora_colors.xml');

export function personalizar() {
  // 1) Manifiesto: tráfico http (servidor en tu red) y permiso para no dormir el audio
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('usesCleartextTraffic')) {
    manifest = manifest.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  }
  if (!manifest.includes('android.permission.WAKE_LOCK')) {
    manifest = manifest.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.WAKE_LOCK" />'
    );
  }
  fs.writeFileSync(manifestPath, manifest);

  // 2) Colores y tema oscuro
  fs.writeFileSync(
    colorsPath,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="sonora_bg">#09090D</color>\n</resources>\n'
  );
  let styles = fs.readFileSync(stylesPath, 'utf8');
  if (!styles.includes('sonora_bg')) {
    styles = styles.replace(
      '<item name="android:background">@null</item>',
      '<item name="android:background">@null</item>\n        <item name="android:windowBackground">@color/sonora_bg</item>\n        <item name="android:statusBarColor">@color/sonora_bg</item>\n        <item name="android:navigationBarColor">@color/sonora_bg</item>'
    );
  }
  fs.writeFileSync(stylesPath, styles);

  const ok = fs.readFileSync(manifestPath, 'utf8').includes('usesCleartextTraffic') && fs.readFileSync(stylesPath, 'utf8').includes('sonora_bg');
  if (!ok) throw new Error('No se pudo personalizar el proyecto Android (la plantilla cambió).');
  console.log('✔ Proyecto Android personalizado para Sonora');
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('personalizar-android.mjs')) personalizar();
