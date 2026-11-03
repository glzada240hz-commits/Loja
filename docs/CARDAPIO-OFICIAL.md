# Cardápio oficial do Bar do Guto

Transcrito das artes enviadas pelo dono em 03/11/2026 (“Cardápio” e “Bebidas”). Dados em
`apps/server/src/db/cardapio-oficial.ts`. No **modo loja** (instalador do Windows) o cardápio entra **sozinho** na primeira abertura da versão que o
traz, uma única vez (); o que a loja mudar depois fica como está. Também dá para
importar de novo em **Cardápio → Ver / importar de novo** (gerente/admin). Pode importar de novo: produtos são localizados pelo nome e nada é duplicado.

O que a importação faz:
- cria/atualiza 6 categorias e 47 produtos com os preços das artes (cervejas com dois tamanhos);
- Hambúrgueres, Porções e Pratos vão para a cozinha; Cervejas, Drinks e doses, Refrigerantes e sucos não;
- hambúrgueres ganham opções **gratuitas** para retirar ingredientes (Sem salada, milho, batata, ovo, presunto,
  bacon, cheddar). Não há adicionais pagos nas artes, então nenhum foi criado;
- opcional (marcado): tira de venda os produtos e adicionais de **exemplo** (preços inventados) e as fichas
  técnicas de exemplo dos lanches de mesmo nome; categorias de exemplo vazias somem;
- opcional (marcado): telefone (31) 98841-4429 e endereço R. Roberto Bernardes de Lima, 299 - Santa Martinha
  na nota;
- produtos cadastrados pela loja que não estão nas artes continuam à venda e são listados no fim.

Códigos do PDV (escolhidos pelo sistema; trocáveis): hambúrgueres 1–7, porções 20–27, pratos 30–35,
cervejas 40–45, drinks e doses 50–58, refrigerantes e sucos 60–70.

| Categoria | Item | Preço |
|---|---|---|
| Hambúrgueres | X-Burguer · X-Egg Burguer · X-Egg Bacon · X-Guto · X-Tudo · X-Picanha · X-Cabuloso | 13,50 · 15,50 · 18,90 · 19,90 · 21,90 · 25,90 · 23,90 |
| Porções | Contra Filé c/ Fritas · Lombo c/ Fritas · Filé de Piramutaba · Peixe Cascudo · Fritas · Fritas c/ Queijo e Bacon · Fritas c/ Cheddar e Bacon · Coraçãozinho c/ Fritas | 64,90 · 49,90 · 55,90 · 45,90 · 22,90 · 37,90 · 40,90 · 49,90 |
| Pratos | Omelete Simples · de Frango · Especial · c/ Cheddar e Bacon · Macarrão na Chapa · Macarrão à Bolonhesa | 16,50 · 18,50 · 20,50 · 21,90 · 22,90 · 22,90 |
| Cervejas | Heineken 600ml / long neck · Original 600ml / latão · Brahma 600ml / latão · Kaiser 600ml / latão · Skol 600ml · Stella 600ml | 16,00/12,00 · 13,00/9,00 · 11,00/8,00 · 10,00/7,00 · 11,00 · 16,00 |
| Drinks e doses | Pinga da Roça · Selvagem · Vinho · Conhaque · Caipirinha · Caipivodka · Cortezano · Campari · Whisky | 4,00 · 4,00 · 9,00 · 5,00 · 17,00 · 18,00 · 5,00 · 15,00 · 20,00 |
| Refrigerantes e sucos | Coca-Cola 2L · Fanta 2L · Guarapan 2L · Kuat 2L · Mate Couro 1L · Refrigerante 600ml · Refrigerante Lata · Suco Tial 250ml · Suco 1L · Água Mineral · Água Mineral c/ Gás | 17,00 · 15,00 · 11,00 · 11,00 · 9,00 · 9,00 · 8,00 · 7,00 · 12,00 · 4,00 · 5,00 |

Confirmado pelo dono: “Fritas c/ Cheddar e Bacon” leva **cheddar** (a arte dizia muçarela; corrigido na
versão `2026-11-03b`); caipirinha/caipivodka são feitas no **balcão** (não vão para a cozinha). “Whisk” da arte
foi escrito “Whisky”. Adicionais pagos: aguardando resposta.

Validação: teste de integração (preços, tamanhos, categorias, cozinha, exemplos fora, item do dono mantido,
repetição sem duplicar, venda com “Sem milho”) e E2E (conferir → importar → aparece no PDV). Capturas em
[`evidencias/cardapio/`](evidencias/cardapio/).
