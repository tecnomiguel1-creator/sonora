#!/usr/bin/env bash
# Prepara el proyecto Android de Sonora. Uso: ./preparar-apk.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "No se encontró Node.js. Instálalo desde https://nodejs.org (LTS)."; exit 1; }
echo "Instalando componentes (solo la primera vez)..."
npm install || { echo "No se pudo instalar. Revisa tu conexión a internet."; exit 1; }
npx cap sync android || { echo "Falló la sincronización."; exit 1; }
cat <<'MSG'

============================================================
 Listo. Ahora abre ANDROID STUDIO:
   1. File > Open > elige la carpeta  android-app/android
   2. Espera a que termine de cargar (barra de abajo)
   3. Menú Build > Build Bundle(s) / APK(s) > Build APK(s)
   4. Pulsa "locate" cuando termine: ahí está app-debug.apk
============================================================
MSG
