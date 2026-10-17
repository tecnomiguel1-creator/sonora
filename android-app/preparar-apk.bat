@echo off
chcp 65001 >nul
title Sonora - preparar APK
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

echo  Instalando componentes ^(solo la primera vez^)...
call npm install
if errorlevel 1 ( echo  No se pudo instalar. Revisa tu conexion a internet. & pause & exit /b 1 )

call node scripts\bundle-ui.mjs
if errorlevel 1 ( echo  No se pudo preparar la pantalla. Usa la carpeta de Sonora completa. & pause & exit /b 1 )
call npx cap sync android
if errorlevel 1 ( echo  Fallo la sincronizacion. & pause & exit /b 1 )

echo.
echo  ============================================================
echo   Listo. Ahora abre ANDROID STUDIO:
echo     1. File ^> Open ^> elige la carpeta  android-app\android
echo     2. Espera a que termine de cargar ^(barra de abajo^)
echo     3. Menu Build ^> Build Bundle^(s^) / APK^(s^) ^> Build APK^(s^)
echo     4. Pulsa "locate" cuando termine: ahi esta app-debug.apk
echo  ============================================================
pause
