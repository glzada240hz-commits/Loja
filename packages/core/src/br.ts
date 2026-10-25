export const STORE_TIMEZONE = 'America/Sao_Paulo';

/**
 * Normaliza telefone brasileiro para dígitos E.164 sem "+" (ex.: 5511987654321).
 * Aceita "(11) 98765-4321", "+55 11 98765-4321", "11987654321".
 * Retorna null se não parecer um telefone válido.
 */
export function normalizePhoneBR(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!d.startsWith('55')) {
    // número internacional: aceita 8 a 15 dígitos (E.164)
    return d.length >= 8 && d.length <= 15 ? d : null;
  }
  if (d.length !== 12 && d.length !== 13) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  return d;
}

/** 5511987654321 -> "(11) 98765-4321" */
export function formatPhoneBR(e164: string | null | undefined): string {
  if (!e164) return '';
  if (!e164.startsWith('55') || (e164.length !== 12 && e164.length !== 13)) return '+' + e164;
  const ddd = e164.slice(2, 4);
  const num = e164.slice(4);
  const split = num.length === 9 ? 5 : 4;
  return `(${ddd}) ${num.slice(0, split)}-${num.slice(split)}`;
}

/** Variantes com/sem o nono dígito para casar números vindos do WhatsApp. */
export function phoneVariantsBR(e164: string): string[] {
  const out = new Set([e164]);
  if (e164.startsWith('55') && e164.length === 13 && e164[4] === '9') {
    out.add(e164.slice(0, 4) + e164.slice(5));
  } else if (e164.startsWith('55') && e164.length === 12) {
    out.add(e164.slice(0, 4) + '9' + e164.slice(4));
  }
  return [...out];
}

const dtf = new Intl.DateTimeFormat('pt-BR', {
  timeZone: STORE_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const tf = new Intl.DateTimeFormat('pt-BR', { timeZone: STORE_TIMEZONE, hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('pt-BR', { timeZone: STORE_TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric' });

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  return dtf.format(new Date(d)).replace(',', '');
}
export function formatTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  return tf.format(new Date(d));
}
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return df.format(new Date(d));
}

/** Data local (YYYY-MM-DD) na loja, para identificar o dia de abertura do turno. */
export function localDateISO(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STORE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts; // en-CA já usa YYYY-MM-DD
}

/** Hora local (0-23) na loja. */
export function localHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: STORE_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(d),
  );
}

/** Minutos decorridos entre duas datas (arredondado para baixo). */
export function minutesBetween(a: Date | string, b: Date | string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** Link de navegação a partir de um endereço textual (não calcula distância). */
export function mapsLink(address: string): string {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address);
}
