# Arquitetura

## Visão geral

- **Monorepo npm** com três pacotes: `packages/core` (regras puras, sem dependências), `apps/server`
  (API) e `apps/web` (interface).
- **Servidor**: Node.js 22, Fastify 5, Drizzle ORM sobre PostgreSQL. Um único processo serve a API,
  os webhooks, os arquivos da interface e as fotos dos produtos.
- **Interface**: React 19 + React Router + TanStack Query, PWA (vite-plugin-pwa). O service worker guarda
  **apenas a interface**; os dados vêm sempre do servidor.
- **Tempo real**: Server-Sent Events (`/api/events`). Os eventos carregam só identificadores; cada
  dispositivo recarrega os dados pela API (que aplica as permissões do perfil). Eventos só são publicados
  **depois do COMMIT** da transação.
- **Banco**: migrations versionadas em `apps/server/migrations` (geradas pelo drizzle-kit a partir de
  `src/db/schema.ts`) e aplicadas automaticamente na inicialização.

Escolha por simplicidade operacional: uma lanchonete precisa de um servidor e um banco; não há fila
externa, Redis ou microsserviços. A limitação conhecida é que o tempo real assume **uma única instância**
do servidor (ver PENDENCIAS.md).

## Regras centrais

### Dinheiro
Todo valor é **inteiro em centavos** (`integer` no banco, `number` inteiro no código). Percentuais em
pontos-base (10% = 1000). O cálculo oficial está em `packages/core/src/pricing.ts` e é executado no
servidor; o navegador mostra só uma prévia. Ao criar/alterar itens o servidor:
1. relê o cardápio atual (preço, disponibilidade, regras de adicionais) — preços enviados pelo navegador
   são ignorados;
2. grava um **retrato** do item (nome, tamanho, preço, adicionais, custo) — mudanças futuras no cardápio
   não alteram pedidos antigos;
3. recalcula o total e **confere** a soma de cada item contra o recálculo (inconsistência aborta a operação).

Desconto incide só sobre os itens; a taxa de entrega é separada e nunca recebe desconto. Quantidades de
estoque usam `numeric(14,3)` e aritmética em milésimos (`BigInt`).

### Dia operacional
`business_days` tem no máximo um registro aberto (índice único parcial). Pedidos, caixa e numeração
pertencem ao dia aberto, **independentemente da data do calendário**: um pedido às 00h30 continua no turno
aberto às 18h do dia anterior. A numeração visível (`#1, #2…`) reinicia a cada dia e é reservada com
`UPDATE ... RETURNING` (sem números repetidos sob concorrência); o identificador interno é um UUID.
Fechar o dia exige todos os pedidos finalizados/cancelados e o caixa fechado. Relatórios filtram pela data
de referência do dia operacional; horários usam `America/Sao_Paulo`.

### Pedido
- Situação: `pending` (cardápio digital, aguardando aceite) → `open` → `closed`; `cancelled` a partir de
  pending/open; `closed → open` só por **reabertura** autorizada (e só enquanto o dia estiver aberto).
- Etapa (o que o cliente acompanha): `received → preparing → ready → out_for_delivery → delivered`,
  derivada dos **tickets de cozinha**. Cada envio de itens cria um ticket (rodada) — uma comanda de mesa
  pode ter várias rodadas. Cancelamentos após o envio marcam o ticket como alterado.
- Itens de categorias que não vão para a cozinha (bebidas) são lançados sem ticket.
- **Concorrência**: toda edição envia a `version` lida; se outro dispositivo alterou antes, a API responde
  `409 stale_version` e a interface pede para recarregar — nada é sobrescrito silenciosamente.
- **Duplicidade**: pedido igual (mesmo telefone ou mesa e mesmos itens) dentro da janela configurada gera
  alerta `possible_duplicate`; o operador pode confirmar e registrar mesmo assim.
- **Idempotência**: criação de pedido, pagamento, sangria/suprimento, acerto de entregador, mensagens e
  checkout público aceitam `Idempotency-Key`. A chave é gravada **na mesma transação** da operação:
  repetições concorrentes esperam a primeira e recebem a mesma resposta.
- **Histórico**: `order_events` registra cada mudança com usuário e, quando houver, o gerente que autorizou.
  Ações administrativas também vão para `audit_logs`.

### Atendentes, mesas e comandas
- Perfil `waiter` (Atendente). Pedido de mesa tem `tab_kind` (`table` = mesa, `tab` = comanda) e
  `table_label`. Índice único parcial `orders_open_place` garante **uma comanda aberta por mesa/comanda**
  mesmo com dois aparelhos abrindo ao mesmo tempo.
- Cada rodada (`kitchen_tickets`) registra quem a lançou (`created_by`) e quando foi levada à mesa
  (`served_at/served_by`). Todas as rodadas entregues ⇒ etapa “entregue”.
- Acréscimo (`POST /api/orders/:id/items`) não exige versão (só acrescenta) e é idempotente pela chave
  `Idempotency-Key` calculada sobre os itens — reenvio após queda devolve a resposta original.
- `POST /api/orders/:id/request-bill` gera o evento `bill.requested` para o caixa.
- Presença: `POST /api/presence` (sinal a cada 15 s) + conexão SSE identificada por aparelho;
  sem sinal por 45 s ou conexão encerrada ⇒ “sem conexão” e evento `presence.changed`.

### Pagamentos e caixa
- Pagamento exige caixa aberto; registra a forma, o valor aplicado, o valor entregue e o troco. Cartão/Pix
  não aceitam valor acima do saldo; dinheiro calcula troco (`cashPayment`).
- **Venda ≠ recebimento**: o pedido pode ser fechado como **conta pendente** (com autorização) e recebido
  depois, inclusive em outro caixa.
- Cada pagamento gera um movimento de caixa; estornos geram movimento negativo (índice único impede
  lançamento duplicado do mesmo pagamento/estorno).
- Dinheiro esperado = soma dos movimentos em espécie (fundo + recebimentos − estornos + suprimentos −
  sangrias − repasses/despesas pagos). O perfil caixa faz **conferência cega** (não vê o esperado antes de
  fechar). Divergência exige justificativa.
- **Pix manual** é registrado pelo operador após conferir o extrato; **Pix integrado** não está
  disponível (recusado pela API) até haver um provedor configurado. Comprovante enviado pelo cliente
  nunca confirma pagamento. Nenhum dado de cartão é armazenado.

### Cancelamento e estoque
- A venda baixa o estoque pela **ficha técnica** (variante, adicionais e componentes de combo) no momento
  em que o item é lançado. Um índice único `(origem, item, insumo, tipo)` impede baixa duplicada.
- Cancelamento (de item ou pedido): itens cujo ticket ainda não começou **voltam ao estoque**; itens em
  preparo/prontos geram estorno da venda + registro de **perda** (o estoque físico não volta). O operador
  pode escolher explicitamente.
- Pedido com pagamentos só é cancelado com estorno explícito (no caixa aberto).

### Entregas
Pedidos de delivery são agrupados manualmente em **saídas** (`delivery_runs`) por entregador. A saída só
parte com todos os pedidos prontos. Estados: aguardando → em rota → entregue / ocorrência (→ volta à loja).
A **taxa cobrada do cliente** (bairro) é separada do **repasse ao entregador** (do bairro ou padrão do
entregador). Acerto: repasses + bônus − descontos, opcionalmente pago com dinheiro do caixa, com proteção
contra acerto duplo. Distâncias e rotas não são calculadas; o sistema só oferece link de navegação.

### Segurança
- Senhas com scrypt + sal; bloqueio temporário após 5 falhas; limite de tentativas por IP.
- Sessão em cookie `HttpOnly`, `SameSite=Lax` (e `Secure` com HTTPS); token guardado apenas como hash.
- Mutação exige cabeçalho `X-Requested-With: guto` (proteção CSRF); CSP restritiva via Helmet.
- Permissões verificadas **no servidor** em todas as rotas (`packages/core/src/permissions.ts`).
- Validação de entrada com Zod; logs com cabeçalhos sensíveis ocultados; CSV exportado neutraliza fórmulas.
- Entregador só enxerga as entregas atribuídas a ele; o rastreio público usa token aleatório de 144 bits e
  não expõe endereço completo nem dados de outros pedidos.

### WhatsApp
Ver [WHATSAPP.md](WHATSAPP.md). Resumo: webhook com assinatura HMAC, eventos deduplicados e reprocessados,
fila de saída (outbox) com tentativas e espera crescente, notificações criadas **dentro da transação** do
evento confirmado, janela de 24h e templates, opt-in/opt-out e atendimento automático por regras fixas.

## Modelo de dados (principais tabelas)

`users, sessions, settings, audit_logs, idempotency_keys, business_days, cash_sessions, cash_movements,
neighborhoods, customers, customer_addresses, categories, products, product_variants, option_groups,
options, product_option_groups, combo_items, stock_items, recipe_items, stock_movements, couriers,
delivery_runs, courier_adjustments, courier_settlements, orders, order_items, order_item_options,
kitchen_tickets, order_events, payments, expenses, wa_contacts, wa_messages, wa_webhook_events,
quick_replies, wa_templates` — definidas em `apps/server/src/db/schema.ts`.
