import { ShoppingBag } from 'lucide-react';

/** Nº da entrega do dia (1, 2, 3…), para escrever na sacola quando o entregador sai com várias. */
export function BagNumber({ n, big }: { n: number | null | undefined; big?: boolean }) {
  if (!n) return null;
  return (
    <span className={'bag-no' + (big ? ' big' : '')} title="Nº da entrega: escreva na sacola" aria-label={`Entrega número ${n}`}>
      <ShoppingBag aria-hidden /> {n}
    </span>
  );
}
