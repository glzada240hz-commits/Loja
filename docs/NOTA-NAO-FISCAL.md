# Nota não fiscal (conta e comprovante de pagamento)

O Bar do Guto imprime uma **nota não fiscal** para cobrar o cliente. Ela **não substitui** NFC-e/cupom
fiscal: se a loja for obrigada a emitir documento fiscal, isso precisa de um emissor autorizado pela SEFAZ
(não incluído). A nota sempre traz **“NÃO É DOCUMENTO FISCAL”**.

## Dois tipos, escolhidos sozinhos

| Situação do pedido | Título impresso | O que traz |
|---|---|---|
| Ainda falta receber | **CONTA — CONFERÊNCIA** | itens com quantidade × preço, descontos, taxa de entrega, total, o que já foi pago e **A PAGAR** (sem QR Pix: o dono prefere cobrar o Pix na maquininha) |
| Quitado | **NOTA DE VENDA — PAGO** | itens, total, formas de pagamento, valor recebido em dinheiro, **troco**, data/hora do pagamento e quem recebeu |

Cabeçalho: nome da loja, CNPJ/CPF (se cadastrado), endereço e telefone. Rodapé: mensagem da loja.
Bobina de 80 mm ou 58 mm (Ajustes → Bobina padrão).

## Onde imprimir

- **No pagamento** (Receber): botão **Imprimir conta** — para o cliente conferir antes de pagar.
- **Depois de quitar**: aparece a tela **“Pedido #N pago”** com o troco e o botão **Imprimir nota**.
  Em Ajustes dá para marcar **“Abrir a impressão da nota automaticamente quando o pedido for quitado”**.
- **No pedido** (qualquer tela que abre o pedido, inclusive Mesas): botão **Imprimir conta** / **Imprimir nota**.
- A nota abre numa janela pequena, chama a impressão e fecha sozinha depois.

## Configurar (Ajustes → Loja → Nota não fiscal)

- **Logo**: a logo do Bar do Guto já vem no sistema (versão colorida no app; versão preto-e-branco própria
  para impressora térmica, em `apps/web/public/logo-nota.png`). Para trocar: Ajustes → Loja → Logo da loja
  (PNG com fundo transparente; logo com fundo escuro sai como um bloco preto na térmica). PNG/JPG/WebP. Sai no topo da nota (em preto e branco) e
  aparece no app: menu lateral, tela de entrada e cardápio digital.
- **CNPJ ou CPF impresso na nota** (opcional).

## Cuidados

- A nota **não traz QR Pix** (retirado em 04/11/2026 a pedido do dono: o Pix é cobrado na maquininha). Pix
  recebido é registrado em Receber → Pix depois de conferido.

## Validação feita

- Gerador do Pix (código mantido, sem uso na nota) confere com o exemplo oficial do manual do Banco Central (CRC `1D3D`) e valida
  CPF/CNPJ/celular/e-mail/chave aleatória (testes unitários `packages/core/test/pix.test.ts`).
- Servidor recusa chave inválida e salva CNPJ, cidade e impressão automática (teste de integração).
- E2E: pagamento em dinheiro com troco → tela “pago” → **Imprimir nota** abre a nota com “NOTA DE VENDA —
  PAGO”, “NÃO É DOCUMENTO FISCAL” e o troco.
- Capturas em [`evidencias/nota/`](evidencias/nota/): conta (as de antes ainda mostram o QR; 80 e 58 mm), nota paga com troco, tela
  de pagamento e tela “pago”.
- **Não testado:** impressora térmica física.
