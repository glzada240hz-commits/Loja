# Testes e evidências

Última execução completa: ver [`evidencias/execucao-testes.txt`](evidencias/execucao-testes.txt)
(saída real dos comandos) e as capturas de tela em [`evidencias/`](evidencias/).

| Verificação | Resultado |
|---|---|
| `npm run typecheck` (core, servidor, web) | sem erros |
| `npm run lint` (ESLint + typescript-eslint + react-hooks) | sem erros/avisos |
| `npm run build` (Vite/PWA + esbuild do servidor) | ok |
| Testes unitários | **22/22** passaram |
| Testes de integração (PostgreSQL real) | **38/38** passaram (rodados 3 vezes seguidas sem falha) |
| Testes de ponta a ponta (Chromium real, servidor de produção compilado) | **11/11** passaram |

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
| 16 | Cardápio digital até o fechamento do caixa | `delivery.test.ts` · `e2e/full-flow.spec.ts` | integração + E2E |

Também cobertos: pesquisa por número/nome/telefone/endereço, mesa ocupada, comanda com várias rodadas,
reabertura auditada, conferência cega do caixa, Pix integrado recusado, CSRF, bloqueio por senha errada,
limite por IP, sessão derrubada ao desativar usuário, último administrador protegido, CSV contra injeção
de fórmula, validação de entrada, sinalização de queda de conexão, robô do WhatsApp sem vazamento de dados
de outros clientes, opt-out e janela de 24 h.

## Como reproduzir

```bash
createdb guto_test && createdb guto_e2e       # usuário/senha conforme apps/server/test/helpers.ts
npm run typecheck && npm run lint
npm run test:unit && npm run test:integration
npm run test:e2e                              # compila e recria o banco guto_e2e
```
Variáveis opcionais: `TEST_DATABASE_URL`, `E2E_DATABASE_URL`.
