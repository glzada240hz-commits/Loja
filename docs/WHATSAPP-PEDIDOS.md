# Pedidos do WhatsApp e acréscimos

## Pedido que chegou pelo WhatsApp → cozinha

No **app do atendente** (celular), aba **WhatsApp** (barra de baixo), ou no computador em
**WhatsApp → Lançar pedido do WhatsApp**:

1. **Novo pedido do WhatsApp**: Retirada ou Entrega (com endereço e bairro), telefone e nome do cliente
   (cliente já cadastrado é preenchido pelo telefone quando quem lança tem acesso a clientes).
2. **Produtos**: igual às mesas — “sem …” e **acréscimos** (em verde).
3. Pagamento previsto (dinheiro com troco, Pix, cartão) e observação.
4. **Enviar**: o pedido entra **direto na cozinha** (impressora/tela), com origem **WhatsApp** e o nome do
   atendente; aparece no caixa para receber e em Entregas, se for entrega.
5. **Avisar no WhatsApp**: abre o WhatsApp do aparelho com a conversa do cliente e o resumo pronto (itens,
   total, retirada/entrega, previsão). A pessoa só confere e toca em enviar.

Lista **Pedidos do WhatsApp** mostra os do dia com a situação e o botão de avisar de novo.

### O que não é automático (e por quê)

As mensagens **não chegam sozinhas** ao sistema nem saem sem alguém tocar em enviar. Para isso é preciso a
**WhatsApp Business Platform (Cloud API) da Meta**: conta empresarial verificada, número dedicado e cobrança
por conversa, contratados pela loja. O sistema já tem a integração preparada (Ajustes → WhatsApp; hoje em
modo demonstrativo), mas não contratei nem ativei nada — é decisão e custo da loja. O lançamento acima
funciona sem ela, com o WhatsApp que a loja já usa.

## Delivery: bairro, total e pagamento dividido

- **Bairros e taxas** (menu lateral, ou Ajustes → Bairros e taxas): o dono cadastra cada bairro da região com
  a **taxa cobrada do cliente** (e, se quiser, o repasse ao motoboy, pedido mínimo e previsão). Desmarcar
  “Atendemos este bairro” tira da lista. Os bairros de exemplo (Centro, Vila Nova, Jardim das Flores) devem ser
  editados ou desmarcados.
- No pedido de **Entrega**: primeiro o **bairro** (mostra a taxa), depois a **rua** (sugere as ruas já usadas
  naquele bairro) e o número. O quadro **Total** mostra itens + taxa = total, o que já foi pago, o que falta e o
  troco.
- **Pagamento dividido**: toque nas formas (+ Dinheiro, + Pix, + débito…) e ajuste o valor de cada uma; o
  sistema avisa “Falta definir R$ …” ou “Combinado”. Quem pode receber (caixa, gerente, admin) marca **já pago**
  (ex.: Pix enviado antes) — entra no caixa na hora. O troco é calculado só sobre a parte em dinheiro.
- O combinado aparece no pedido do caixa, em Entregas, no celular do motoboy, na nota e no resumo do WhatsApp.
  No **Receber** do caixa há botões com cada parte combinada; registre uma parte e a janela continua com o resto.

## Ler o print da conversa

No pedido do WhatsApp (celular do atendente) e no caixa (entrega ou retirada): **Ler print da conversa** → escolha
a imagem (no computador, dá para colar com Ctrl+V). O sistema lê o texto **no próprio aparelho** (sem serviço
externo, sem custo; os arquivos do leitor ficam no sistema e só carregam na primeira leitura) e preenche o que
estiver vazio: nome (cabeçalho da conversa), telefone (contato não salvo), endereço, bairro/taxa. Mostra os
itens do cardápio citados (**Adicionar ao pedido**) e os valores em R$ da conversa para comparar com o total.
É uma sugestão: **confira** antes de enviar (acréscimos e observações não são lidos). Captura em
[`evidencias/print/`](evidencias/print/).

## Telefone opcional e molho verde

- Pedido de entrega lançado pela equipe **não exige telefone** (só o nome). Sem telefone, o botão “Avisar no
  WhatsApp” não aparece: responda pela própria conversa. O cardápio digital continua exigindo telefone.
- Na entrega, a escolha **Com molho verde / Sem molho verde** é obrigatória e sai em destaque na comanda.

## Numeração: loja e entrega separadas

Mesa e balcão seguem **#1, #2, #3…**; entregas seguem **Entrega 1, 2, 3…** (cada uma recomeça ao abrir o dia).
A comanda da entrega mostra só “ENTREGA N” (sem o número da loja), e o mesmo número aparece na cozinha, na
expedição, no entregador, em Pedidos e nas mensagens ao cliente (“pedido de entrega nº N”). Pedido do cardápio
digital ganha o número quando chega. Mudar um pedido de balcão para entrega (ou o contrário) troca para o
próximo número da outra sequência.

## Endereço: colar e buscar o bairro

- **Colar endereço do cliente**: cole o endereço como o cliente mandou no WhatsApp (uma linha ou várias). O sistema
  separa rua, número, complemento (apto, casa, bloco…) e ponto de referência (perto, próximo, em frente…) e
  **identifica o bairro**, já com a taxa. Aparece “Bairro identificado: … (taxa …)”; confira os campos. Colar o
  endereço inteiro direto no campo **Rua** faz o mesmo.
- **Bairro com busca**: digite parte do nome, sem acento (“sao jud”, “marti”); a lista mostra a taxa de cada um.
- Se o texto cita dois bairros (ex.: “Rua Santo Antônio, 50 - Centro”), vale o que vem depois; “bairro X” escrito
  por extenso tem prioridade.

## Comanda da cozinha com o endereço (vai com o motoboy)

Em pedidos de entrega, a via da cozinha traz, no fim: **ENTREGA**, o bairro em letra grande, rua/número/
complemento, referência, nome e telefone do cliente e **o que cobrar** (ex.: “COBRAR R$ 41,90 — dinheiro · troco
p/ R$ 50,00 (levar R$ 8,10)” ou “PAGO — nada a cobrar”).

**2ª via** (perdeu a comanda): botão **2ª via** no cartão da Cozinha (e na lista de prontos), ícone de impressora
no cartão da Expedição e, no detalhe do pedido, menu → “2ª via da comanda”. Sai na impressora da cozinha com
o título “2ª VIA (REIMPRESSÃO)”, mesmo se o pedido já estiver pronto. Com o aplicativo da loja e a impressora
da cozinha escolhida, imprime direto nela; senão vai para o computador que imprime a cozinha pelo navegador.
Capturas em [`evidencias/endereco/`](evidencias/endereco/).

## Nº da entrega (para marcar a sacola)

Cada entrega do dia ganha um número próprio, em sequência: **1, 2, 3…** (recomeça quando abre o dia). Pedido do
cardápio digital só ganha número quando a loja aceita; mesa e balcão não usam. O número aparece:
- na **via da cozinha** em letra grande (“ENTREGA 3 — escreva 3 na sacola · pedido #12”);
- no cartão da **Cozinha** e na lista de prontos, com o ícone de sacola;
- na **Expedição** (Entregas), na tela do **entregador**, em **Pedidos**, no detalhe do pedido e na nota do cliente;
- no celular, logo após enviar uma entrega pelo atendente.

Quando o entregador sai com várias, a sacola marcada bate com o número da tela dele. Capturas em
[`evidencias/sacola/`](evidencias/sacola/).

## Balcão (para levar) pelo celular

Aba **Balcão** no app do atendente: cliente na loja que vai levar (sem mesa). **Novo pedido para levar** →
produtos (com acréscimos e “sem”) → nome para chamar (opcional) → **Enviar**: sai na cozinha na hora; o cliente
paga no caixa e retira quando ficar pronto. A lista mostra os pedidos para levar do dia (o atendente vê os
dele).

## Acréscimos (pagos, em verde)

**Cardápio → Adicionais → Acréscimos**: nome e preço de cada um (ex.: Bacon R$ 4,00) e em quais categorias
aparecem (padrão: Hambúrgueres). **Salvar acréscimos** coloca em todos os produtos dessas categorias de uma
vez. Na escolha do lanche (PDV, mesas, celular, WhatsApp) aparecem **primeiro, em verde**, com “+ R$”, e o
“Retirar ingredientes” logo abaixo. O preço entra no total; a cozinha vê “+ Bacon”.

## Validação

- Integração: atendente lança pedido do WhatsApp (vai aberto para a cozinha, origem WhatsApp, exige nome e
  telefone); acréscimos em todos os lanches da categoria, primeiro grupo, preço no total.
- E2E (celular): gerente cadastra “Bacon R$ 4,00”; atendente abre WhatsApp → novo pedido → X-Tudo com Bacon
  (verde) e Sem milho → envia (R$ 25,90) → link “Avisar no WhatsApp” para wa.me/55319… com o resumo; cozinha
  recebe com “Bacon” e “Sem milho”.
- Capturas em [`evidencias/whatsapp/`](evidencias/whatsapp/).
- Não testado: abrir o WhatsApp de verdade num celular (o link wa.me depende do aparelho).
