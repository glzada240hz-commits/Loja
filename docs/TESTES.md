# Testes e evidências

Última execução completa: ver [`evidencias/execucao-testes.txt`](evidencias/execucao-testes.txt)
(saída real dos comandos) e as capturas de tela em [`evidencias/`](evidencias/).

| Verificação | Resultado |
|---|---|
| `npm run typecheck` (core, servidor, web) | sem erros |
| `npm run lint` (ESLint + typescript-eslint + react-hooks) | sem erros/avisos |
| `npm run build` (Vite/PWA + esbuild do servidor) | ok |
| Testes unitários | **24/24** passaram |
| Testes de integração (PostgreSQL real) | **44/44** passaram |
| Testes de ponta a ponta (Chromium real, servidor de produção compilado) | **18/18** passaram |

## Tipos de teste — o que é real e o que é simulado

- **Unitários** (`packages/core/test`, `apps/server/test/unit`): funções puras. Sem banco.
- **Integração** (`apps/server/test/integration`): aplicação Fastify completa via `inject`, com
  **PostgreSQL real** (`guto_test`), migrations, transações e índices reais. O relógio é simulado nos
  testes que precisam de horário controlado (meia-noite, janelas de 24 h). O backup/restauração usa
  `pg_dump`/`pg_restore` reais.
- **WhatsApp**: os testes usam uma **Graph API simulada** (respostas HTTP programadas, verificando URL,
  token, corpo e templates) e o provedor demonstrativo. **Não houve comunicação com a Meta**; isso não
  substitui a validação real descrita em WHATSAPP.md.
- **E2E** (`e2e/full-flow.spec.ts`): Playwright com Chromium contra o servidor compilado (`node
  apps/server/dist/main.js`) e banco `guto_e2e` recriado a cada execução. Vários contextos de navegador
  simulam dispositivos diferentes (caixa no desktop, cozinha no tablet, cliente e entregador no celular).
- **Inspeção visual**: capturas em desktop (1366 px), tablet (1024 px) e celular (390 px) das telas
  principais. Problemas encontrados e corrigidos: botão de menu aparecendo no desktop, coluna da cozinha
  sem altura total, botão “Pronto” cortado no ticket, cards desalinhados em grade, grupos de botões dentro
  de `<label>` (acessibilidade — encontrado pelo E2E).

## Mapa dos 16 cenários obrigatórios

| # | Cenário | Onde | Tipo |
|---|---|---|---|
| 1 | Pedido com vários itens, adicionais e observações | `orders.test.ts › 1.` · E2E “cliente monta o pedido” | integração + E2E |
| 2 | Entrega, desconto e cálculo do total | `orders.test.ts › 2.` · `pricing.test.ts` | integração + unit |
| 3 | Pagamento dividido e troco | `orders.test.ts › 3.` · E2E “caixa recebe com troco” | integração + E2E |
| 4 | Cancelamento e efeitos em caixa e estoque | `orders.test.ts › 4.` | integração |
| 5 | Dia operacional após a meia-noite | `day.test.ts › 5.` | integração (relógio simulado) |
| 6 | Pedido até a cozinha e a entrega | `delivery.test.ts` · E2E completo | integração + E2E |
| 7 | Atribuição e acerto de entregador | `delivery.test.ts` (bônus, desconto, acerto duplo bloqueado) | integração + E2E |
| 8 | Alteração de preço sem afetar pedidos antigos | `orders.test.ts › 8.` | integração |
| 9 | Cliques repetidos e requisições duplicadas | `orders.test.ts › 9.` · E2E “clique duplo” | integração + E2E |
| 10 | Webhooks repetidos, inválidos e fora de ordem | `whatsapp.test.ts › 10.` | integração (Graph API simulada) |
| 11 | Falha de integração e recuperação | `whatsapp.test.ts › 11.` | integração (Graph API simulada) |
| 12 | Acesso proibido entre perfis | `security.test.ts › 12.` (matriz 21 rotas × 6 perfis) · E2E | integração + E2E |
| 13 | Uso simultâneo em dois dispositivos | `resilience.test.ts › 13.` (versão, numeração, cobrança, SSE) · E2E | integração + E2E |
| 14 | Persistência após reiniciar | `resilience.test.ts › 14.` (nova instância e pool) · E2E usa processo real | integração |
| 15 | Backup e restauração | `resilience.test.ts › 15.` (restaura em outro banco e compara) | integração com ferramentas reais |
| — | Atendente + caixa + cozinha simultâneos | `waiter.test.ts` · `e2e/waiter-flow.spec.ts` | integração + E2E |
| 16 | Cardápio digital até o fechamento do caixa | `delivery.test.ts` · `e2e/full-flow.spec.ts` | integração + E2E |

Também cobertos: pesquisa por número/nome/telefone/endereço, mesa ocupada, comanda com várias rodadas,
reabertura auditada, conferência cega do caixa, Pix integrado recusado, CSRF, bloqueio por senha errada,
limite por IP, sessão derrubada ao desativar usuário, último administrador protegido, CSV contra injeção
de fórmula, validação de entrada, sinalização de queda de conexão, robô do WhatsApp sem vazamento de dados
de outros clientes, opt-out e janela de 24 h.

## Fluxo atendente + caixa + cozinha (obrigatório)

`e2e/waiter-flow.spec.ts` abre **três sessões simultâneas** no mesmo servidor/banco — atendente (celular
390 px, toque), caixa (1366 px) e cozinha (tablet 1024 px) — e verifica, **sem recarregar páginas**:

1. o atendente abre a Mesa 8, lança X-Bacon com cheddar, “sem cebola” e “bem passado” + refrigerante,
   confere e envia; aparece “Recebido pelo servidor … rodada 1”;
2. o caixa vê a mesa com pedido, atendente, valor e “1 enviado”; a cozinha vê a rodada com mesa,
   atendente, adicionais e observação (e sem a bebida);
3. acréscimo de batata: a cozinha recebe uma rodada “ACRÉSCIMO” só com a batata; a rodada 1 continua
   “em preparo” com o X-Bacon; o caixa vê o novo total;
4. cozinha marca pronto; o atendente vê “Pronto”, marca “Entregue na mesa”; caixa e cozinha atualizam;
5. o atendente pede a conta; o caixa recebe o aviso, abre a mesa, vê “lançado por Atendente Ana”, recebe
   no débito e finaliza; o celular do atendente mostra “finalizado” e a mesa fica livre;
6. **queda de conexão**: com o celular offline, o envio mostra “Envio não confirmado” (nunca “recebido”),
   a mesa continua livre no caixa e o caixa é avisado de que o celular perdeu a conexão; ao voltar,
   “Reenviar” cria exatamente um pedido;
7. **resposta perdida + toque repetido**: o servidor grava mas a resposta é cortada; o reenvio (com toque
   duplo) não duplica — 1 item e 2 rodadas; um envio normal com toque duplo também gera só uma rodada.

Integração (`waiter.test.ts`): permissões do atendente, mesa x comanda, dois atendentes abrindo a mesma
mesa ao mesmo tempo, acréscimo sem versão sem apagar edição do caixa, idempotência com 4 envios
simultâneos e reenvio tardio, entregue/pedido de conta sem evento duplicado, presença com tempo esgotado.

Capturas: `evidencias/w01…w09`.

## Como reproduzir

```bash
createdb guto_test && createdb guto_e2e       # usuário/senha conforme apps/server/test/helpers.ts
npm run typecheck && npm run lint
npm run test:unit && npm run test:integration
npm run test:e2e                              # compila e recria o banco guto_e2e
```
Variáveis opcionais: `TEST_DATABASE_URL`, `E2E_DATABASE_URL`.
