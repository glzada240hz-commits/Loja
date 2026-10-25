import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { phoneVariantsBR } from '@guto/core';
import type { DbOrTx } from '../db/index.js';
import { customers, orders, quickReplies, waContacts, waMessages, waTemplates, waWebhookEvents } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { now } from '../lib/clock.js';
import { inTx, requirePerm, type Ctx } from '../lib/context.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { idempotent, type IdemKey } from '../lib/idempotency.js';
import { menuUrl, windowOpen } from './notify.js';

export async function listConversations(ctx: Ctx, q?: string) {
  requirePerm(ctx.actor, 'whatsapp.inbox');
  const conds = [];
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    conds.push(or(ilike(waContacts.profileName, like), ilike(waContacts.waId, `%${q.replace(/\D/g, '') || q}%`), ilike(customers.name, like))!);
  }
  const rows = await ctx.db
    .select({
      id: waContacts.id,
      waId: waContacts.waId,
      profileName: waContacts.profileName,
      customerId: waContacts.customerId,
      customerName: customers.name,
      lastInboundAt: waContacts.lastInboundAt,
      lastMessageAt: waContacts.lastMessageAt,
      unreadCount: waContacts.unreadCount,
      botPaused: waContacts.botPaused,
      needsHuman: waContacts.needsHuman,
      optOutAt: waContacts.optOutAt,
      lastBody: sql<string | null>`(select body from wa_messages m where m.contact_id = ${waContacts.id} order by m.created_at desc limit 1)`,
      failedCount: sql<number>`(select count(*)::int from wa_messages m where m.contact_id = ${waContacts.id} and m.status = 'failed')`,
    })
    .from(waContacts)
    .leftJoin(customers, eq(customers.id, waContacts.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(waContacts.needsHuman), sql`${waContacts.lastMessageAt} desc nulls last`)
    .limit(200);
  return rows.map((r) => ({ ...r, windowOpen: windowOpen(r.lastInboundAt) }));
}

export async function getConversation(ctx: Ctx, contactId: string) {
  requirePerm(ctx.actor, 'whatsapp.inbox');
  const [c] = await ctx.db.select().from(waContacts).where(eq(waContacts.id, contactId));
  if (!c) throw notFound('Conversa não encontrada');
  const messages = await ctx.db.select().from(waMessages).where(eq(waMessages.contactId, contactId)).orderBy(asc(waMessages.createdAt)).limit(500);
  const [customer] = c.customerId ? await ctx.db.select().from(customers).where(eq(customers.id, c.customerId)) : [];
  const recentOrders = await ctx.db
    .select({ id: orders.id, number: orders.number, status: orders.status, stage: orders.stage, totalCents: orders.totalCents, createdAt: orders.createdAt, type: orders.type })
    .from(orders)
    .where(inArray(orders.customerPhone, phoneVariantsBR(c.waId)))
    .orderBy(desc(orders.createdAt))
    .limit(10);
  if (c.unreadCount > 0) {
    await ctx.db.update(waContacts).set({ unreadCount: 0 }).where(eq(waContacts.id, c.id));
    ctx.bus.publish({ type: 'whatsapp.changed', contactId: c.id });
  }
  return { contact: { ...c, windowOpen: windowOpen(c.lastInboundAt) }, customer: customer ?? null, messages, orders: recentOrders };
}

/** Mensagem livre do atendente: só dentro da janela de 24h aberta pelo cliente. */
export async function sendAgentMessage(ctx: Ctx, contactId: string, body: string, idem?: IdemKey) {
  requirePerm(ctx.actor, 'whatsapp.inbox');
  const text = body?.trim();
  if (!text) throw badRequest('Mensagem vazia');
  if (text.length > 4096) throw badRequest('Mensagem muito longa');
  return inTx(ctx, async (tx, emit) => {
    const r = await idempotent(tx, idem, async () => {
      const [c] = await tx.select().from(waContacts).where(eq(waContacts.id, contactId));
      if (!c) throw notFound('Conversa não encontrada');
      if (!windowOpen(c.lastInboundAt)) {
        throw new AppError(422, 'window_closed', 'A janela de 24h está fechada. Só é possível enviar um template aprovado até o cliente responder.');
      }
      const [m] = await tx
        .insert(waMessages)
        .values({ contactId, direction: 'out', type: 'text', body: text, status: 'queued', nextAttemptAt: now(), createdBy: ctx.actor.userId, createdAt: now() })
        .returning();
      await tx.update(waContacts).set({ lastMessageAt: now() }).where(eq(waContacts.id, contactId));
      return { id: m!.id };
    });
    emit({ type: 'wa.outbox' });
    emit({ type: 'whatsapp.changed', contactId });
    return r.value;
  });
}

export async function sendMenuLink(ctx: Ctx, contactId: string) {
  return sendAgentMessage(ctx, contactId, `Confira nosso cardápio e faça seu pedido: ${menuUrl()}`);
}

export async function retryMessage(ctx: Ctx, messageId: string) {
  requirePerm(ctx.actor, 'whatsapp.inbox');
  return inTx(ctx, async (tx, emit) => {
    const [m] = await tx.select().from(waMessages).where(eq(waMessages.id, messageId)).for('update');
    if (!m || m.direction !== 'out') throw notFound();
    if (m.status !== 'failed') throw conflict('Somente mensagens com falha podem ser reenviadas');
    await tx.update(waMessages).set({ status: 'queued', nextAttemptAt: now(), attempts: 0, error: null }).where(eq(waMessages.id, m.id));
    await audit(tx, ctx.actor, 'whatsapp.retry', 'wa_message', m.id);
    emit({ type: 'wa.outbox' });
    emit({ type: 'whatsapp.changed', contactId: m.contactId });
    return { id: m.id };
  });
}

export async function updateContact(
  ctx: Ctx,
  contactId: string,
  patch: { botPaused?: boolean; needsHuman?: boolean; optInOrderUpdates?: boolean; optInMarketing?: boolean; customerId?: string | null },
) {
  requirePerm(ctx.actor, 'whatsapp.inbox');
  return inTx(ctx, async (tx, emit) => {
    const [c] = await tx.select().from(waContacts).where(eq(waContacts.id, contactId)).for('update');
    if (!c) throw notFound();
    const set: Partial<typeof waContacts.$inferInsert> = {};
    if (patch.botPaused !== undefined) set.botPaused = patch.botPaused;
    if (patch.needsHuman !== undefined) set.needsHuman = patch.needsHuman;
    if (patch.optInOrderUpdates !== undefined || patch.optInMarketing !== undefined) {
      // consentimento registrado pelo atendente (ex.: cliente pediu por telefone)
      if (patch.optInOrderUpdates !== undefined) set.optInOrderUpdates = patch.optInOrderUpdates;
      if (patch.optInMarketing !== undefined) set.optInMarketing = patch.optInMarketing;
      if (patch.optInOrderUpdates || patch.optInMarketing) {
        set.optInAt = now();
        set.optInSource = 'atendente:' + ctx.actor.name;
        set.optOutAt = null;
      }
      if (patch.optInOrderUpdates === false && !patch.optInMarketing) set.optOutAt = now();
    }
    if (patch.customerId !== undefined) set.customerId = patch.customerId;
    await tx.update(waContacts).set(set).where(eq(waContacts.id, contactId));
    await audit(tx, ctx.actor, 'whatsapp.contact.update', 'wa_contact', contactId, patch);
    emit({ type: 'whatsapp.changed', contactId });
    return { id: contactId };
  });
}

export async function listQuickReplies(db: DbOrTx) {
  return db.select().from(quickReplies).orderBy(asc(quickReplies.sort), asc(quickReplies.title));
}

export async function saveQuickReply(ctx: Ctx, input: { id?: string; title: string; body: string; sort?: number }) {
  requirePerm(ctx.actor, 'settings.manage');
  if (!input.title?.trim() || !input.body?.trim()) throw badRequest('Título e texto são obrigatórios');
  const vals = { title: input.title.trim(), body: input.body.trim(), sort: input.sort ?? 0 };
  const [r] = input.id ? await ctx.db.update(quickReplies).set(vals).where(eq(quickReplies.id, input.id)).returning() : await ctx.db.insert(quickReplies).values(vals).returning();
  return r;
}

export async function deleteQuickReply(ctx: Ctx, id: string) {
  requirePerm(ctx.actor, 'settings.manage');
  await ctx.db.delete(quickReplies).where(eq(quickReplies.id, id));
}

export async function listTemplates(db: DbOrTx) {
  return db.select().from(waTemplates).orderBy(asc(waTemplates.purpose));
}

export async function saveTemplate(ctx: Ctx, input: { purpose: string; name: string; language: string; bodyPreview: string; active: boolean }) {
  requirePerm(ctx.actor, 'whatsapp.configure');
  if (!/^[a-z0-9_]{1,512}$/.test(input.name)) throw badRequest('Nome do template inválido (use o nome exato aprovado na Meta)');
  const [r] = await ctx.db
    .insert(waTemplates)
    .values(input)
    .onConflictDoUpdate({ target: waTemplates.purpose, set: { name: input.name, language: input.language, bodyPreview: input.bodyPreview, active: input.active } })
    .returning();
  await audit(ctx.db, ctx.actor, 'whatsapp.template.save', 'wa_template', r!.id, input);
  return r;
}

/** Painel de monitoramento: falhas de envio e de processamento de webhooks. */
export async function monitor(ctx: Ctx) {
  requirePerm(ctx.actor, 'whatsapp.inbox');
  const failedMessages = await ctx.db
    .select({ m: waMessages, waId: waContacts.waId, profileName: waContacts.profileName })
    .from(waMessages)
    .innerJoin(waContacts, eq(waContacts.id, waMessages.contactId))
    .where(eq(waMessages.status, 'failed'))
    .orderBy(desc(waMessages.createdAt))
    .limit(50);
  const queue = await ctx.db
    .select({ status: waMessages.status, count: sql<number>`count(*)::int` })
    .from(waMessages)
    .where(inArray(waMessages.status, ['queued', 'sending', 'failed']))
    .groupBy(waMessages.status);
  const events = await ctx.db
    .select({ status: waWebhookEvents.status, count: sql<number>`count(*)::int` })
    .from(waWebhookEvents)
    .groupBy(waWebhookEvents.status);
  const failedEvents = await ctx.db
    .select({ id: waWebhookEvents.id, kind: waWebhookEvents.kind, attempts: waWebhookEvents.attempts, error: waWebhookEvents.error, receivedAt: waWebhookEvents.receivedAt, status: waWebhookEvents.status })
    .from(waWebhookEvents)
    .where(or(eq(waWebhookEvents.status, 'failed'), and(eq(waWebhookEvents.status, 'pending'), sql`${waWebhookEvents.attempts} > 0`)))
    .orderBy(desc(waWebhookEvents.receivedAt))
    .limit(50);
  return {
    failedMessages: failedMessages.map((r) => ({ ...r.m, waId: r.waId, profileName: r.profileName })),
    queue,
    events,
    failedEvents,
  };
}

export async function retryWebhookEvent(ctx: Ctx, eventId: string) {
  requirePerm(ctx.actor, 'whatsapp.inbox');
  await ctx.db.update(waWebhookEvents).set({ status: 'pending', nextAttemptAt: now() }).where(eq(waWebhookEvents.id, eventId));
}
