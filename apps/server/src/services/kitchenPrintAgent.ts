/**
 * Impressão da cozinha numa impressora ESCOLHIDA (modo loja com duas impressoras: caixa e cozinha).
 *
 * O navegador só imprime na impressora padrão do Windows (a do caixa, para a nota). Para a via da cozinha
 * sair na outra impressora, o servidor coloca cada via numa fila de arquivos em PRINT_DIR/fila e o aplicativo
 * BarDoGuto.exe (que roda no mesmo computador) imprime na impressora pelo nome. O aplicativo também informa as
 * impressoras instaladas (impressoras.txt) e o resultado da última impressão (estado.txt).
 *
 * Só funciona quando "Impressora da cozinha" está escolhida em Celulares e cozinha (kitchenPrinterName).
 * Cada envio é impresso uma vez (registro em impressos.json); o que existia antes de escolher não é impresso.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pendingPrints, ticketLines, testTicket, type PrintKind, type PrintLine, type PrintTicket, type PrintedMap } from '@guto/core';
import type { Deps } from '../lib/context.js';
import { kitchenQueue } from './kitchen.js';
import { getSettings } from './settings.js';
import { now } from '../lib/clock.js';

interface AgentState {
  printer: string;
  since: number;
  done: PrintedMap;
}

const LINE_CODE: Record<PrintLine['style'], string> = { title: 'T', big: 'B', place: 'P', center: 'C', rule: 'R', item: 'I', mod: 'M', text: 'X' };

/** Arquivo de trabalho lido pelo BarDoGuto.exe: 1ª linha impressora, 2ª largura, depois "código<TAB>texto". */
export function jobText(printer: string, width: number, lines: PrintLine[]): string {
  const clean = (t: string) => t.replace(/[\t\r\n]+/g, ' ');
  return [`IMPRESSORA\t${clean(printer)}`, `LARGURA\t${width === 58 ? 58 : 80}`, ...lines.map((l) => `${LINE_CODE[l.style]}\t${clean(l.text)}`)].join('\r\n') + '\r\n';
}

export function writeJob(printDir: string, name: string, content: string) {
  const dir = path.join(printDir, 'fila');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${name.replace(/[^\w-]/g, '')}.txt`);
  fs.writeFileSync(file + '.tmp', '\uFEFF' + content, 'utf8'); // BOM: o aplicativo lê acentos certo
  fs.renameSync(file + '.tmp', file); // o aplicativo só vê o arquivo completo
  return file;
}

export interface PrinterInfo {
  agent: boolean;
  printers: string[];
  defaultPrinter: string | null;
  last: { ok: boolean; at: string; message: string } | null;
}

/** O que o aplicativo do Windows informou (impressoras instaladas e última impressão). */
export function readPrinterInfo(printDir: string | undefined): PrinterInfo {
  const none: PrinterInfo = { agent: false, printers: [], defaultPrinter: null, last: null };
  if (!printDir) return none;
  try {
    const f = path.join(printDir, 'impressoras.txt');
    const st = fs.statSync(f);
    const lines = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    const printers = lines.filter((l) => l.startsWith('IMPRESSORA\t')).map((l) => l.slice(11));
    const def = lines.find((l) => l.startsWith('PADRAO\t'))?.slice(7) ?? null;
    let last: PrinterInfo['last'] = null;
    try {
      const [kind, at, ...msg] = fs.readFileSync(path.join(printDir, 'estado.txt'), 'utf8').replace(/^\uFEFF/, '').trim().split('\t');
      last = { ok: kind === 'OK', at: at ?? '', message: msg.join(' ') };
    } catch {
      /* ainda não imprimiu */
    }
    // o aplicativo regrava a lista a cada minuto: mais velha que 3 min = aplicativo fechado
    return { agent: Date.now() - st.mtimeMs < 180_000, printers, defaultPrinter: def, last };
  } catch {
    return none;
  }
}

export function queueTestPrint(printDir: string, printer: string, width: number) {
  return writeJob(printDir, 'teste', jobText(printer, width, ticketLines(testTicket(), 'novo')));
}

export function startKitchenPrintAgent(deps: Deps, printDir: string, log: { warn: (o: unknown, m?: string) => void }) {
  const stateFile = path.join(printDir, 'impressos.json');
  const read = (): AgentState | null => {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as AgentState;
    } catch {
      return null;
    }
  };
  const save = (s: AgentState) => {
    const cut = now().getTime() - 36 * 3600_000;
    for (const [k, v] of Object.entries(s.done)) if (v.at < cut) delete s.done[k];
    fs.mkdirSync(printDir, { recursive: true });
    fs.writeFileSync(stateFile + '.tmp', JSON.stringify(s));
    fs.renameSync(stateFile + '.tmp', stateFile);
  };

  // uma conferência por vez, em fila (quem chama com await espera a sua terminar)
  let chain: Promise<void> = Promise.resolve();
  const check = () => (chain = chain.then(run, run));
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
  const run = async () => {
    try {
      const st = await getSettings(deps.db);
      const printer = st.kitchenPrinterName.trim();
      if (!printer) return;
      let state = read();
      // impressora escolhida agora (ou trocada): começa a partir deste momento
      if (!state || state.printer !== printer) state = { printer, since: now().getTime(), done: state?.done ?? {} };
      const tickets = ((await kitchenQueue(deps.db)) as unknown as (PrintTicket & { createdAt: unknown; changedAt: unknown })[]).map((t) => ({
        ...t,
        createdAt: iso(t.createdAt)!,
        changedAt: iso(t.changedAt),
      })) as PrintTicket[];
      const todo: { ticket: PrintTicket; kind: PrintKind }[] = pendingPrints(tickets, state.done, state.since);
      for (const { ticket, kind } of todo) {
        writeJob(printDir, `${ticket.orderNumber}-${kind}`, jobText(printer, st.printWidth, ticketLines(ticket, kind)));
        state.done[ticket.id] = { at: now().getTime(), changedAt: ticket.changedAt, cancelled: kind === 'cancelado' || undefined };
      }
      save(state);
    } catch (e) {
      log.warn({ err: e }, 'impressão da cozinha: falha ao preparar a via');
    }
  };

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const onEvent = (ev: { type: string }) => {
    if (ev.type !== 'kitchen.changed' && ev.type !== 'order.changed' && ev.type !== 'menu.changed') return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void check(), 300);
  };
  deps.bus.on('event', onEvent);
  const timer = setInterval(() => void check(), 15_000);
  void check();
  return {
    check,
    stop() {
      deps.bus.off('event', onEvent);
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
    },
  };
}
