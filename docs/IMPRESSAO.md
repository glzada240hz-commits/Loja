# Impressão

## O que existe

- **Impressão pelo navegador** (`/imprimir/<pedido>`): comprovante do cliente e via da cozinha em layouts
  de **58 mm** e **80 mm** (`@page size`), com fonte monoespaçada. Abre pelo botão *Imprimir* do pedido ou
  *Imprimir comanda* após registrar uma venda. O padrão da bobina fica em Ajustes → Loja.
- O comprovante traz em destaque **“NÃO É DOCUMENTO FISCAL”**. O sistema **não emite NFC-e/SAT/NF-e** e não
  simula documento fiscal.

## O que foi validado

- Renderização dos dois layouts no Chromium (capturas em `test-results/screens` e na inspeção visual).
- **Não** foi validado com impressoras térmicas reais (nenhum equipamento disponível). Antes do uso:
  imprima um teste em cada impressora, no diálogo do navegador escolha a impressora térmica, tamanho de
  papel correspondente, **margens: nenhuma** e escala 100%.

## Impressão direta (sem diálogo) — não incluída

Imprimir automaticamente em impressora térmica (ESC/POS via USB/rede) exige um **agente local** instalado no
computador da loja (o navegador não acessa portas USB/TCP de impressora por conta própria) ou o modo
quiosque do navegador (`--kiosk-printing`). Esta dependência **não foi implementada nem validada** e deve
ser tratada como projeto separado, isolado do servidor, após definir os modelos de impressora.
Alternativa imediata: Chrome/Edge com `--kiosk-printing` e a impressora térmica como padrão do sistema.
