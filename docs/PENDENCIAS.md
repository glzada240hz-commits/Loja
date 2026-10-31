# Pendências, limitações e checkpoint

## Por que ainda não está “pronto para produção”

| Pendência | Quem resolve | Detalhe |
|---|---|---|
| WhatsApp oficial não validado | **Titular da conta** + técnico | Exige conta Meta Business verificada, número registrado, token de usuário de sistema, App Secret, cobrança configurada e templates aprovados. Roteiro em WHATSAPP.md. Até lá: modo demonstrativo. |
| Versão da Graph API e códigos de erro | Técnico | developers.facebook.com estava inacessível no ambiente; confirmar `WHATSAPP_GRAPH_VERSION` e a lista de erros temporários. |
| Cardápio, preços, custos, bairros e taxas | **Dono da loja** | Os valores fornecidos (X-Burguer R$ 13,50 etc.) foram cadastrados como **demonstrativos**; refrigerante e combo têm preço inventado e marcado como demonstrativo; custos e fichas técnicas são fictícios. Revisar tudo. |
| Impressoras | Loja + técnico | Impressão só validada no navegador (sem impressora física). Testar 58/80 mm nos equipamentos reais. Impressão direta ESC/POS não implementada. |
| Hospedagem com HTTPS e backup externo | Técnico | Seguir OPERACAO.md; testar restauração no servidor real. |
| Privacidade (LGPD) | Dono + assessoria | Controles técnicos prontos; aviso de privacidade, base legal e prazos de retenção precisam ser definidos. |
| Pix integrado / pagamento online | Dono + provedor | Não contratado. O sistema registra Pix **manual** (conferido no extrato). Integração exigiria provedor (PSP) e webhooks dele. |
| Documento fiscal | Contador | Não há emissão fiscal (NFC-e/SAT). Comprovantes são marcados “NÃO É DOCUMENTO FISCAL”. |

## Limitações conhecidas

- **Sem modo offline**: com a conexão caída a interface avisa e nada é salvo; não há fila local nem
  reconciliação. Recomenda-se rede local estável (servidor na loja) ou contingência em papel.
- **Uma instância do servidor**: o tempo real (SSE) e o worker do WhatsApp rodam no mesmo processo. Para
  várias instâncias seria preciso um barramento compartilhado (ex.: `LISTEN/NOTIFY` do PostgreSQL).
- **Divisão de conta**: partes iguais e valores livres por pessoa; não há divisão automática “por item”.
- **Desconto**: no pedido inteiro (valor ou %), não por item.
- **Robô do WhatsApp**: regras fixas (menu 1/2/3). Não monta pedidos por conversa; mídia recebida não é
  baixada.
- **Distância/rota**: não calculadas (só link para o Google Maps).
- **Estoque**: permite ficar negativo (para não travar a venda) e sinaliza na tela. Unidades não são
  convertidas entre si (g ↔ kg): use a mesma unidade na ficha técnica e no insumo.
- **Relatórios**: pedidos em aberto entram nas vendas do dia em andamento; o fechamento do dia garante que
  tudo esteja finalizado. “Resultado estimado” não é demonstrativo contábil.
- **Atendentes**: sem modo offline de lançamento — o rascunho fica no aparelho e só vai à cozinha com o servidor acessível. A presença de aparelhos fica em memória (reiniciar o servidor zera a lista até os aparelhos darem sinal de novo, ~15 s).
- **Fotos**: guardadas no disco do servidor (`UPLOAD_DIR`); incluir no backup externo.

## Evolução da interface (redesign) — checkpoint

Ver [REDESIGN.md](REDESIGN.md). Feito: design system, PDV, mesas, atendente, cozinha, detalhe/pagamento,
entregas, cardápio digital, login, gestão padronizada; ideias adotadas/descartadas registradas; iniciador do
Windows com recompilação por mudança de código, instância única, dados fora da pasta e zerar separado.
Testes: 32 unitários, 44 integração, 20 E2E. **Não validado em Windows real** (só Linux).
Próximas sugestões: turno assistido com a equipe; executar `iniciar-teste.bat` num Windows real;
teste automatizado do bloqueio de toque da cozinha; push nativo (se houver domínio fixo); modo escuro.

## Checkpoint (para continuidade)

**Feito**: núcleo de regras (`packages/core`), esquema e migrations, API completa (auth, pedidos,
comandas, mesas, cozinha, entregas, acertos, caixa, dia operacional, cardápio, combos, ficha técnica,
estoque, despesas, clientes/privacidade, relatórios/CSV, auditoria, WhatsApp com webhook/fila/robô),
interface PWA com todas as telas, cardápio digital e rastreio, impressão 58/80 mm, scripts de backup e
restauração, documentação, testes (22 unit, 38 integração, 11 E2E) e inspeção visual.

**Próximas tarefas sugeridas** (em ordem):
1. Configurar a conta oficial do WhatsApp e executar o roteiro de validação real.
2. Implantar em servidor com HTTPS, configurar backup externo e testar restauração lá.
3. Revisar cardápio/preços/custos reais e cadastrar usuários e entregadores reais.
4. Testar impressão nas impressoras da loja; se necessário, projeto do agente de impressão direta.
5. Treinamento rápido da equipe e um dia de operação assistida (paralelo ao processo atual).
6. Melhorias opcionais: divisão de conta por item, desconto por item, barramento de eventos via
   PostgreSQL para múltiplas instâncias, download de mídia do WhatsApp, painel de clientes inativos para
   retenção.
