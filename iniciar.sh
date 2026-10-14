#!/usr/bin/env bash
# Arranca Sonora. Uso: ./iniciar.sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "No se encontró Node.js. Instálalo desde https://nodejs.org (versión LTS) y vuelve a intentarlo."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Instalando por primera vez, un momento..."
  npm install --omit=dev || { echo "No se pudo instalar. Revisa tu conexión a internet."; exit 1; }
fi

# Para proteger con contraseña, quita el "#" de la siguiente línea y cambia la clave:
# export SONORA_PASSWORD="mi-clave-segura"

exec node server.js
