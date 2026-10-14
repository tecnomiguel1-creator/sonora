// Prepara el proyecto Android de Sonora: crea la plataforma, genera íconos y
// pantalla de carga, aplica los ajustes de Sonora y sincroniza.
// Uso: npm run preparar
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { personalizar } from './personalizar-android.mjs';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

if (!fs.existsSync('android')) run('npx cap add android');
run('npx capacitor-assets generate --android --assetPath assets --iconBackgroundColor "#09090d" --iconBackgroundColorDark "#09090d" --splashBackgroundColor "#09090d" --splashBackgroundColorDark "#09090d"');
personalizar();
run('npx cap sync android');

console.log('\n✔ Listo. El proyecto Android está en la carpeta "android".');
