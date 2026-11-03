import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/index.js';
import { settings } from '../db/schema.js';
import { now } from '../lib/clock.js';
import { normalizePixKey } from '@guto/core';

export const storeSettingsSchema = z.object({
  storeName: z.string().min(1).max(80).default('Bar do Guto'),
  storePhone: z.string().max(30).default(''),
  storeAddress: z.string().max(200).default(''),
  /** aceita pedidos pelo cardápio digital (além de exigir dia operacional aberto) */
  onlineOrdersEnabled: z.boolean().default(true),
  onlineMinOrderCents: z.number().int().min(0).default(0),
  pickupEtaMinutes: z.number().int().min(1).max(600).default(25),
  deliveryEtaMinutes: z.number().int().min(1).max(600).default(50),
  /** limite de desconto do perfil Caixa, em pontos-base (1000 = 10%) */
  cashierMaxDiscountBp: z.number().int().min(0).max(10000).default(1000),
  kitchenLateMinutes: z.number().int().min(1).max(240).default(20),
  duplicateWindowMinutes: z.number().int().min(1).max(240).default(15),
  tables: z.array(z.string().min(1).max(20)).max(200).default(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']),
  onlinePaymentMethods: z
    .array(z.enum(['cash', 'pix_manual', 'credit', 'debit', 'voucher']))
    .default(['cash', 'pix_manual', 'credit', 'debit']),
  pixKeyDisplay: z.string().max(120).default(''),
  /** CNPJ ou CPF impresso na nota não fiscal (opcional, texto livre) */
  storeDocument: z.string().max(40).default(''),
  /** chave Pix da loja para o QR com valor impresso na conta (vazio = sem QR) */
  pixKey: z
    .string()
    .max(77)
    .default('')
    .refine((v) => !v.trim() || normalizePixKey(v) !== null, 'Chave Pix inválida: use CPF/CNPJ, e-mail, celular com +55 ou chave aleatória'),
  /** cidade de quem recebe, exigida pelo padrão do Pix */
  pixCity: z.string().max(40).default(''),
  /** logo da loja (enviada em Ajustes; só aceita arquivos enviados pelo próprio sistema) */
  logoUrl: z
    .string()
    .max(200)
    .default('')
    .refine((v) => v === '' || /^\/uploads\/logo-[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(v), 'Logo inválida'),
  /** versão do cardápio oficial já importada (controle interno) */
  officialMenuVersion: z.string().max(20).default(''),
  /** impressora do Windows onde sai a via da cozinha (vazio = impressão pelo navegador na impressora padrão) */
  kitchenPrinterName: z.string().max(200).default(''),
  /** abre a impressão da nota automaticamente quando o pedido é quitado */
  autoPrintReceipt: z.boolean().default(false),
  /** largura padrão da bobina para impressão pelo navegador */
  printWidth: z.union([z.literal(58), z.literal(80)]).default(80),
  receiptFooter: z.string().max(300).default('Obrigado pela preferência!'),
  /** respostas automáticas do WhatsApp (menu, status, atendente) */
  waAutoReplyEnabled: z.boolean().default(true),
  waGreeting: z
    .string()
    .max(500)
    .default('Olá! Você está falando com o Bar do Guto. Responda:\n1 - Cardápio e pedidos\n2 - Status do meu pedido\n3 - Falar com atendente'),
  /** retenção sugerida de dados pessoais de clientes inativos, em meses (informativo) */
  dataRetentionMonths: z.number().int().min(1).max(120).default(24),
});

export type StoreSettings = z.infer<typeof storeSettingsSchema>;

const KEY = 'store';

export async function getSettings(db: DbOrTx): Promise<StoreSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return storeSettingsSchema.parse(row?.value ?? {});
}

export async function updateSettings(db: DbOrTx, patch: Partial<StoreSettings>, userId: string) {
  const current = await getSettings(db);
  const next = storeSettingsSchema.parse({ ...current, ...patch });
  await db
    .insert(settings)
    .values({ key: KEY, value: next, updatedAt: now(), updatedBy: userId })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: now(), updatedBy: userId } });
  return next;
}
