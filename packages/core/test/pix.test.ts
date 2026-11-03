import { describe, expect, it } from 'vitest';
import { buildPixPayload, crc16, normalizePixKey } from '../src/pix.js';

describe('Pix (BR Code estático)', () => {
  it('reproduz o exemplo do manual do Banco Central (CRC 1D3D)', () => {
    expect(
      buildPixPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'BRASILIA' }),
    ).toBe('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
  });

  it('inclui valor, identificador do pedido e remove acentos', () => {
    const p = buildPixPayload({ key: '+55 (11) 99999-8888', name: 'Bar do Guto Lanchonete e Petiscaria', city: 'São Paulo', amountCents: 5080, txid: 'PED-42' });
    expect(p).toContain('0114+5511999998888');
    expect(p).toContain('540550.80');
    expect(p).toContain('5925Bar do Guto Lanchonete e');
    expect(p).toContain('6009Sao Paulo');
    expect(p).toContain('62090505PED42');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });

  it('normaliza e valida chaves', () => {
    expect(normalizePixKey('529.982.247-25')).toEqual({ key: '52998224725', kind: 'cpf' });
    expect(normalizePixKey('11.222.333/0001-81')).toEqual({ key: '11222333000181', kind: 'cnpj' });
    expect(normalizePixKey('529.982.247-26')).toBeNull(); // dígito verificador errado
    expect(normalizePixKey('Loja@Exemplo.com')).toEqual({ key: 'loja@exemplo.com', kind: 'email' });
    expect(normalizePixKey('+5511988887777')?.kind).toBe('phone');
    expect(normalizePixKey('11988887777')).toBeNull(); // ambíguo: celular precisa do +55
    expect(normalizePixKey('abc')).toBeNull();
    expect(() => buildPixPayload({ key: 'abc', name: 'X', city: 'Y' })).toThrow('Chave Pix inválida');
  });
});
