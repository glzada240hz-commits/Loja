# Cardápio digital na internet (túnel do computador da loja)

Escolha do dono: **túnel** — o cardápio só fica no ar com o computador da loja ligado (loja fechada, link fora
do ar).

## Como ligar
**Ajustes → Loja → Cardápio digital na internet → Colocar o cardápio na internet** (admin). Em até ~30 s aparece
o **link** (`https://…trycloudflare.com/c`), o **QR** e **Copiar mensagem para o WhatsApp**. O mesmo quadro
aparece na tela WhatsApp. Pedidos feitos pelo link chegam como **aguardando aceite** (só com o dia aberto e
“Aceitar pedidos pelo cardápio digital” marcado).

## Como funciona
- **Porteiro** (`apps/server/src/services/publicGateway.ts`, porta local 3001): de fora só passam `/c`
  (cardápio e acompanhamento), `/api/public/*` necessários e os arquivos da interface. Login, caixa, API interna,
  relatórios: **bloqueados (404)**. Cookies da equipe não passam. Limite de pedidos por cliente usa o IP real
  informado pelo túnel.
- **Túnel**: `runtime\cloudflared.exe` (Cloudflare, gratuito, sem conta, “quick tunnel”). Ligado/desligado pelo
  sistema conforme o ajuste; se cair, tenta de novo a cada 15 s.

## Limites (túnel gratuito)
- O **endereço muda** quando o computador ou o sistema reinicia: copie o link novo ao abrir a loja e atualize a
  mensagem automática do WhatsApp Business / bio do Instagram.
- Sem garantia de disponibilidade (serviço gratuito da Cloudflare, indicado para uso leve).
- Endereço **fixo** exige domínio próprio (pago) + túnel nomeado — não contratado.

## Validação
- Unitário: regras do porteiro (o que passa e o que é bloqueado).
- Integração: pela porta do porteiro, `/api/public/menu` 200; `/api/orders` e `/api/settings` 404 mesmo com
  cookie da equipe; `/` → `/c`; sem `set-cookie`.
- Windows (GitHub Actions): liga o túnel de verdade, abre o cardápio pelo endereço público e confere que a API
  interna responde 404 de fora (se a rede do runner permitir; senão registra aviso).
