# Bar do Guto — Sistema de gestão

Aplicação web responsiva (instalável como PWA) para a operação da lanchonete **Bar do Guto**:
PDV de balcão/retirada/delivery/mesas, comandas, cozinha (KDS), expedição e entregadores,
caixa e dia operacional, cardápio e ficha técnica, estoque, despesas, relatórios,
WhatsApp (camada para a API oficial) e cardápio digital para clientes.

> **Situação:** versão funcional testada em ambiente de desenvolvimento. **Ainda não está pronta
> para produção**: o WhatsApp funciona só em modo demonstrativo até a configuração da conta
> oficial, a impressão foi validada apenas pelo navegador (sem impressora real) e os dados do
> cardápio são demonstrativos. A lista completa está em [docs/PENDENCIAS.md](docs/PENDENCIAS.md).

## Telas

| Perfil | Tela inicial | Acesso |
|---|---|---|
| Administrador | Venda (PDV) | tudo, inclusive usuários, templates do WhatsApp, exclusão de dados pessoais |
| Gerente | Venda (PDV) | tudo exceto usuários, configuração do WhatsApp e exclusão de dados pessoais |
| Caixa | Venda (PDV) | vendas, pedidos, pagamentos, caixa (sem ver o esperado), entregas, WhatsApp |
| Atendente | App do atendente (`/atendente`) | abrir mesa/comanda, lançar e acrescentar itens, marcar entregue, pedir a conta |
| Cozinha | Cozinha | só a fila de produção |
| Entregador | Minhas entregas | só as entregas atribuídas a ele |
| Cliente (sem login) | `/c` | cardápio digital e acompanhamento do próprio pedido |

Ações sensíveis (desconto acima do limite, cancelamentos, reabertura, estorno, fechamento de caixa,
conta pendente, taxa manual) pedem **autorização do gerente** na própria tela; o nome de quem autorizou
fica no histórico e na auditoria.

## Executar localmente

Requisitos: **Node.js 22+**, **PostgreSQL 14+**.

```bash
npm install
cp .env.example .env            # ajuste DATABASE_URL e SEED_ADMIN_PASSWORD
createdb guto                    # ou crie o banco pelo seu cliente PostgreSQL
npm run db:seed                  # aplica migrations e cria admin + dados demonstrativos
npm run dev                      # API em :3000 e interface em http://localhost:5173
```

Usuários demonstrativos (somente fora de produção): `gerente`, `caixa`, `atendente1`, `atendente2`, `cozinha`, `moto1`, `moto2`,
senha `demo1234`. O usuário `admin` usa a senha definida em `SEED_ADMIN_PASSWORD`.

Versão de produção (um único processo serve API e interface):

```bash
npm run build
npm start                        # http://localhost:3000  (aplica migrations ao iniciar)
```

Cardápio digital: `http://localhost:3000/c` · Acompanhamento: link enviado ao cliente.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run typecheck` | verificação de tipos (core, servidor, web) |
| `npm run lint` | ESLint |
| `npm run test:unit` | testes unitários (regras de dinheiro, preço, permissões, estados) |
| `npm run test:integration` | testes com PostgreSQL real (`guto_test`) |
| `npm run test:e2e` | compila, recria `guto_e2e` e roda o navegador (Playwright) |
| `npm run backup` / `npm run restore` | backup e restauração (ver [docs/OPERACAO.md](docs/OPERACAO.md)) |

## Estrutura

```
packages/core      regras puras compartilhadas: centavos, cálculo do pedido, permissões, estados, fuso
apps/server        Fastify + Drizzle ORM + PostgreSQL (API, webhooks, filas, tempo real)
apps/web           React + Vite + TanStack Query (PWA)
e2e                testes de ponta a ponta (Playwright)
scripts            backup, restauração, utilitários
docs               arquitetura, operação, WhatsApp, impressão, testes, pendências
```

## Documentação

- [App do atendente (mesas e comandas)](docs/ATENDENTES.md)
- [Arquitetura e regras de negócio](docs/ARQUITETURA.md)
- [Operação, implantação, backup e restauração](docs/OPERACAO.md)
- [WhatsApp: o que está pronto e o que falta configurar](docs/WHATSAPP.md)
- [Impressão (58/80 mm)](docs/IMPRESSAO.md)
- [Testes e evidências](docs/TESTES.md)
- [Pendências, limitações e próximos passos](docs/PENDENCIAS.md)
