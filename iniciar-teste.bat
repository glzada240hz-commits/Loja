@echo off
REM Bar do Guto - ambiente de TESTES no Windows (dados ficticios, banco separado).
REM Dois cliques neste arquivo. Para encerrar, feche a janela (os dados ficam guardados).
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

REM O script confere a versao do Node, instala/atualiza dependencias, recompila se o codigo mudou,
REM impede abrir duas vezes e baixa o cloudflared para o link HTTPS (gratuito).
node scripts\ambiente-teste.mjs --tunel %*
if errorlevel 1 (
  echo.
  echo  [ERRO] O ambiente de testes nao iniciou. Leia a mensagem acima.
  echo  Ajuda: docs\TESTE-WINDOWS.md - secao "Se algo der errado".
)
echo.
pause
