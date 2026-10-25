/** Relógio substituível em testes (ex.: simular pedidos após a meia-noite). */
let override: (() => Date) | null = null;

export function now(): Date {
  return override ? override() : new Date();
}

export function setClock(fn: (() => Date) | null) {
  override = fn;
}
