import { describe, expect, it } from 'vitest';
import { formatBRL, parseBRL, percentOf, splitEvenly, sumCents } from '../src/money.js';

describe('dinheiro em centavos', () => {
  it('formata em reais', () => {
    expect(formatBRL(1350)).toBe('R$ 13,50');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(0)).toBe('R$ 0,00');
  });
  it('interpreta valores digitados sem ponto flutuante', () => {
    expect(parseBRL('13,50')).toBe(1350);
    expect(parseBRL('R$ 1.234,56')).toBe(123456);
    expect(parseBRL('13.5')).toBe(1350);
    expect(parseBRL('10')).toBe(1000);
    expect(parseBRL('0,1')).toBe(10);
    expect(parseBRL('1.000')).toBe(100000);
    expect(parseBRL('abc')).toBeNull();
    expect(parseBRL('1,234')).toBeNull();
    expect(parseBRL('')).toBeNull();
  });
  it('soma exata (0,1 + 0,2)', () => {
    expect(sumCents([10, 20])).toBe(30);
    expect(() => sumCents([1.5])).toThrow();
  });
  it('percentual com arredondamento half-up', () => {
    expect(percentOf(9270, 1000)).toBe(927);
    expect(percentOf(1999, 1000)).toBe(200); // 199,9 -> 200
    expect(percentOf(1994, 1000)).toBe(199);
    expect(percentOf(1, 5000)).toBe(1);
  });
  it('divide conta sem perder centavos', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(sumCents(splitEvenly(9271, 4))).toBe(9271);
    expect(() => splitEvenly(100, 0)).toThrow();
  });
});
