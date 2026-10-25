export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

export function newIdemKey() {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
}

interface Opts {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Chamada à API. Erros de rede viram ApiError com código "network" — a interface deixa claro que NADA foi salvo. */
export async function api<T = any>(method: string, url: string, body?: unknown, opts: Opts = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      signal: opts.signal,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-requested-with': 'guto',
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Sem conexão com o servidor. A operação NÃO foi confirmada — verifique a conexão e tente novamente.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = data?.error;
    if (res.status === 401 && url !== '/api/auth/login' && url !== '/api/auth/me') window.dispatchEvent(new Event('guto:unauthorized'));
    throw new ApiError(res.status, err?.code ?? 'http_' + res.status, err?.message ?? `Erro ${res.status}`, err?.details);
  }
  return data as T;
}

export const get = <T = any>(url: string, signal?: AbortSignal) => api<T>('GET', url, undefined, { signal });
export const post = <T = any>(url: string, body: unknown = {}, opts?: Opts) => api<T>('POST', url, body, opts);
export const patch = <T = any>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const put = <T = any>(url: string, body: unknown) => api<T>('PUT', url, body);
export const del = <T = any>(url: string) => api<T>('DELETE', url);

export async function upload<T = any>(url: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'x-requested-with': 'guto' } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'upload', data?.error?.message ?? 'Falha no envio');
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? '?' + str : '';
}
