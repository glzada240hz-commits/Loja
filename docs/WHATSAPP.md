# WhatsApp

## Situação atual

| Item | Estado |
|---|---|
| Camada de integração com a **WhatsApp Business Platform (Cloud API)** da Meta | Implementada (`apps/server/src/whatsapp/provider.ts`) |
| Validação real com a plataforma da Meta | **NÃO realizada** — não há conta, número nem credenciais neste ambiente |
| Modo demonstrativo | Ativo por padrão (`WHATSAPP_MODE=demo`): nenhuma mensagem sai do servidor; a interface mostra a faixa “MODO DEMONSTRATIVO” |
| Testes | Automatizados com uma **Graph API simulada** (mock HTTP) e com o provedor demo; ver TESTES.md |

Não há uso de WhatsApp Web, sessões pessoais nem bibliotecas não oficiais.

> Durante o desenvolvimento **não foi possível acessar developers.facebook.com** a partir do ambiente
> (bloqueio de rede). A versão da Graph API está configurável (`WHATSAPP_GRAPH_VERSION`, padrão `v23.0`)
> e **deve ser confirmada** na documentação oficial no momento da ativação, assim como os códigos de erro
> e as regras de cobrança/janela vigentes.

## O que o titular da conta precisa fazer (ações exclusivas da empresa)

1. Conta no **Meta Business Manager**, com **verificação da empresa** quando exigida.
2. Criar um app (tipo Business) em developers.facebook.com e adicionar o produto **WhatsApp**.
3. Registrar e verificar o **número de telefone** da loja na WhatsApp Business Platform (o número não pode
   estar em uso simultâneo no app WhatsApp comum) e definir o nome de exibição.
4. Criar um **usuário de sistema** com permissões `whatsapp_business_messaging` e
   `whatsapp_business_management` e gerar um **token permanente**.
5. Configurar a forma de pagamento da conta (conversas iniciadas pela empresa via template são cobradas
   pela Meta conforme a tabela vigente).
6. Criar e submeter à aprovação os **templates** (categoria Utilidade) para atualizações fora da janela
   de 24 h. Sugestões (texto livre, ajuste à política):
   - `pedido_recebido`: “Recebemos seu pedido {{1}} (total {{2}}). Ele ainda será confirmado pela loja. Acompanhe: {{3}}”
   - `pedido_confirmado`: “Seu pedido {{1}} foi confirmado. Previsão: {{2}}. Acompanhe: {{3}}”
   - `pedido_pronto`: “Seu pedido {{1}} está pronto para retirada.”
   - `pedido_saiu`: “Seu pedido {{1}} saiu para entrega. Acompanhe: {{2}}”
   - `pedido_cancelado`: “Seu pedido {{1}} foi cancelado. Responda esta mensagem se tiver dúvidas.”

## Configuração no servidor

No `.env` do servidor (nunca no repositório):

```
WHATSAPP_MODE=cloud
WHATSAPP_GRAPH_VERSION=v23.0          # confirme a versão atual
WHATSAPP_PHONE_NUMBER_ID=...           # ID do número (não é o telefone)
WHATSAPP_ACCESS_TOKEN=...              # token do usuário de sistema
WHATSAPP_APP_SECRET=...                # App Secret (valida a assinatura dos webhooks)
WHATSAPP_VERIFY_TOKEN=...              # texto aleatório escolhido por você
PUBLIC_BASE_URL=https://seu.dominio    # usado nos links do cardápio/rastreio
```

O servidor recusa iniciar em `cloud` se faltar alguma variável. No painel do app (WhatsApp → Configuração):
- **URL de callback**: `https://seu.dominio/api/webhooks/whatsapp`
- **Token de verificação**: o mesmo `WHATSAPP_VERIFY_TOKEN`
- Assinar o campo **messages**.

Em **Ajustes → WhatsApp**, cadastre o nome exato e o idioma de cada template aprovado. Parâmetros enviados:
`order_received` → [número, total, link]; `order_accepted` → [número, previsão, link];
`order_ready` → [número]; `order_dispatched` → [número, link]; `order_cancelled` → [número].

### Roteiro de validação real (após configurar)
1. Verificar o webhook (o painel da Meta deve mostrar sucesso).
2. Enviar “oi” de um celular de teste → deve aparecer em WhatsApp → Conversas e receber a saudação.
3. Enviar “1”, “2”, “3” e “PARAR” e conferir as respostas/estados.
4. Fazer um pedido pelo cardápio digital com opt-in → conferir mensagens de recebido, confirmado, saiu.
5. Testar fora da janela de 24 h com template aprovado.
6. Conferir os recibos de entrega/leitura e o painel de falhas.

## Como funciona

- **Webhook** (`POST /api/webhooks/whatsapp`): valida `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto
  com o App Secret, comparação em tempo constante). Assinatura inválida → 401. Cada mensagem/status é
  gravado em `wa_webhook_events` com chave única (`msg:<id>` / `st:<id>:<status>`): **repetições são
  ignoradas**. O processamento falho fica pendente e é **reprocessado** com espera crescente (até 8 vezes),
  visível em *WhatsApp → Monitoramento*.
- **Fora de ordem**: status só avança (enviada → entregue → lida); “falhou” não sobrescreve entregue/lida;
  status de uma mensagem ainda desconhecida é reprocessado depois. A janela de 24 h usa a mensagem de
  entrada **mais recente**, mesmo que cheguem fora de ordem.
- **Fila de saída** (`wa_messages`): reserva com `FOR UPDATE SKIP LOCKED`, até 5 tentativas com espera de
  15 s a 1 h para erros temporários (rede, 5xx, 429, limites); erros definitivos falham na hora. Mensagens
  presas em “enviando” após reinício viram **falha para conferência manual** (não são reenviadas sozinhas,
  para não duplicar). Reenvio manual reavalia a janela e o template.
- **Mensagens automáticas** são criadas **dentro da transação** do evento confirmado (aceite, pronto,
  saída, cancelamento) e têm chave de deduplicação por pedido/evento. Pedido do cardápio digital recebe
  “recebemos, **ainda será confirmado**”; “confirmado” só após o aceite da loja. Não há mensagem de
  “pago” automática.
- **Consentimento**: o checkout pede opt-in de atualizações; o atendente pode registrar consentimento
  (origem e data gravadas); “PARAR/SAIR” desativa as automáticas, “VOLTAR” reativa.
- **Atendimento automático** por regras fixas (sem IA): 1 = link do cardápio, 2 = status dos pedidos
  **deste mesmo telefone**, 3 = atendente humano (pausa o robô). Texto do cliente nunca é interpretado como
  comando privilegiado e o robô não acessa dados de outros clientes. O robô pode ser pausado por conversa ou
  desligado em Ajustes. **Não foi implementado** um assistente que monte pedidos por conversa: o pedido é
  feito no cardápio digital, com preços reais e conferência no servidor.
- **Mídia**: imagens/documentos recebidos aparecem como “[Imagem recebida]”; o download do arquivo não foi
  implementado. Comprovantes de Pix enviados pelo cliente **não** confirmam pagamento.
