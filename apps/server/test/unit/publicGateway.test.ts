import { describe, expect, it } from 'vitest';
import { publicAllowed } from '../../src/services/publicGateway.js';

describe('porteiro do cardápio na internet', () => {
  it('libera só o cardápio, o acompanhamento e os arquivos da interface', () => {
    for (const [m, u] of [['GET', '/c'], ['GET', '/c/pedido/abc123'], ['GET', '/api/public/menu'], ['GET', '/api/public/brand'], ['GET', '/api/public/orders/AbC_12-3'], ['POST', '/api/public/orders'], ['GET', '/assets/index-abc.js'], ['GET', '/uploads/x-1.png'], ['GET', '/manifest.webmanifest'], ['GET', '/sw.js'], ['GET', '/workbox-2fbc6a65.js']] as const)
      expect(publicAllowed(m, u), `${m} ${u}`).toBe('allow');
    expect(publicAllowed('GET', '/')).toBe('home');
    expect(publicAllowed('GET', '/login')).toBe('home');
    for (const [m, u] of [['GET', '/pdv'], ['GET', '/api/orders'], ['POST', '/api/auth/login'], ['GET', '/api/settings'], ['GET', '/api/events'], ['POST', '/api/orders'], ['GET', '/api/public/orders'], ['GET', '/assets/../api/users'], ['GET', '/imprimir/1'], ['DELETE', '/api/public/orders/x'], ['GET', '/api/whatsapp/webhook']] as const)
      expect(publicAllowed(m, u), `${m} ${u}`).toBe('deny');
  });
});
