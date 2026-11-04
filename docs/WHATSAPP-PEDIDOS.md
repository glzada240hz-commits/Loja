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
