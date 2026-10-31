@echo off
REM Bar do Guto - atualiza o codigo do ambiente de testes SEM apagar os dados de teste.
REM Os dados ficam em %LOCALAPPDATA%\BarDoGuto\teste (fora desta pasta).
chcp 65001 >nul
cd /d "%~dp0"
title Bar do Guto - atualizar

if exist .git (
  where git >nul 2>nul
  if errorlevel 1 goto zip
  echo  Baixando a versao mais recente pelo Git...
  git pull --ff-only
  if errorlevel 1 (
    echo  [ERRO] Nao foi possivel atualizar pelo Git. Veja a mensagem acima.
    pause
    exit /b 1
  )
  echo.
  echo  Pronto. Abra o iniciar-teste.bat: ele instala o que mudou e recompila sozinho.
  pause
  exit /b 0
)

:zip
echo.
echo  Esta copia veio de um arquivo ZIP. Para atualizar:
echo   1. Feche a janela do iniciar-teste, se estiver aberta.
echo   2. Baixe o ZIP novo (o navegador vai abrir a pagina agora): botao verde "Code" - "Download ZIP".
echo   3. Extraia numa pasta nova e de dois cliques no iniciar-teste.bat dela.
echo  Seus dados de teste continuam guardados em %LOCALAPPDATA%\BarDoGuto\teste
echo  e serao usados pela versao nova automaticamente.
echo.
start "" "https://github.com/glzada240hz-commits/Loja/tree/claude/gallant-hopper-i7t3xm"
pause
