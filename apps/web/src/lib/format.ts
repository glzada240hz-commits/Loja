export { formatBRL as brl, formatDateTime, formatTime, formatDate, formatPhoneBR, parseBRL } from '@guto/core';

export function minutesSince(d: string | Date | null | undefined, now = Date.now()) {
  if (!d) return 0;
  return Math.max(0, Math.floor((now - new Date(d).getTime()) / 60000));
}

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function daysAgoISO(n: number) {
  const d = new Date(Date.now() - n * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addressLine(o: { addrStreet?: string | null; addrNumber?: string | null; addrComplement?: string | null; neighborhoodName?: string | null }) {
  return [o.addrStreet && `${o.addrStreet}, ${o.addrNumber ?? 's/n'}`, o.addrComplement, o.neighborhoodName].filter(Boolean).join(' — ');
}

/** "8 min", "1 h 05" — tempo de mesa aberta ou de espera, curto para caber em cartões. */
export function elapsedLabel(d: string | Date | null | undefined, now = Date.now()) {
  const m = minutesSince(d, now);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** Nome sem o sufixo "(demo)" e só o primeiro nome + inicial, para cartões estreitos. */
export function shortName(name: string | null | undefined) {
  if (!name) return '—';
  const words = name.replace(/\s*\(.*?\)\s*/g, ' ').trim().split(/\s+/);
  return words.length > 2 ? `${words[0]} ${words[1]}` : words.join(' ');
}
