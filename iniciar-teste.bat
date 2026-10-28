@echo off
REM Bar do Guto - ambiente de TESTES no Windows (dados ficticios, banco separado).
REM Dois cliques neste arquivo. Para encerrar, feche a janela.
chcp 65001 >nul
cd /d "%~dp0"
title Bar do Guto - ambiente de testes

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERRO] O Node.js nao esta instalado.
  echo  Instale a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Instalando dependencias - primeira vez, pode levar alguns minutos...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  [ERRO] Falha ao instalar dependencias. Verifique a internet e tente de novo.
    pause
    exit /b 1
  )
)

if not exist .teste mkdir .teste
if not exist .teste\cloudflared.exe (
  echo  Baixando o cloudflared - gratuito, cria o link HTTPS para o celular...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '.teste\cloudflared.exe'"
  if errorlevel 1 echo  [AVISO] Nao consegui baixar o cloudflared. O sistema abre neste PC e no Wi-Fi, sem link HTTPS.
)

node scripts\ambiente-teste.mjs --tunel %*
echo.
pause
