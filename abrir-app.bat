@echo off
chcp 65001 >nul
title Sonora
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules\electron (
  echo  Preparando la app por primera vez ^(descarga unos 100 MB^)...
  call npm install
  if errorlevel 1 ( echo  No se pudo instalar. Revisa tu conexion a internet. & pause & exit /b 1 )
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
