import { describe, expect, it } from 'vitest';
import { fromMilli, toMilli } from '../../src/services/stock.js';
import { toCsv } from '../../src/services/reports.js';
import { verifySignature } from '../../src/whatsapp/webhook.js';
import { hashPassword, hmacSha256Hex, verifyPassword } from '../../src/lib/crypto.js';

describe('quantidades de estoque exatas', () => {
  it('milésimos', () => {
    expect(toMilli('1.5')).toBe(1500n);
    expect(toMilli('-0.001')).toBe(-1n);
    expect(fromMilli(toMilli('0.1') + toMilli('0.2'))).toBe('0.300');
    expect(fromMilli(-2500n)).toBe('-2.500');
    expect(() => toMilli('1,5')).toThrow();
  });
});

describe('CSV', () => {
  it('separador ;, valores em reais e proteção contra fórmula', () => {
    const csv = toCsv([{ a: '=1+1', b: 1350, c: 'x;y' }], [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B', money: true },
      { key: 'c', label: 'C' },
    ]);
    expect(csv).toBe('﻿A;B;C\r\n\'=1+1;13,50;"x;y"\r\n');
  });
});

describe('assinatura do webhook', () => {
  it('HMAC-SHA256 do corpo bruto', () => {
    const body = Buffer.from('{"a":1}');
    const sig = 'sha256=' + hmacSha256Hex('segredo', body);
    expect(verifySignature(body, sig, 'segredo')).toBe(true);
    expect(verifySignature(Buffer.from('{"a": 1}'), sig, 'segredo')).toBe(false);
    expect(verifySignature(body, sig, 'outro')).toBe(false);
    expect(verifySignature(body, undefined, 'segredo')).toBe(false);
    expect(verifySignature(body, 'sha256=zz', 'segredo')).toBe(false);
  });
});

describe('senhas', () => {
  it('scrypt com sal', async () => {
    const h1 = await hashPassword('segredo-123');
    const h2 = await hashPassword('segredo-123');
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('segredo-123', h1)).toBe(true);
    expect(await verifyPassword('errado', h1)).toBe(false);
  });
});
