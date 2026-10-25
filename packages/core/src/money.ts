/**
 * Valores monetários são sempre centavos inteiros (number com inteiro seguro).
 * Nunca use ponto flutuante para somar dinheiro.
 */
export type Cents = number;

export function assertCents(value: number, label = 'valor'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} deve ser um inteiro em centavos`);
  }
  return value;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 1350 -> "R$ 13,50" */
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100).replace(/\u00a0/g, ' ');
}

/**
 * Converte texto digitado ("13,50", "13.50", "R$ 1.234,56", "10") em centavos,
 * sem usar aritmética de ponto flutuante. Retorna null se inválido.
 */
export function parseBRL(input: string): Cents | null {
  let s = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (s === '') return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  let intPart: string;
  let fracPart = '';
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastComma > lastDot) {
    intPart = s.slice(0, lastComma).replace(/\./g, '');
    fracPart = s.slice(lastComma + 1);
  } else if (lastDot >= 0 && lastComma < 0 && s.length - lastDot - 1 <= 2 && s.indexOf('.') === lastDot) {
    // "13.50" ou "13.5" — ponto como separador decimal
    intPart = s.slice(0, lastDot);
    fracPart = s.slice(lastDot + 1);
  } else {
    intPart = s.replace(/[.,]/g, '');
  }
  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(fracPart)) return null;
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Multiplica centavos por pontos-base (1% = 100 bp), arredondando meio para cima. */
export function percentOf(cents: Cents, basisPoints: number): Cents {
  assertCents(cents);
  if (!Number.isInteger(basisPoints)) throw new RangeError('percentual inválido');
  // inteiro exato: (cents * bp) / 10000 com arredondamento half-up
  const num = cents * basisPoints;
  if (!Number.isSafeInteger(num)) throw new RangeError('valor muito alto');
  const sign = num < 0 ? -1 : 1;
  const abs = Math.abs(num);
  return sign * Math.floor((abs + 5000) / 10000);
}

/**
 * Divide um total em N partes exatas; os centavos restantes vão para as primeiras partes.
 * splitEvenly(1000, 3) -> [334, 333, 333]
 */
export function splitEvenly(total: Cents, parts: number): Cents[] {
  assertCents(total);
  if (!Number.isInteger(parts) || parts < 1 || parts > 100) throw new RangeError('número de partes inválido');
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

export function sumCents(values: Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total, 'soma');
}
