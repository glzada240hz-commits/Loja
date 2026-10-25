import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Deps } from './lib/context.js';
import { purgeExpiredSessions } from './services/auth.js';
import { processOutbox, recoverStuck } from './whatsapp/outbox.js';
import { DemoProvider, type WaProvider } from './whatsapp/provider.js';
import { buildStatusPayload, ingestWebhook, retryPendingEvents } from './whatsapp/webhook.js';

export interface Workers {
  stop(): void;
  tick(): Promise<void>;
}

/** Laços em segundo plano: fila do WhatsApp, reprocessamento de webhooks e limpeza. */
export function startWorkers(deps: Deps, wa: WaProvider, log: FastifyBaseLogger): Workers {
  let running = false;
  let again = false;
  let demoIndex = wa instanceof DemoProvider ? wa.sent.length : 0;

  async function tick() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await processOutbox(deps, wa);
        if (wa instanceof DemoProvider) {
          // modo demonstrativo: simula o recibo de entrega pelo mesmo caminho do webhook real
          const fresh = wa.sent.slice(demoIndex);
          demoIndex = wa.sent.length;
          for (const s of fresh) await ingestWebhook(deps, buildStatusPayload(s.wamid, 'delivered', s.to));
        }
        await retryPendingEvents(deps);
      } while (again);
    } catch (e) {
      log.error({ err: e }, 'worker WhatsApp falhou');
    } finally {
      running = false;
    }
  }

  const onEvent = (e: { type: string }) => {
    if (e.type === 'wa.outbox') setTimeout(() => void tick(), 50);
  };
  deps.bus.on('event', onEvent);
  const interval = setInterval(() => void tick(), 5000);
  const housekeeping = setInterval(() => {
    void (async () => {
      try {
        await recoverStuck(deps);
        await purgeExpiredSessions(deps.db);
        await deps.db.execute(sql`delete from idempotency_keys where created_at < now() - interval '3 days'`);
      } catch (e) {
        log.error({ err: e }, 'limpeza periódica falhou');
      }
    })();
  }, 10 * 60000);
  void recoverStuck(deps).catch(() => undefined);

  return {
    tick,
    stop() {
      clearInterval(interval);
      clearInterval(housekeeping);
      deps.bus.off('event', onEvent);
    },
  };
}
