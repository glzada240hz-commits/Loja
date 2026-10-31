@echo off
REM Bar do Guto - APAGA os dados do ambiente de TESTES (pedidos, caixa, clientes ficticios).
REM Nao mexe no codigo nem em nenhum banco real. Pede confirmacao (digite ZERAR).
chcp 65001 >nul
cd /d "%~dp0"
title Bar do Guto - zerar dados de teste

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERRO] O Node.js nao esta instalado. Instale a versao LTS em https://nodejs.org
  pause
  exit /b 1
)
echo.
echo  Feche antes a janela do "iniciar-teste", se estiver aberta.
node scripts\ambiente-teste.mjs --zerar --sem-iniciar
echo.
pause
