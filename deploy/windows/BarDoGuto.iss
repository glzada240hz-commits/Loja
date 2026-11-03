; Instalador do Bar do Guto (modo loja). Compilado no GitHub Actions:
;   iscc /DAppVersion=0.2.0 /DSourceDir=..\..\dist-windows\BarDoGuto /DOutputDir=..\..\dist-windows deploy\windows\BarDoGuto.iss
; Instala para o usuário atual (sem pedir administrador). Os dados da loja ficam em %LOCALAPPDATA%\BarDoGuto\loja
; e NÃO são apagados ao desinstalar.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist-windows\BarDoGuto"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist-windows"
#endif

[Setup]
AppId={{6E3C2A7B-4B4F-4E3A-9C1D-2B0D6F1A9E51}
AppName=Bar do Guto
AppVersion={#AppVersion}
AppPublisher=Bar do Guto
DefaultDirName={localappdata}\Programs\BarDoGuto
DefaultGroupName=Bar do Guto
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=BarDoGuto-Instalador-{#AppVersion}
SetupIconFile=BarDoGuto.ico
UninstallDisplayIcon={app}\BarDoGuto.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"
Name: "startup"; Description: "Abrir o Bar do Guto quando o Windows iniciar"; GroupDescription: "Atalhos:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Bar do Guto"; Filename: "{app}\BarDoGuto.exe"; WorkingDir: "{app}"; IconFilename: "{app}\BarDoGuto.exe"
Name: "{group}\Leia-me"; Filename: "{app}\LEIA-ME.txt"
Name: "{group}\Pasta das cópias de segurança"; Filename: "{localappdata}\BarDoGuto\loja\copias-de-seguranca"
Name: "{userdesktop}\Bar do Guto"; Filename: "{app}\BarDoGuto.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\Bar do Guto"; Filename: "{app}\BarDoGuto.exe"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\LEIA-ME.txt"; Description: "Ler as instruções"; Flags: postinstall shellexec skipifsilent unchecked
Filename: "{app}\BarDoGuto.exe"; Description: "Abrir o Bar do Guto agora"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; encerra com segurança o Bar do Guto aberto (banco de dados incluído) antes de remover
Filename: "{app}\BarDoGuto.exe"; Parameters: "--encerrar"; RunOnceId: "EncerrarBarDoGuto"; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\runtime"

[Messages]
brazilianportuguese.FinishedLabel=O Bar do Guto foi instalado. Na primeira abertura, crie a senha do administrador. Ele funciona como um aplicativo: fica no ícone perto do relógio; para encerrar no fim do dia, clique com o botão direito no ícone e escolha Encerrar. Os dados da loja ficam em %LOCALAPPDATA%\BarDoGuto\loja e não são apagados se você desinstalar.

[Code]
// Atualização por cima: se o Bar do Guto estiver aberto, encerra com segurança antes de copiar os arquivos.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  if CheckForMutexes('BarDoGuto.Loja') and FileExists(ExpandConstant('{app}\BarDoGuto.exe')) then
    Exec(ExpandConstant('{app}\BarDoGuto.exe'), '--encerrar', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
