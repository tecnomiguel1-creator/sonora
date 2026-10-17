@echo off
chcp 65001 >nul
title Sonora
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js.
  echo  Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Instalando por primera vez, un momento...
  call npm install --omit=dev
  if errorlevel 1 (
    echo  No se pudo instalar. Revisa tu conexion a internet.
    pause
    exit /b 1
  )
)

rem Para proteger con contrasena, quita "rem" de la siguiente linea y cambia la clave:
rem set SONORA_PASSWORD=mi-clave-segura

rem Abre Sonora en el navegador (funciona sin internet: todo corre en esta PC)
start "" http://localhost:3000

node server.js
pause
