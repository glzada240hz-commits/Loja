/**
 * Endereço colado (ex.: copiado da conversa do WhatsApp): separa rua, número, complemento, referência e
 * identifica o bairro cadastrado (que define a taxa de entrega). Função pura (testada).
 */
import { normalizeText } from './search.js';

export interface ParsedAddress {
  street: string;
  number: string;
  complement: string;
  reference: string;
  /** id do bairro cadastrado encontrado no texto (null se nenhum) */
  neighborhoodId: string | null;
}

/** Nomes pelos quais o bairro pode aparecer: "Campos Silveira (Campo S.)" → "campos silveira", "campo s". */
function namesOf(name: string): string[] {
  const out = new Set<string>();
  const base = name.replace(/\(.*?\)/g, ' ');
  out.add(normalizeText(base));
  for (const m of name.matchAll(/\(([^)]*)\)/g)) out.add(normalizeText(m[1]!));
  for (const part of base.split('/')) out.add(normalizeText(part));
  return [...out].filter((n) => n.length >= 3);
}

/**
 * Bairro citado no texto. Quando há mais de um nome (ex.: "Rua Santo Antônio, 50 - Centro"), vale o que vem
 * depois (o bairro costuma vir depois da rua e do número); "bairro X" escrito por extenso tem prioridade.
 */
export function findNeighborhood<T extends { id: string; name: string }>(text: string, list: T[]): T | null {
  const t = ` ${normalizeText(text)} `;
  let best: { n: T; at: number; len: number; tagged: boolean } | null = null;
  for (const n of list) {
    for (const nm of namesOf(n.name)) {
      let from = 0;
      for (;;) {
        const at = t.indexOf(` ${nm} `, from);
        if (at < 0) break;
        from = at + 1;
        const tagged = t.slice(Math.max(0, at - 7), at) === ' bairro';
        const end = at + nm.length;
        const better =
          !best ||
          (tagged && !best.tagged) ||
          (tagged === best.tagged && (end > best.at + best.len || (end === best.at + best.len && nm.length > best.len)));
        if (better) best = { n, at, len: nm.length, tagged };
      }
    }
  }
  return best?.n ?? null;
}

const COMPLEMENT = /\b(ap(?:to|t|artamento)?\.?|casa|bloco|bl\.?|fundos|lote|lt\.?|quadra|qd\.?|sala|andar)\s*[\w-]*(?:\s*(?:bloco|bl\.?)\s*[\w-]+)?/i;
const REFERENCE = /\b(?:ponto de )?(?:refer[êe]ncia|ref\.?|perto|pr[óo]ximo|ao lado|em frente|esquina|atr[áa]s)\b[:\s-]*(.*)$/i;

export function parseAddressBR<T extends { id: string; name: string }>(raw: string, neighborhoods: T[]): ParsedAddress {
  const nb = findNeighborhood(raw, neighborhoods);
  // uma linha só: quebras de linha viram vírgula; tira rótulos e CEP
  let text = raw
    .replace(/\r?\n+/g, ', ')
    .replace(/\b(endere[çc]o|end\.?|rua:)\s*:\s*/gi, '')
    .replace(/\bcep:?\s*\d{5}-?\d{3}\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let reference = '';
  const ref = text.match(REFERENCE);
  if (ref && ref.index! > 0) {
    reference = text.slice(ref.index!).replace(/^(?:ponto de )?(?:refer[êe]ncia|ref\.?)[:\s-]*/i, '').trim();
    text = text.slice(0, ref.index!).trim();
  }

  let complement = '';
  const comp = text.match(COMPLEMENT);
  if (comp && comp.index! > 0) {
    complement = comp[0].trim();
    text = (text.slice(0, comp.index!) + ' ' + text.slice(comp.index! + comp[0].length)).trim();
  }

  // rua = texto antes do primeiro número (com letras antes); "nº 120", "120A", "s/n"
  let street = '';
  let number = '';
  const m = text.match(/^(.*?[a-zà-ú].*?)[\s,]+(?:n[º°o]?\.?\s*)?(\d+[a-z]?|s\/?n)\b/i);
  if (m) {
    street = m[1]!;
    number = m[2]!.toUpperCase() === 'SN' || /s\/?n/i.test(m[2]!) ? 's/n' : m[2]!;
  } else {
    street = text.split(/\s[-–]\s|,/)[0] ?? '';
  }
  street = street.replace(/[\s,;.-]+$/g, '').replace(/^[\s,;.-]+/g, '');
  // se o bairro veio grudado antes do número ("Rua X Centro 12"), não deixa na rua
  if (nb) {
    for (const nm of namesOf(nb.name)) {
      const ns = normalizeText(street);
      if (ns.endsWith(' ' + nm)) street = street.split(/\s+/).slice(0, -nm.split(' ').length).join(' ');
    }
  }
  return {
    street: street.trim(),
    number,
    complement: complement.replace(/[\s,;-]+$/g, ''),
    reference: reference.replace(/[\s,;-]+$/g, ''),
    neighborhoodId: nb?.id ?? null,
  };
}
