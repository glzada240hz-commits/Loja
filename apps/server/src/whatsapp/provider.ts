import { randomToken } from '../lib/crypto.js';

export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public code?: string,
  ) {
    super(message);
  }
}

export interface SendResult {
  wamid: string;
}

export interface TemplateMessage {
  name: string;
  language: string;
  bodyParams: string[];
}

export interface WaProvider {
  readonly mode: 'demo' | 'cloud';
  sendText(to: string, body: string): Promise<SendResult>;
  sendTemplate(to: string, t: TemplateMessage): Promise<SendResult>;
}

/**
 * Provedor oficial: WhatsApp Business Platform (Cloud API) da Meta.
 * POST https://graph.facebook.com/{versão}/{phone-number-id}/messages
 * Requer número verificado, token de acesso de usuário de sistema e templates aprovados.
 */
export class CloudApiProvider implements WaProvider {
  readonly mode = 'cloud' as const;
  constructor(
    private cfg: { graphVersion: string; phoneNumberId: string; accessToken: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async post(payload: unknown): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new ProviderError('Falha de rede ao contatar a API do WhatsApp: ' + (e as Error).message, true, 'network');
    }
    const body = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (res.ok && body.messages?.[0]?.id) return { wamid: body.messages[0].id };
    const code = body.error?.code;
    // 429/5xx e limites de taxa (4, 80007, 130429, 131048, 131056) podem ser repetidos depois
    const retryable = res.status >= 500 || res.status === 429 || [4, 80007, 130429, 131048, 131056].includes(code ?? -1);
    throw new ProviderError(`WhatsApp API ${res.status}: ${body.error?.message ?? 'erro desconhecido'}`, retryable, code ? String(code) : String(res.status));
  }

  sendText(to: string, body: string) {
    return this.post({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: true, body } });
  }

  sendTemplate(to: string, t: TemplateMessage) {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: t.name,
        language: { code: t.language },
        components: t.bodyParams.length ? [{ type: 'body', parameters: t.bodyParams.map((text) => ({ type: 'text', text })) }] : [],
      },
    });
  }
}

/**
 * MODO DEMONSTRATIVO: nenhuma mensagem sai do servidor. Usado sem credenciais
 * e nos testes. Permite simular falhas para validar tentativas e recuperação.
 */
export class DemoProvider implements WaProvider {
  readonly mode = 'demo' as const;
  readonly sent: { to: string; kind: 'text' | 'template'; body: string; wamid: string }[] = [];
  private failures: { retryable: boolean }[] = [];

  failNext(count: number, retryable = true) {
    for (let i = 0; i < count; i++) this.failures.push({ retryable });
  }

  private async deliver(to: string, kind: 'text' | 'template', body: string) {
    const f = this.failures.shift();
    if (f) throw new ProviderError('Falha simulada (modo demonstrativo)', f.retryable, 'demo');
    const wamid = 'demo.' + randomToken(12);
    this.sent.push({ to, kind, body, wamid });
    return { wamid };
  }

  sendText(to: string, body: string) {
    return this.deliver(to, 'text', body);
  }
  sendTemplate(to: string, t: TemplateMessage) {
    return this.deliver(to, 'template', `[template ${t.name}] ${t.bodyParams.join(' | ')}`);
  }
}
