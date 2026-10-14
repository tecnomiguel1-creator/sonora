@echo off
chcp 65001 >nul
title Sonora - crear instalador para Windows
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

echo.
echo  Preparando la app de escritorio. La primera vez descarga unos 200 MB y tarda varios minutos...
echo.
call npm install
if errorlevel 1 ( echo. & echo  No se pudo instalar. Revisa tu conexion a internet. & pause & exit /b 1 )

call npm run instalador
if errorlevel 1 (
  echo.
  echo  No se pudo crear el instalador.
  echo  Si el mensaje habla de "symbolic link" o "privilegio": activa el Modo de desarrollador
  echo  en Configuracion ^> Sistema ^> Para programadores, o ejecuta este archivo como administrador.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   Listo. En la carpeta "dist" esta:  Sonora-Instalador-1.0.0.exe
echo   Hazle doble clic para instalar Sonora ^(crea el icono en el escritorio^).
echo   Este instalador NO se actualiza solo. Para actualizaciones automaticas mira el README.
echo  ============================================================
start "" "%~dp0dist"
pause
