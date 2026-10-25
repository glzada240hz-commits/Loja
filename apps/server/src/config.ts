import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  UPLOAD_DIR: z.string().default('./uploads'),
  WEB_DIST: z.string().optional(),
  WHATSAPP_MODE: z.enum(['demo', 'cloud']).default('demo'),
  WHATSAPP_GRAPH_VERSION: z.string().default('v23.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  /** Desliga workers em segundo plano (testes controlam manualmente). */
  DISABLE_WORKERS: z.coerce.boolean().default(false),
  LOG_LEVEL: z.string().default('info'),
  /** tentativas de login por minuto por IP */
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  /** pedidos pelo cardápio digital a cada 5 minutos por IP */
  CHECKOUT_RATE_LIMIT: z.coerce.number().int().min(1).default(8),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    throw new Error('Configuração inválida: ' + parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '));
  }
  const c = parsed.data;
  if (c.WHATSAPP_MODE === 'cloud') {
    const missing = (['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] as const).filter(
      (k) => !c[k],
    );
    if (missing.length) throw new Error('WHATSAPP_MODE=cloud exige: ' + missing.join(', '));
  }
  return c;
}
