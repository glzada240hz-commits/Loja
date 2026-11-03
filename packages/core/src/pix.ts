/**
 * Pix "copia e cola" / QR estático (BR Code, padrão EMV do Banco Central) para imprimir na conta.
 * Só monta o texto a partir da chave da própria loja; NÃO confirma pagamento — a conferência continua no
 * extrato/app do banco.
 */

/** Remove acentos e caracteres fora do ASCII imprimível (exigência do BR Code para nome e cidade). */
function ascii(s: string, max: number): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), como exige o BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type PixKeyKind = 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';

/**
 * Normaliza a chave como o DICT espera: CPF/CNPJ só números; celular +55DDDNÚMERO; e-mail minúsculo;
 * aleatória (EVP) minúscula. Retorna null se não reconhecer.
 */
export function normalizePixKey(raw: string): { key: string; kind: PixKeyKind } | null {
  const k = raw.trim();
  if (!k) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return { key: k.toLowerCase(), kind: 'email' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return { key: k.toLowerCase(), kind: 'random' };
  if (k.startsWith('+')) {
    const d = k.replace(/\D/g, '');
    return /^55\d{10,11}$/.test(d) ? { key: `+${d}`, kind: 'phone' } : null;
  }
  const d = k.replace(/\D/g, '');
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(k) && validCpf(d)) return { key: d, kind: 'cpf' };
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(k) && validCnpj(d)) return { key: d, kind: 'cnpj' };
  return null; // ex.: celular sem +55 (seria confundido com CPF)
}

function validCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function validCnpj(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * w[i]!;
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

export const PIX_KEY_KIND_LABEL: Record<PixKeyKind, string> = { cpf: 'CPF', cnpj: 'CNPJ', phone: 'celular', email: 'e-mail', random: 'chave aleatória' };

export interface PixInput {
  key: string;
  /** nome de quem recebe (até 25 caracteres, sem acento) */
  name: string;
  /** cidade de quem recebe (até 15 caracteres, sem acento) */
  city: string;
  amountCents?: number | null;
  /** identificador (até 25 letras/números); "***" quando não houver */
  txid?: string;
}

/** Monta o BR Code. Lança erro se a chave for inválida ou faltarem nome/cidade. */
export function buildPixPayload(input: PixInput): string {
  const nk = normalizePixKey(input.key);
  if (!nk) throw new Error('Chave Pix inválida');
  const name = ascii(input.name, 25);
  const city = ascii(input.city, 15);
  if (!name || !city) throw new Error('Nome e cidade são obrigatórios no Pix');
  const txid = (input.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let p =
    field('00', '01') +
    field('26', field('00', 'br.gov.bcb.pix') + field('01', nk.key)) +
    field('52', '0000') +
    field('53', '986');
  if (input.amountCents && input.amountCents > 0) p += field('54', (input.amountCents / 100).toFixed(2));
  p += field('58', 'BR') + field('59', name) + field('60', city) + field('62', field('05', txid));
  p += '6304';
  return p + crc16(p);
}
