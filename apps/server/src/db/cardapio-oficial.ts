/**
 * Cardápio oficial do Bar do Guto, transcrito das artes enviadas pelo dono em 03/11/2026 ("Cardápio" e
 * "Bebidas"). Preços em centavos. Os códigos de atalho do PDV foram escolhidos pelo sistema (não estão nas
 * artes) e podem ser trocados em Cardápio.
 */
export interface OfficialProduct {
  code: string;
  name: string;
  description?: string;
  /** um preço (Único) ou tamanhos */
  variants: { name: string; priceCents: number }[];
}
export interface OfficialCategory {
  name: string;
  sendToKitchen: boolean;
  /** hambúrgueres ganham o grupo gratuito "Retirar ingredientes" */
  removals?: boolean;
  products: OfficialProduct[];
}

const u = (priceCents: number) => [{ name: 'Único', priceCents }];

// muda quando o cardápio muda: o modo loja aplica a correção sozinho uma vez
export const OFFICIAL_MENU_VERSION = '2026-11-03e';

export const OFFICIAL_STORE = {
  storePhone: '(31) 98841-4429',
  storeAddress: 'R. Roberto Bernardes de Lima, 299 - Santa Martinha',
};

/** Opções gratuitas para os hambúrgueres (sem preço: não altera valores). */
export const OFFICIAL_REMOVALS = ['Sem salada', 'Sem milho', 'Sem batata', 'Sem ovo', 'Sem presunto', 'Sem bacon', 'Sem cheddar'];

export const OFFICIAL_MENU: OfficialCategory[] = [
  {
    name: 'Hambúrgueres',
    sendToKitchen: true,
    removals: true,
    products: [
      { code: '1', name: 'X-Burguer', description: 'Pão, carne, presunto, muçarela e salada.', variants: u(1350) },
      { code: '2', name: 'X-Egg Burguer', description: 'Pão, carne, ovo, presunto, muçarela, milho, batata e salada.', variants: u(1550) },
      { code: '3', name: 'X-Egg Bacon', description: 'Pão, carne, ovo, bacon, presunto, muçarela, milho, batata e salada.', variants: u(1890) },
      { code: '4', name: 'X-Guto', description: 'Pão, carne, frango, ovo, bacon, presunto, muçarela, milho, batata e salada.', variants: u(1990) },
      { code: '5', name: 'X-Tudo', description: 'Pão, 2 carnes, 2 ovos, bacon, 2 presuntos, 2 muçarelas, milho, batata e salada.', variants: u(2190) },
      { code: '6', name: 'X-Picanha', description: 'Pão, 2 carnes de picanha (120g), presunto, muçarela, cheddar e bacon.', variants: u(2590) },
      { code: '7', name: 'X-Cabuloso', description: 'Pão, 4 carnes, cheddar, muçarela e bacon.', variants: u(2390) },
    ],
  },
  {
    name: 'Porções',
    sendToKitchen: true,
    products: [
      { code: '20', name: 'Contra Filé c/ Fritas', description: '350g de carne e 450g de batata.', variants: u(6490) },
      { code: '21', name: 'Lombo c/ Fritas', description: '350g de carne e 450g de batata.', variants: u(4990) },
      { code: '22', name: 'Filé de Piramutaba', description: '500g de filé de peixe.', variants: u(5590) },
      { code: '23', name: 'Peixe Cascudo', description: '500g de peixe.', variants: u(4590) },
      { code: '24', name: 'Fritas', description: '500g de batata.', variants: u(2290) },
      { code: '25', name: 'Fritas c/ Queijo e Bacon', description: '500g de batata, muçarela e bacon.', variants: u(3790) },
      // a arte diz "muçarela e bacon"; o dono confirmou: leva cheddar
      { code: '26', name: 'Fritas c/ Cheddar e Bacon', description: '500g de batata, cheddar e bacon.', variants: u(4090) },
      { code: '27', name: 'Coraçãozinho c/ Fritas', description: '350g de coraçãozinho e 450g de batata.', variants: u(4990) },
    ],
  },
  {
    name: 'Pratos',
    sendToKitchen: true,
    products: [
      { code: '30', name: 'Omelete Simples', description: '3 ovos, cebolinha, presunto e muçarela.', variants: u(1650) },
      { code: '31', name: 'Omelete de Frango', description: '3 ovos, frango, muçarela e cebolinha.', variants: u(1850) },
      { code: '32', name: 'Omelete Especial', description: '3 ovos, cebolinha, 2 carnes de hambúrguer, presunto e muçarela.', variants: u(2050) },
      { code: '33', name: 'Omelete c/ Cheddar e Bacon', description: '3 ovos, cebolinha, cheddar e bacon.', variants: u(2190) },
      { code: '34', name: 'Macarrão na Chapa', description: '2 ovos, bacon, queijo e cebolinha.', variants: u(2290) },
      { code: '35', name: 'Macarrão à Bolonhesa', description: 'Molho de carne moída, muçarela e cebolinha.', variants: u(2290) },
    ],
  },
  {
    name: 'Cervejas',
    sendToKitchen: false,
    products: [
      { code: '40', name: 'Heineken', variants: [{ name: '600ml', priceCents: 1600 }, { name: 'Long neck', priceCents: 1200 }] },
      { code: '41', name: 'Original', variants: [{ name: '600ml', priceCents: 1300 }, { name: 'Latão', priceCents: 900 }] },
      { code: '42', name: 'Brahma', variants: [{ name: '600ml', priceCents: 1100 }, { name: 'Latão', priceCents: 800 }] },
      { code: '43', name: 'Kaiser', variants: [{ name: '600ml', priceCents: 1000 }, { name: 'Latão', priceCents: 700 }] },
      { code: '44', name: 'Skol 600ml', variants: u(1100) },
      { code: '45', name: 'Stella 600ml', variants: u(1600) },
    ],
  },
  {
    name: 'Drinks e doses',
    sendToKitchen: false,
    products: [
      { code: '50', name: 'Pinga da Roça', variants: u(400) },
      { code: '51', name: 'Selvagem', variants: u(400) },
      { code: '52', name: 'Vinho', variants: u(900) },
      { code: '53', name: 'Conhaque', variants: u(500) },
      { code: '54', name: 'Caipirinha', variants: u(1700) },
      { code: '55', name: 'Caipivodka', variants: u(1800) },
      { code: '56', name: 'Cortezano', variants: u(500) },
      { code: '57', name: 'Campari', variants: u(1500) },
      { code: '58', name: 'Whisky', variants: u(2000) },
    ],
  },
  {
    name: 'Refrigerantes e sucos',
    sendToKitchen: false,
    products: [
      { code: '60', name: 'Coca-Cola 2L', variants: u(1700) },
      { code: '61', name: 'Fanta 2L', variants: u(1500) },
      { code: '62', name: 'Guarapan 2L', variants: u(1100) },
      { code: '63', name: 'Kuat 2L', variants: u(1100) },
      { code: '64', name: 'Mate Couro 1L', variants: u(900) },
      { code: '65', name: 'Refrigerante 600ml', variants: u(900) },
      { code: '66', name: 'Refrigerante Lata', variants: u(800) },
      { code: '67', name: 'Suco Tial 250ml', variants: u(700) },
      { code: '68', name: 'Suco 1L', variants: u(1200) },
      { code: '69', name: 'Água Mineral', variants: u(400) },
      { code: '70', name: 'Água Mineral c/ Gás', variants: u(500) },
    ],
  },
  {
    name: 'Guloseimas',
    sendToKitchen: false,
    products: [
      { code: '80', name: 'Trento', variants: u(500) },
      { code: '81', name: 'Kit Kat', variants: u(600) },
      { code: '82', name: 'Trident', variants: u(400) },
      { code: '83', name: 'Halls', variants: u(300) },
      { code: '84', name: 'Suflair', variants: u(1000) },
    ],
  },
];

/** Produtos, categorias e grupos que vêm no cardápio de EXEMPLO (preços inventados). */
export const EXAMPLE_PRODUCTS = [
  'X-Burguer', 'X-Egg Burguer', 'X-Bacon', 'X-Egg Bacon', 'X-Guto', 'X-Tudo', 'X-Picanha', 'X-Cabuloso',
  'Batata frita', 'Batata com cheddar e bacon', 'Refrigerante lata', 'Combo X-Burguer + Batata + Refri',
];
export const EXAMPLE_CATEGORIES = ['Lanches', 'Combos', 'Bebidas', 'Porções'];
export const EXAMPLE_GROUPS = ['Adicionais'];

/**
 * Acréscimos pagos (aparecem em verde ao escolher), passados pelo dono em 03/11/2026.
 * `maxSelect` 0 = sem limite; 1 = escolhe uma opção (ex.: troca de carne).
 */
export interface OfficialAddonGroup {
  name: string;
  categories: string[];
  /** só estes produtos da categoria (vazio = todos) */
  only?: string[];
  /** estes produtos da categoria não recebem o grupo */
  except?: string[];
  maxSelect: number;
  options: { name: string; priceCents: number }[];
}
export const OFFICIAL_ADDON_GROUPS: OfficialAddonGroup[] = [
  {
    name: 'Acréscimos',
    categories: ['Hambúrgueres'],
    maxSelect: 0,
    options: [
      { name: 'Carne de picanha', priceCents: 500 },
      { name: 'Ovo', priceCents: 200 },
      { name: 'Cheddar', priceCents: 400 },
      { name: 'Presunto', priceCents: 200 },
      { name: 'Queijo', priceCents: 200 },
      { name: 'Bacon', priceCents: 400 },
      { name: 'Frango', priceCents: 300 },
      { name: 'Carne de hambúrguer', priceCents: 200 },
    ],
  },
  {
    // X-Picanha já é de picanha; X-Tudo tem 2 carnes (grupo próprio abaixo)
    name: 'Trocar carne',
    categories: ['Hambúrgueres'],
    except: ['X-Picanha', 'X-Tudo'],
    maxSelect: 1,
    options: [{ name: 'Trocar carne por picanha', priceCents: 400 }],
  },
  {
    name: 'Trocar carnes (até 2)',
    categories: ['Hambúrgueres'],
    only: ['X-Tudo'],
    maxSelect: 2,
    options: [{ name: 'Trocar carne por picanha', priceCents: 400 }],
  },
  {
    name: 'Acréscimos da porção',
    categories: ['Porções'],
    maxSelect: 0,
    options: [
      // o dono confirmou: queijo e bacon são separados, R$ 8,00 cada
      { name: 'Cheddar', priceCents: 900 },
      { name: 'Queijo', priceCents: 800 },
      { name: 'Bacon', priceCents: 800 },
    ],
  },
];
