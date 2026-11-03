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
