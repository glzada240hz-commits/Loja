# Nota não fiscal (conta e comprovante de pagamento)

O Bar do Guto imprime uma **nota não fiscal** para cobrar o cliente. Ela **não substitui** NFC-e/cupom
fiscal: se a loja for obrigada a emitir documento fiscal, isso precisa de um emissor autorizado pela SEFAZ
(não incluído). A nota sempre traz **“NÃO É DOCUMENTO FISCAL”**.

## Dois tipos, escolhidos sozinhos

| Situação do pedido | Título impresso | O que traz |
|---|---|---|
| Ainda falta receber | **CONTA — CONFERÊNCIA** | itens com quantidade × preço, descontos, taxa de entrega, total, o que já foi pago, **A PAGAR** e, se a loja cadastrou a chave, **QR Pix com o valor** |
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

- **Logo da loja** (Ajustes → Loja → Logo da loja): PNG/JPG/WebP. Sai no topo da nota (em preto e branco) e
  aparece no app: menu lateral, tela de entrada e cardápio digital.
- **CNPJ ou CPF impresso na nota** (opcional).
- **Chave Pix para o QR da conta** (opcional): CPF/CNPJ (com dígitos verificadores válidos), e-mail, celular
  com **+55** (ex.: `+5511999999999`) ou chave aleatória. O sistema mostra como reconheceu a chave e o
  servidor recusa chave inválida.
- **Cidade** (o padrão do Pix exige).
- Antes de usar com clientes: imprima a conta de um pedido de teste e pague pelo QR com o seu celular para
  conferir que o dinheiro cai na conta certa.

## Cuidados

- O QR Pix só **facilita** o pagamento. O pagamento **só vale depois da conferência no extrato/app do banco**;
  então registre em Receber → Pix. Comprovante na tela do cliente não garante o recebimento.
- O QR é do tipo **estático** (gerado no próprio computador, sem serviço externo e sem custo). Ele leva o valor
  e o número do pedido (`PED<número>`) como identificação; o sistema **não** recebe aviso automático do banco.

## Validação feita

- Gerador do Pix confere com o exemplo oficial do manual do Banco Central (CRC `1D3D`) e valida
  CPF/CNPJ/celular/e-mail/chave aleatória (testes unitários `packages/core/test/pix.test.ts`).
- Servidor recusa chave inválida e salva CNPJ, cidade e impressão automática (teste de integração).
- E2E: pagamento em dinheiro com troco → tela “pago” → **Imprimir nota** abre a nota com “NOTA DE VENDA —
  PAGO”, “NÃO É DOCUMENTO FISCAL” e o troco.
- Capturas em [`evidencias/nota/`](evidencias/nota/): conta com QR (80 e 58 mm), nota paga com troco, tela
  de pagamento e tela “pago”.
- **Não testado:** leitura do QR por app de banco real (exige pagamento real) e impressora térmica física.
