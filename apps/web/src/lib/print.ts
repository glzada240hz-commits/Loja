/** Endereço da nota não fiscal (via do cliente). `auto` abre o diálogo de impressão sozinho. */
export const notaUrl = (orderId: string, width: number = 80, auto = true) => `/imprimir/${orderId}?via=cliente&w=${width === 58 ? 58 : 80}${auto ? '&auto=1' : ''}`;

/** Abre a nota numa janela própria para imprimir (fecha sozinha depois de imprimir). */
export function openNota(orderId: string, width?: number) {
  window.open(notaUrl(orderId, width), '_blank', 'popup,width=420,height=720');
}
