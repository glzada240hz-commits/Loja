# Instalar o Bar do Guto no computador da loja (Windows)

O **instalador** (`BarDoGuto-Instalador-<versão>.exe`) é gerado e **testado automaticamente num Windows** pelo
GitHub Actions (`.github/workflows/pacote-windows.yml`): primeira abertura, login, pedido, reabertura com os
dados mantidos e cópia de segurança. Ele fica na página **Releases** do repositório (pré-release
`loja-<versão>`) e também em *Actions → Pacote Windows (loja) → Artifacts*.

Este é o **modo loja** (uso real), diferente do ambiente de testes (`iniciar-teste.bat`):

| | Modo loja (instalador) | Ambiente de testes |
|---|---|---|
| Usuários | só `admin`, com senha criada na 1ª abertura | usuários de demonstração com senha pública |
| Dados | `%LOCALAPPDATA%\BarDoGuto\loja` | `%LOCALAPPDATA%\BarDoGuto\teste` |
| Banco | porta 54330, senha aleatória gerada no computador | porta 54329 |
| Cópia de segurança | automática, 1 por dia (14 últimas) | não |
| Cardápio | vazio ou exemplo (você escolhe) | exemplo |

## Versão disponível

- **`0.2.0+0edfb473`** — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-0edfb473
  (`BarDoGuto-Instalador-0.2.0-0edfb473.exe`). App do atendente com aba **Balcão**: pedido para levar (sem mesa)
  lançado no celular, sai na cozinha e o cliente paga no caixa.
- `0.2.0+b8f2ccb0` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-b8f2ccb0
  (`BarDoGuto-Instalador-0.2.0-b8f2ccb0.exe`). **Acréscimos em verde** (Cardápio → Adicionais → Acréscimos) e aba
  **WhatsApp** no app do atendente: lançar o pedido que chegou pelo WhatsApp (sai na cozinha) e “Avisar no
  WhatsApp” com o resumo pronto. Ver [WHATSAPP-PEDIDOS.md](WHATSAPP-PEDIDOS.md).
- `0.2.0+eb149b04` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-eb149b04
  (`BarDoGuto-Instalador-0.2.0-eb149b04.exe`). **Duas impressoras**: em *Celulares e cozinha* escolhe-se a
  **impressora da cozinha** (a via sai nela pelo aplicativo do Windows); a nota sai na impressora padrão (caixa).
- `0.2.0+504501f9` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-504501f9
  (`BarDoGuto-Instalador-0.2.0-504501f9.exe`). Corrige: nas janelas (cadastro de usuário, autorização do gerente ao
  cancelar…) o cursor voltava ao primeiro campo a cada tecla; senha errada do gerente deslogava o caixa.
- `0.2.0+481cf00f` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-481cf00f
  (`BarDoGuto-Instalador-0.2.0-481cf00f.exe`). **Pedido enviado sai direto na impressora**: o computador da loja já
  vem com a impressão da cozinha ligada (impressora padrão do Windows, sem diálogo). Desligar em *Celulares e
  cozinha* fica desligado.
- `0.2.0+9e5c93d9` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-9e5c93d9
  (`BarDoGuto-Instalador-0.2.0-9e5c93d9.exe`). Corrige o cadastro de atendentes: usuário com maiúscula, acento ou
  espaço (“Ana Paula”, “João”) é aceito e entra do mesmo jeito; o campo não “volta” mais ao digitar no
  celular; o navegador não preenche com o login salvo; ao salvar aparece o usuário e a senha para passar.
- `0.2.0+cb044f61` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-cb044f61
  (`BarDoGuto-Instalador-0.2.0-cb044f61.exe`). Cardápio corrigido: Fritas c/ Cheddar e Bacon leva cheddar (aplicado
  sozinho na primeira abertura).
- `0.2.0+108b1c19` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-108b1c19
  (`BarDoGuto-Instalador-0.2.0-108b1c19.exe`). O **cardápio do Bar do Guto entra sozinho** na primeira abertura desta
  versão (uma vez; mudanças feitas depois pela loja são mantidas).
- `0.2.0+4fcd8399` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-4fcd8399
  (`BarDoGuto-Instalador-0.2.0-4fcd8399.exe`). **Cardápio oficial do Bar do Guto** (47 itens das artes enviadas):
  Cardápio → *Conferir e importar*. Ver [CARDAPIO-OFICIAL.md](CARDAPIO-OFICIAL.md).
- `0.2.0+26397939` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-26397939
  (`BarDoGuto-Instalador-0.2.0-26397939.exe`). **Estoque → Vender**: item cadastrado no estoque (ex.: cerveja,
  refrigerante) vai para o cardápio com preço e aparece no PDV, nas mesas e no celular; cada venda baixa o
  estoque. Novo item já pede a quantidade atual.
- `0.2.0+87d64419` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-87d64419
  (`BarDoGuto-Instalador-0.2.0-87d64419.exe`). **Atendentes no celular** (QR na tela *Celulares e cozinha*) e
  **pedidos impressos na cozinha automaticamente**, direto na impressora padrão — ver
  [CELULARES-E-COZINHA.md](CELULARES-E-COZINHA.md).
- `0.2.0+f826eaaf` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-f826eaaf
  (`BarDoGuto-Instalador-0.2.0-f826eaaf.exe`). Corrige: no **App do atendente** aberto pelo gerente/caixa não
  havia como voltar ao sistema (o aplicativo da loja não tem o botão Voltar do navegador); agora há a seta
  **Voltar ao sistema**. Em janelas estreitas o botão de menu não cobre mais o título de Mesas. O link do
  cardápio digital na tela de entrada abre em outra janela.
- `0.2.0+950d6418` (anterior) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-950d6418
  (`BarDoGuto-Instalador-0.2.0-950d6418.exe`). Com a **logo do Bar do Guto** (app, ícones do Windows e do
  celular, topo da nota) e a **nota não fiscal para cobrar**. Capturas em `evidencias/logo/`.
- `0.2.0+19529aeb` (anterior, sem a logo) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-19529aeb
  (`BarDoGuto-Instalador-0.2.0-19529aeb.exe`). Inclui a **nota não fiscal para cobrar** (conta com QR Pix e
  nota de pagamento com troco) — ver [NOTA-NAO-FISCAL.md](NOTA-NAO-FISCAL.md). Mesmo aplicativo sem janela preta
  da versão abaixo.
- `0.2.0+39ab4c62` (anterior, sem a nota) — https://github.com/glzada240hz-commits/Loja/releases/tag/loja-0.2.0-39ab4c62
  (`BarDoGuto-Instalador-0.2.0-39ab4c62.exe`, ~50 MB). **Funciona como aplicativo** (sem janela preta): tela de
  primeira abertura, janela própria, ícone perto do relógio.
- Teste automático no Windows (GitHub Actions, `windows-latest`): o `BarDoGuto.exe` é aplicativo de janela
  (não de console); primeira abertura, login do admin, ausência de usuários de demonstração, abertura de dia e
  caixa, pedido, interface; abrir de novo não duplica o sistema; a senha não aparece no registro; **encerramento
  seguro** (banco parado, nenhum processo restante); reabertura com o pedido mantido e cópia de segurança.
- **Não testado por automação** (precisa de uma pessoa na tela): a aparência da tela de primeira abertura, do
  “Abrindo…”, do ícone perto do relógio e da janela do Edge. Foram escritos para o Windows 10/11, mas eu não
  os vi funcionando numa tela real.
- Versão anterior, com janela preta: `0.2.0+5f06d2af` (substituída).

## Instalar

1. Baixe `BarDoGuto-Instalador-<versão>.exe` (Releases do GitHub) e execute.
   - O instalador **não é assinado digitalmente**: o Windows mostra “O Windows protegeu o computador” →
     **Mais informações → Executar assim mesmo**.
   - Não pede senha de administrador do Windows (instala para o usuário atual).
2. Marque “Criar atalho na Área de Trabalho” e, se quiser, “Abrir quando o Windows iniciar”.
3. Na primeira abertura aparece a tela **“Bem-vindo ao Bar do Guto”**: crie a **senha do admin** (guarde!)
   e marque se quer o cardápio de exemplo (preços demonstrativos — revise todos).
4. Se o Firewall perguntar, marque **Redes privadas → Permitir** (para os celulares e tablets acessarem).
5. O sistema abre na **própria janela** (sem barra de endereço). Entre como `admin` e cadastre os usuários reais
   (caixa, atendentes, cozinha, entregadores) em **Ajustes → Usuários**, as mesas, bairros e o cardápio.

## No dia a dia

- Abra o **Bar do Guto** pelo atalho. Ele funciona como um aplicativo comum: **não há janela preta**.
  Enquanto abre, aparece uma tela “Abrindo…”; depois o sistema abre em janela própria e fica um **ícone
  perto do relógio** (pode estar na setinha ^ da barra de tarefas).
- Fechar a janela do sistema **não desliga** o Bar do Guto (os celulares e a cozinha continuam). Para voltar,
  clique no atalho de novo ou duas vezes no ícone perto do relógio.
- **Fim do dia**: botão direito no ícone → **Encerrar o Bar do Guto** (encerra o banco com segurança).
  Desligar o Windows com ele aberto também encerra com segurança.
- Celulares e tablets: botão direito no ícone → o endereço `http://192.168…:3000` aparece no menu (clique
  para copiar). Abra-o no navegador do celular conectado ao Wi-Fi da loja.
- Cópias de segurança: `%LOCALAPPDATA%\BarDoGuto\loja\copias-de-seguranca` (atalho no menu Iniciar).
  Copie essa pasta para um pendrive ou nuvem toda semana.
- Atualizar: instale a versão nova por cima. Os dados continuam. Confira a versão em **(i) Sobre**.

## Por dentro (para suporte)

- `BarDoGuto.exe` é um aplicativo de janela do Windows (não de console). Ele executa, **escondido**, o
  servidor do sistema com o Node.js que vai **dentro do pacote** (`runtime\node.exe`) — a loja não instala
  Node nem vê janela dele; é o mesmo que outros aplicativos fazem ao levar o próprio motor embutido.
- A janela do sistema é o Microsoft Edge (que já vem no Windows) em **modo aplicativo**, com perfil próprio em
  `%LOCALAPPDATA%\BarDoGuto\janela`; sem Edge, usa o Chrome; sem os dois, o navegador padrão.
- Registro de funcionamento: `%LOCALAPPDATA%\BarDoGuto\loja\registros\AAAA-MM-DD.txt` (30 dias; sem
  senhas) — também no menu do ícone.
- A senha da primeira abertura vai ao sistema por variável de ambiente, nunca por linha de comando nem
  registro.
- `BarDoGuto.exe --encerrar` encerra com segurança a cópia aberta (usado pelo instalador antes de atualizar ou
  desinstalar).

## Restaurar uma cópia de segurança

1. Encerre o Bar do Guto (botão direito no ícone perto do relógio → Encerrar).
2. Renomeie `%LOCALAPPDATA%\BarDoGuto\loja\banco` para `banco-antigo`.
3. Copie a pasta da cópia desejada (ex.: `copias-de-seguranca\2026-11-02-19-09`) para
   `%LOCALAPPDATA%\BarDoGuto\loja\banco`.
4. Abra o Bar do Guto. (O arquivo `configuracao.json` da mesma pasta precisa ser o do mesmo computador.)

## Limites desta forma de instalação

- **Sem HTTPS**: o tráfego na rede local não é criptografado. Use Wi-Fi com senha (WPA2/WPA3) e uma rede
  separada para clientes. O app do atendente funciona no navegador do celular, mas não instala como app.
  Para HTTPS siga `OPERACAO.md` (servidor com domínio).
- Comprovantes **não são documento fiscal**; WhatsApp em modo **demonstrativo**.
- Um único computador da loja roda o sistema (os outros aparelhos acessam por ele). Se ele desligar, ninguém
  lança pedido.
- Instalador sem assinatura digital (aviso do SmartScreen). Assinar exige certificado pago — não contratado.
