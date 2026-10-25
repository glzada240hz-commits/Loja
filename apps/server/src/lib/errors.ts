export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Faça login para continuar') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Seu perfil não tem permissão para esta ação') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Registro não encontrado') => new AppError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'conflict', msg, details);
/** Edição concorrente: o registro mudou desde que foi carregado. */
export const staleVersion = () =>
  new AppError(409, 'stale_version', 'Este pedido foi alterado em outro dispositivo. Recarregue para ver a versão atual.');
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, 'unprocessable', msg, details);
