import { describe, expect, it } from 'vitest';
import { editDistance, normalizeText, searchFilter, searchScore } from '../src/search';

const menu = [
  { name: 'X-Burguer', code: '1' },
  { name: 'X-Egg Burguer', code: '2' },
  { name: 'X-Bacon', code: '3' },
  { name: 'X-Tudo', code: '6' },
  { name: 'Batata frita', code: '20' },
  { name: 'Batata com cheddar e bacon', code: '21' },
  { name: 'Refrigerante lata', code: '30' },
  { name: 'Açaí', code: '50' },
];
const names = (q: string) => searchFilter(menu, q, (m) => m).map((m) => m.name);

describe('busca tolerante', () => {
  it('normaliza acentos e pontuação', () => {
    expect(normalizeText('  Açaí  com GRANOLA! ')).toBe('acai com granola');
  });
  it('distância de edição com transposição', () => {
    expect(editDistance('batata', 'batata')).toBe(0);
    expect(editDistance('btaata', 'batata')).toBe(1);
    expect(editDistance('batat', 'batata')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });
  it('código exato vem primeiro', () => {
    expect(names('3')[0]).toBe('X-Bacon');
    expect(names('20')[0]).toBe('Batata frita');
  });
  it('sem acento, sem hífen e em qualquer ordem', () => {
    expect(names('acai')).toEqual(['Açaí']);
    expect(names('xbacon')[0]).toBe('X-Bacon');
    expect(names('bacon cheddar')).toEqual(['Batata com cheddar e bacon']);
    expect(names('bat ched')).toEqual(['Batata com cheddar e bacon']);
  });
  it('aceita um erro de digitação por palavra (a partir de 4 letras)', () => {
    expect(names('btaata')).toEqual(['Batata frita', 'Batata com cheddar e bacon']);
    expect(names('refrigerantr')).toEqual(['Refrigerante lata']);
    expect(names('xtudp')[0]).toBe('X-Tudo');
  });
  it('não inventa resultados para termos curtos ou sem relação', () => {
    expect(names('zz')).toEqual([]);
    expect(names('pizza')).toEqual([]);
    expect(searchScore('', 'qualquer')).toBe(1);
  });
});
