/**
 * Texto lido do print da conversa (WhatsApp): encontra endereço, bairro, telefone, nome do contato,
 * valores em R$ e itens do cardápio citados. Função pura (testada). O resultado é uma SUGESTÃO para a
 * equipe conferir antes de enviar.
 */
import { parseAddressBR, findNeighborhood, type ParsedAddress } from './address.js';
import { normalizePhoneBR } from './br.js';
import { normalizeText } from './search.js';

export interface ChatProduct {
  id: string;
  name: string;
  variants: { id: string; name: string }[];
}
export interface ChatItem {
  productId: string;
  variantId: string;
  name: string;
  quantity: number;
}
export interface ChatParse {
  /** linhas do endereço encontradas (para conferência) */
  addressText: string;
  address: ParsedAddress | null;
  phone: string | null;
  name: string | null;
  /** valores em centavos citados na conversa (o maior costuma ser o total) */
  amounts: number[];
  items: ChatItem[];
}

const STREET = /\b(rua|r\.|av\.?|avenida|travessa|tv\.?|alameda|al\.|rodovia|estrada|pra[çc]a|beco|via)\s+\S/i;
const NOISE = /^(online|digitando|visto por [úu]ltimo|hoje|ontem|mensagem|clique|toque|.*\bcriptografia\b.*)/i;
const TIME = /\b\d{1,2}:\d{2}\b/g;
const NUMWORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };

/** remove horário das mensagens e marcas de leitura que o OCR lê como letras */
function cleanLine(l: string): string {
  return l.replace(TIME, ' ').replace(/[✓✔√]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseChatText(raw: string, opts: { neighborhoods: { id: string; name: string }[]; products: ChatProduct[] }): ChatParse {
  const lines = raw.split(/\r?\n/).map(cleanLine).filter((l) => l && !NOISE.test(l));

  // endereço: a linha com rua/avenida… e as duas seguintes (número, complemento, bairro, referência)
  let addressText = '';
  const idx = lines.findIndex((l) => STREET.test(l));
  if (idx >= 0) {
    const block = [lines[idx]!];
    for (const l of lines.slice(idx + 1, idx + 4)) {
      if (/r\$|\d+\s*x\b|^\d+\s+[a-z]/i.test(l) && !findNeighborhood(l, opts.neighborhoods)) break; // já é o pedido
      block.push(l);
    }
    addressText = block.join('\n');
  } else {
    const nbLine = lines.find((l) => findNeighborhood(l, opts.neighborhoods));
    if (nbLine) addressText = nbLine;
  }
  const address = addressText ? parseAddressBR(addressText, opts.neighborhoods) : null;
  if (address && !address.neighborhoodId) {
    const nb = findNeighborhood(lines.join('\n'), opts.neighborhoods);
    if (nb) address.neighborhoodId = nb.id;
  }

  // telefone (contato não salvo aparece no topo como +55 31 9…)
  let phone: string | null = null;
  for (const m of raw.matchAll(/(\+?55\s*)?\(?\d{2}\)?\s*9?\s*\d{4}[\s-]?\d{4}/g)) {
    const p = normalizePhoneBR(m[0]);
    if (p) {
      phone = p;
      break;
    }
  }

  // nome: 1ª linha do print (cabeçalho da conversa) se for só texto
  const first = lines[0] ?? '';
  const name = /^[A-Za-zÀ-ú][A-Za-zÀ-ú'. ]{1,40}$/.test(first) && !STREET.test(first) ? first.trim() : null;

  // valores em R$
  const amounts = [...raw.matchAll(/r\$\s*(\d{1,4}(?:\.\d{3})*(?:,\d{2})?)/gi)].map((m) => Math.round(Number(m[1]!.replace(/\./g, '').replace(',', '.')) * 100));

  // itens: nomes do cardápio citados (o mais longo primeiro: "Fritas c/ Cheddar e Bacon" antes de "Fritas")
  const items: (ChatItem & { pos: number })[] = [];
  const names = opts.products
    .flatMap((p) => [{ p, key: normalizeText(p.name) }, { p, key: normalizeText(p.name).replace(/ /g, '') }])
    .filter((x) => x.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length);
  for (const [li, line] of lines.entries()) {
    if (line === addressText.split('\n')[0]) continue;
    let t = ` ${normalizeText(line)} `;
    for (const { p, key } of names) {
      const at = t.indexOf(` ${key} `);
      if (at < 0) continue;
      const before = t.slice(0, at).trim().split(' ');
      const qWord = before[before.length - 1] === 'x' ? before[before.length - 2] : before[before.length - 1];
      const q = qWord && /^\d{1,2}$/.test(qWord) ? Number(qWord) : qWord && NUMWORDS[qWord] ? NUMWORDS[qWord]! : 1;
      const after = t.slice(at + key.length + 2);
      const variant = p.variants.find((v) => v.name !== 'Único' && after.startsWith(normalizeText(v.name))) ?? p.variants[0];
      if (!variant) continue;
      const ex = items.find((i) => i.variantId === variant.id);
      if (ex) ex.quantity += q;
      else items.push({ productId: p.id, variantId: variant.id, name: p.variants.length > 1 ? `${p.name} ${variant.name}` : p.name, quantity: q, pos: li * 10000 + at });
      t = t.slice(0, at) + ' ' + '_'.repeat(key.length) + ' ' + t.slice(at + key.length + 2); // não conta duas vezes
    }
  }
  // na ordem em que aparecem na conversa
  const ordered = items.sort((a, b) => a.pos - b.pos).map(({ pos: _pos, ...i }) => i);
  return { addressText, address, phone, name, amounts, items: ordered };
}
