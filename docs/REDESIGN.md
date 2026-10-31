# Evolução da interface — diagnóstico, decisões e registro

Trabalho executado de forma autônoma. As decisões abaixo são **aprovação técnica** (critérios e testes),
não aprovação do dono nem validação com a equipe da loja.

## 1. Diagnóstico da versão anterior

Capturas (dados fictícios, `scripts/cenario-teste.mjs`) em [`evidencias/redesign/antes/`](evidencias/redesign/antes/).

| Área | Problema concreto observado |
|---|---|
| Identidade | Emojis como sistema de ícones (🧾📋🍽️👨‍🍳🛵…); cada um com estilo e tamanho diferentes, alguns renderizam diferente no Windows. |
| Navegação | Barra lateral escura de 220 px sempre visível, inclusive na **cozinha** (que só tem uma tela) e no tablet, roubando ~20 % da largura. |
| Barra superior | Quatro “pílulas” (dia, caixa, aparelhos, online) sempre visíveis competem com o título. O contador de aparelhos mostrava **“6 sem conexão”** para sessões já encerradas (alarme falso permanente). |
| PDV | Cartões de produto sem hierarquia; código do produto solto no canto; categorias quebram linha no celular; carrinho vazio ocupa a coluna inteira; botões desabilitados viram blocos cinza/verde-claro sem explicação; texto técnico “Prévia… calculado pelo servidor” sempre visível. |
| Mesas | Cartões grandes (só 8 por linha em 1366 px, 2 por linha no celular); **“Comanda 21” estoura o cartão**; “Mesa 10” quebra em duas linhas; cores sem legenda (amarelo/verde/vermelho); selos de andamento com estilos diferentes entre si; mesa livre tem o mesmo peso visual de mesa ocupada. |
| Detalhe do pedido | **ID interno (UUID)** exposto; cinco botões de mesmo peso no rodapé, “Cancelar pedido” vermelho grande ao lado de “Receber”; “Cancelar” ao lado de cada item, fácil de tocar por engano. |
| Cozinha | Botões **“Iniciar preparo” e “Pronto” lado a lado** (toque errado pula etapa); botão “↩” sem rótulo; cabeçalho de coluna quebra (“Prontos (últimos 20 min)”); atraso indicado com animação piscante. |
| Atendente | Grade de mesas em 2 colunas obriga a rolar para ver 12 mesas; “Conferir e enviar” desabilitado amarelo-claro parece ativo; instruções longas no cartão “Novo pedido”. |
| Entregas | Link “mapa” solto; repasse ao motoboy não aparece na fila; colunas vazias com texto em negrito centralizado. |
| Cardápio digital | Sem imagens nem placeholders; lista longa sem destaque de preço; status da loja espremido. |
| Relatórios | Indicadores em caixa-alta com explicações misturadas; “resultado estimado” com valores no meio da largura. |
| Windows | `iniciar-teste.bat` só compilava se não existisse build (código novo não era recompilado); não verificava versão do Node; dava para abrir duas vezes; “zerar” era só uma opção escondida. |

## 2. Plano

1. Design system: tokens (cor, tipografia, espaço, raio, sombra), ícones SVG (`lucide-react`), fonte
   Inter empacotada, componentes padronizados.
2. Layout novo: barra lateral clara com grupos, recolhível em tablet, ausente para perfis de tela única.
3. Redesenho de PDV, Mesas e comandas, App do atendente e Cozinha (prioridade), depois detalhe do
   pedido, entregas, cardápio digital e gestão.
4. Ideias avaliadas por critérios (seção 4).
5. Windows: iniciar/atualizar/zerar previsíveis.
6. Testes completos + capturas “depois” + casos extremos.

## 3. Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| CSS próprio com **tokens** em `:root` | Tailwind, biblioteca de componentes (MUI/Chakra) | O app já usa classes semânticas; trocar de framework reescreveria tudo e aumentaria o pacote. Tokens dão consistência sem dependência pesada. |
| Ícones **lucide-react** (ISC) | Emojis, SVG desenhados à mão, Material Icons | Traço uniforme, árvore podada (só os ícones usados entram no pacote), funciona offline, sem serviço externo. |
| Fonte **Inter** empacotada (`@fontsource-variable/inter`, OFL) | Fonte do sistema, Google Fonts | Igual no Windows/Android/iOS, números tabulares para dinheiro, sem requisição externa (CSP e modo offline do PWA). |
| Cor de marca **laranja-brasa** `#C2410C` | Amarelo anterior, vermelho | Contraste AA com texto branco (5,2:1), associada a chapa/brasa; distinta das cores semânticas (verde pronto, azul ocupado, violeta conta, vermelho erro/atraso). |
| Estados sempre com **ícone + texto** além de cor | Só cor | Acessibilidade e leitura à distância (cozinha). |

(continua nas seções de ideias e resultados)
