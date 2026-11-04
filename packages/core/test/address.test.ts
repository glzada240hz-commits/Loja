import { describe, expect, it } from 'vitest';
import { findNeighborhood, parseAddressBR } from '../src/address';

const NB = [
  'Bom Sossego', 'Campos Silveira (Campo S.)', 'Novo União', 'Santa Marta', 'Santa Martinha', 'Vila', 'Centro', 'Santo Antônio',
  'São Judas', 'Hospital São Judas', 'Sevilha A', 'Sevilha B', 'Rosana', 'Rosaneves',
].map((name, i) => ({ id: `n${i}`, name }));
const id = (name: string) => NB.find((n) => n.name === name)!.id;

describe('endereço colado', () => {
  it('rua, número e bairro numa linha', () => {
    expect(parseAddressBR('Rua das Acácias, 120 - Santa Martinha', NB)).toEqual({ street: 'Rua das Acácias', number: '120', complement: '', reference: '', neighborhoodId: id('Santa Martinha') });
  });
  it('várias linhas do WhatsApp, com complemento e referência', () => {
    const r = parseAddressBR('Endereço: R. Roberto Bernardes de Lima nº 299\napto 2\nbairro santa marta\nperto da padaria do Zé', NB);
    expect(r).toEqual({ street: 'R. Roberto Bernardes de Lima', number: '299', complement: 'apto 2', reference: 'perto da padaria do Zé', neighborhoodId: id('Santa Marta') });
  });
  it('sem acento e minúsculas; nome alternativo do bairro', () => {
    expect(parseAddressBR('av brasil 450 campo s.', NB).neighborhoodId).toBe(id('Campos Silveira (Campo S.)'));
    expect(parseAddressBR('rua x 10, novo uniao', NB).neighborhoodId).toBe(id('Novo União'));
  });
  it('bairro no nome da rua: vale o que vem depois', () => {
    const r = parseAddressBR('Rua Santo Antônio, 50 - Centro', NB);
    expect(r.street).toBe('Rua Santo Antônio');
    expect(r.neighborhoodId).toBe(id('Centro'));
  });
  it('nome mais completo ganha (Hospital São Judas x São Judas; Rosaneves x Rosana)', () => {
    expect(findNeighborhood('perto do Hospital São Judas', NB)!.name).toBe('Hospital São Judas');
    expect(findNeighborhood('rua 3, 40 rosaneves', NB)!.name).toBe('Rosaneves');
    expect(findNeighborhood('Sevilha B', NB)!.name).toBe('Sevilha B');
  });
  it('sem bairro conhecido e s/n', () => {
    expect(parseAddressBR('Travessa Um s/n - Jardim Novo', NB)).toMatchObject({ street: 'Travessa Um', number: 's/n', neighborhoodId: null });
  });
});
