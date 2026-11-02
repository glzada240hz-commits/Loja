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

## Instalar

1. Baixe `BarDoGuto-Instalador-<versão>.exe` (Releases do GitHub) e execute.
   - O instalador **não é assinado digitalmente**: o Windows mostra “O Windows protegeu o computador” →
     **Mais informações → Executar assim mesmo**.
   - Não pede senha de administrador do Windows (instala para o usuário atual).
2. Marque “Criar atalho na Área de Trabalho” e, se quiser, “Abrir quando o Windows iniciar”.
3. Na primeira abertura: crie a **senha do admin** (guarde!) e escolha se quer o cardápio de exemplo
   (preços demonstrativos — revise todos).
4. Se o Firewall perguntar, marque **Redes privadas → Permitir** (para os celulares e tablets acessarem).
5. O navegador abre em `http://localhost:3000`. Entre como `admin` e cadastre os usuários reais
   (caixa, atendentes, cozinha, entregadores) em **Ajustes → Usuários**, as mesas, bairros e o cardápio.

## No dia a dia

- Abra o **Bar do Guto** pelo atalho e deixe a janela preta aberta. Feche-a no fim do dia.
- Celulares e tablets: no Wi-Fi da loja, abra o endereço `http://192.168…:3000` mostrado na janela.
- Cópias de segurança: `%LOCALAPPDATA%\BarDoGuto\loja\copias-de-seguranca` (atalho no menu Iniciar).
  Copie essa pasta para um pendrive ou nuvem toda semana.
- Atualizar: instale a versão nova por cima. Os dados continuam. Confira a versão em **(i) Sobre**.

## Restaurar uma cópia de segurança

1. Feche o Bar do Guto.
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
