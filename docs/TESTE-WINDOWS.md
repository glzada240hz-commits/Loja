# Testar no computador e no celular (Windows)

Este roteiro sobe o Bar do Guto **no seu computador Windows** em modo de testes:

- banco de dados **separado**, guardado em `%LOCALAPPDATA%\BarDoGuto\teste` (fora da pasta do projeto,
  para que baixar uma versão nova não apague seus testes; não toca em nenhum banco real);
- **dados fictícios** (cardápio demonstrativo, usuários de teste);
- WhatsApp em modo **demonstrativo** (nenhuma mensagem é enviada a ninguém);
- um **link HTTPS gratuito** para abrir no celular, criado pelo *Cloudflare Quick Tunnel* (sem conta,
  sem cartão, sem custo).

Nada é contratado e nenhum dado real é usado.

## 1. Preparar (uma vez só)

1. **Instale o Node.js**: abra <https://nodejs.org>, baixe a versão **LTS** (botão verde) e instale
   clicando em *Avançar* até o fim. Não precisa marcar nada extra.
2. **Baixe o projeto**: abra
   <https://github.com/glzada240hz-commits/Loja/tree/claude/gallant-hopper-i7t3xm>, clique no botão verde
   **Code** → **Download ZIP**.
3. Na pasta *Downloads*, clique com o botão direito no ZIP → **Extrair tudo…** → *Extrair*.
   Dica: extraia para uma pasta curta, como `C:\BarDoGuto`.

## 2. Iniciar

1. Abra a pasta extraída e dê **dois cliques em `iniciar-teste.bat`**.
   - Se aparecer “O Windows protegeu o computador”, clique em **Mais informações → Executar assim mesmo**.
   - Se o **Firewall do Windows** perguntar, marque **Redes privadas** e clique em **Permitir acesso**.
2. Na primeira vez ele instala as dependências, compila o sistema e baixa o `cloudflared` (alguns
   minutos, precisa de internet). Nas próximas vezes só recompila se o código tiver mudado.
3. Quando terminar, a janela mostra um quadro como este:

```
  Neste computador:   http://localhost:3000
  Celular e qualquer aparelho (HTTPS):
      https://palavras-aleatorias.trycloudflare.com
  Celular na mesma rede Wi-Fi (sem HTTPS):
      http://192.168.0.10:3000
```

4. **Deixe essa janela aberta** enquanto testa. Fechar a janela (ou `Ctrl+C`) desliga o sistema; os dados
   ficam guardados. Se tentar abrir uma segunda vez com a primeira aberta, ele avisa e não duplica nada.

O endereço `https://….trycloudflare.com` é o **link para o celular** (funciona no 4G também). Ele muda a
cada vez que você inicia — use sempre o que aparece na janela. No computador, use o mesmo link ou
`http://localhost:3000`.

> O dia operacional e o caixa já ficam abertos (fundo de troco R$ 100,00), prontos para lançar pedidos.
> Os dados ficam guardados entre uma execução e outra.

### Arquivos de dois cliques

| Arquivo | Para quê |
|---|---|
| `iniciar-teste.bat` | Abre o sistema de testes (instala/atualiza e recompila sozinho quando precisa). |
| `zerar-dados-teste.bat` | **Apaga** os pedidos e dados de teste e recomeça do zero. Pede para digitar `ZERAR`. Feche antes a janela do iniciar. |
| `atualizar-teste.bat` | Explica/abre o download da versão nova (ou usa `git pull` se a pasta veio do Git). Não apaga dados. |

### Atualizar para uma versão nova sem perder os dados de teste

1. Feche a janela do `iniciar-teste.bat`.
2. Baixe o ZIP novo (mesmo link do passo 1.2), extraia numa pasta nova e dê dois cliques no
   `iniciar-teste.bat` dessa pasta nova.
3. Ele percebe a mudança, instala o que for preciso, recompila e **usa os mesmos dados de teste**
   (eles ficam em `%LOCALAPPDATA%\BarDoGuto\teste`). A pasta antiga pode ser apagada.
4. No celular, se aparecer “Nova versão do sistema disponível”, toque em **Atualizar agora** (o rascunho do
   atendente é mantido).

## 3. Usuários de teste

Senha de todos: **`demo1234`**

| Usuário | Perfil | Tela inicial |
|---|---|---|
| `caixa` | Caixa | PDV, Mesas e comandas, receber e fechar contas |
| `atendente1` | Atendente (Ana) | App do atendente |
| `atendente2` | Atendente (Beto) | App do atendente (segundo celular) |
| `cozinha` | Cozinha | Painel da cozinha |
| `gerente` | Gerente | Tudo da loja; autoriza descontos e cancelamentos |
| `admin` | Administrador | senha **`admin-teste-123`** |

Todos são fictícios e só existem neste banco de testes.

## 4. Cada tela

Abra o link e entre com o usuário — cada perfil cai direto na sua tela.

- **Caixa (computador)**: entre como `caixa`. Menu lateral → **Mesas e comandas** mostra as mesas
  ocupadas, quem lançou, valor, andamento da cozinha e os avisos de “pediu a conta”. Clique na mesa para
  ver os itens, **Receber** e **Finalizar**. O **PDV** lança pedidos de balcão/viagem/entrega.
- **Atendente (celular)**: entre como `atendente1`. Toque numa **Mesa** (ou na aba *Comandas*) →
  **+ Adicionar produtos** → escolha o lanche, adicionais e observação → **Conferir e enviar** →
  **Enviar para a cozinha**. Só aparece “✓ Recebido pelo servidor” quando o servidor confirmou.
  Depois: **Entregue na mesa** e **Pedir a conta**.
- **Cozinha (tablet ou outra aba)**: entre como `cozinha`. Cada envio aparece como um cartão com mesa,
  atendente, horário, adicionais e observações em destaque. **Iniciar preparo** → **Pronto**.
  Acréscimos chegam como cartão “ACRÉSCIMO”.
- **Cardápio digital do cliente**: endereço do link + `/c` (ex.:
  `https://….trycloudflare.com/c`). Não precisa de login.

Para usar vários perfis no **mesmo computador**, abra cada um numa janela anônima diferente
(`Ctrl+Shift+N` no Chrome/Edge) ou em navegadores diferentes — cada login fica numa janela.

### Teste sugerido (3 aparelhos)

1. Computador: `caixa` em **Mesas e comandas**. Outra janela anônima: `cozinha`.
2. Celular: `atendente1` → Mesa 8 → X-Bacon com cheddar e “sem cebola” + refrigerante → enviar.
3. Sem recarregar: o caixa vê a Mesa 8 ocupada com o valor; a cozinha vê o X-Bacon (a bebida não vai
   para a cozinha).
4. Cozinha: **Iniciar preparo** → **Pronto**. O celular mostra “Pronto”; toque **Entregue na mesa**.
5. Celular: **Pedir a conta** → o caixa recebe o aviso → abre a mesa → **Receber** → **Finalizar**.
6. Teste de queda: ative o **modo avião** no celular e tente enviar um acréscimo — aparece “Envio não
   confirmado”, nunca “recebido”, e o caixa é avisado que o aparelho ficou sem conexão. Desative o modo
   avião e toque **Reenviar**: o item entra uma única vez.

## 5. Colocar o app do atendente na tela inicial do celular

Use o **link HTTPS** (o de `trycloudflare.com`) — a instalação como app exige HTTPS.

**Android (Chrome)**
1. Abra o link no Chrome e entre como `atendente1`.
2. Toque no menu **⋮** (canto superior direito) → **Instalar app** (ou **Adicionar à tela inicial**) →
   **Instalar**.
3. O ícone “Bar do Guto” aparece na tela inicial e abre em tela cheia, já no app do atendente.

**iPhone (Safari)**
1. Abra o link no **Safari** e entre como `atendente1`.
2. Toque no botão **Compartilhar** (quadrado com seta para cima) → **Adicionar à Tela de Início** →
   **Adicionar**.

Importante: como o link de teste muda a cada execução, o ícone instalado aponta para o link daquele dia.
Ao reiniciar o teste com um novo link, apague o ícone antigo e instale de novo. Em produção, com um
endereço fixo (ver OPERACAO.md), isso não acontece.

## 6. Se algo der errado

| Sintoma | O que fazer |
|---|---|
| “O Node.js não está instalado” | Instale o Node.js LTS (passo 1) e abra o `.bat` de novo. |
| Não aparece o link HTTPS | A internet bloqueou o download do `cloudflared` ou o túnel. O sistema funciona em `http://localhost:3000` e no Wi-Fi (endereço `http://192.168…`). Tente iniciar de novo; se persistir, baixe manualmente `cloudflared-windows-amd64.exe` em <https://github.com/cloudflare/cloudflared/releases/latest>, renomeie para `cloudflared.exe` e coloque em `%LOCALAPPDATA%\BarDoGuto\teste` (cole esse caminho na barra do Explorador de Arquivos). |
| O celular no Wi-Fi não abre o `http://192.168…` | Permita o Node.js no Firewall do Windows (Redes privadas) e confirme que o celular está no mesmo Wi-Fi. Prefira o link HTTPS. |
| Erro de porta 3000 em uso | Feche outras janelas do teste. Ou rode `set PORT=3001` e depois `node scripts\ambiente-teste.mjs --tunel` no Prompt de Comando, na pasta do projeto. |
| “O sistema de testes já está aberto em outra janela” | Use a janela que já está aberta, ou feche-a e abra de novo. |
| “Node.js … é antigo demais” | Instale o Node.js LTS atual em <https://nodejs.org> e abra o `.bat` de novo. |
| Erro ao iniciar o PostgreSQL (`VCRUNTIME140.dll`) | Instale o “Microsoft Visual C++ Redistributable” x64 (gratuito, site da Microsoft) e tente de novo. |

## Limites deste modo de teste

- O link `trycloudflare.com` é **temporário**: só funciona com a janela aberta e o computador ligado,
  e muda a cada início. A Cloudflare não oferece garantia de disponibilidade para esse modo gratuito.
- Quem tiver o link consegue ver a tela de login e o cardápio digital — não compartilhe fora da equipe
  de teste. Os usuários e senhas acima são públicos (estão neste documento): **não use em produção**.
- Não é instalação de produção: para a loja de verdade siga OPERACAO.md (servidor com HTTPS fixo,
  senhas próprias, backup).
