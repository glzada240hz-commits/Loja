# App do atendente (mesas e comandas)

O app do atendente é parte da mesma aplicação web/PWA: **mesmo servidor e mesmo banco** do caixa e
da cozinha. No celular ou tablet, abra o endereço da loja, entre com o usuário do atendente e use
“Adicionar à tela inicial” para instalar. O perfil **Atendente** entra direto em `/atendente`.

## Fluxo

1. **Abrir mesa ou comanda** — toque numa mesa livre ou informe o número da comanda (cartão).
   Mesa 12 e comanda 12 são coisas diferentes. Se outro aparelho abriu a mesma mesa no mesmo instante,
   o banco garante uma só comanda aberta e o app oferece acrescentar os itens nela.
2. **Montar o pedido** — produtos, quantidades, tamanhos, adicionais (com mínimo/máximo) e observação por
   item (“sem cebola”, “bem passado”). O rascunho fica guardado no aparelho até ser enviado.
3. **Conferir e enviar** — a tela de conferência mostra só o que será enviado agora. Estados visíveis:
   - **Enviando…** (botão travado);
   - **✓ Recebido pelo servidor às HH:MM — rodada N** (só aparece com a confirmação do servidor);
   - **Envio não confirmado** (rede caiu ou a resposta não chegou): o pedido NÃO é mostrado como enviado,
     o rascunho fica travado e “Reenviar” usa a mesma chave — se o servidor já tinha gravado, devolve a
     mesma resposta; não há rodada duplicada;
   - **Não enviado: motivo** (ex.: item ficou indisponível) — nada foi gravado; corrija e envie.
4. **Acréscimos** — itens novos numa comanda já enviada viram uma **nova rodada** na cozinha, marcada
   “ACRÉSCIMO — só os itens abaixo”. As rodadas anteriores continuam no estado em que estavam.
5. **Acompanhar** cada rodada: Enviado → Em preparo → Pronto → **Entregue na mesa** (o atendente confirma).
6. **Pedir a conta** — o caixa recebe um aviso sonoro/visual e a mesa fica destacada em vermelho.
   O atendente não recebe pagamento nem fecha a conta (permissão do caixa/gerente).

## Caixa

*Mesas e comandas* mostra, em tempo real, cada mesa/comanda com número do pedido, atendente responsável,
tempo, valor, andamento das rodadas e pedidos de conta. Tocando na mesa: itens (com quem lançou cada um),
rodadas, histórico, receber pagamentos, dividir e finalizar conforme as permissões.

## Cozinha

Cada rodada aparece imediatamente com mesa/comanda, atendente, horário, adicionais, itens removidos
(em vermelho) e observações destacadas. “Iniciar preparo” e “Pronto” atualizam o caixa e o celular do
atendente na hora. Cancelamentos de itens já enviados (exigem gerente) aparecem em amarelo na rodada;
pedido cancelado aparece como “NÃO PREPARAR”.

## Conexão dos aparelhos

Cada aparelho mantém a conexão de tempo real e envia um sinal a cada 15 s. O caixa/gerência vê no topo
quantos aparelhos estão conectados e recebe um aviso quando algum **perde a conexão** (ou reconecta).
No próprio aparelho sem conexão aparece a faixa vermelha “Sem conexão”.

## Permissões do perfil Atendente

Pode: ver pedidos, abrir mesa/comanda, lançar e acrescentar itens, marcar entregue, pedir a conta.
Precisa de autorização do gerente: desconto, cancelar item já enviado, cancelar pedido.
Não pode: receber pagamento, fechar conta, caixa, cozinha, relatórios, cadastros.
