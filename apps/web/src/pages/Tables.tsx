import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { Button, Empty, Loading, Money } from '../components/ui';
import { get, qs } from '../lib/api';
import { minutesSince } from '../lib/format';
import { useDay, useSettings } from '../lib/queries';
import type { OrderRow } from '../lib/types';

export default function Tables() {
  const settings = useSettings();
  const day = useDay();
  const nav = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ['tables', day.data?.day?.id],
    queryFn: () => get<OrderRow[]>('/api/orders' + qs({ type: 'table', status: 'open,pending', dayId: day.data?.day?.id })),
    enabled: !!day.data?.day,
  });
  if (settings.isLoading || day.isLoading) return <Layout title="Mesas"><Loading /></Layout>;
  if (!day.data?.day) return <Layout title="Mesas"><Empty title="Dia operacional fechado" /></Layout>;
  const tables: string[] = settings.data?.tables ?? [];
  return (
    <Layout title="Mesas e comandas">
      <p className="muted">Toque numa mesa livre para abrir comanda; numa ocupada para ver, adicionar itens ou cobrar.</p>
      <div className="tables-grid">
        {tables.map((t) => {
          const o = orders.data?.find((x) => x.tableLabel === t);
          return (
            <button
              key={t}
              type="button"
              className={'table-tile' + (o ? (o.stage === 'ready' || o.stage === 'delivered' ? ' ready' : ' busy') : '')}
              onClick={() => (o ? setOpen(o.id) : nav(`/pdv?tipo=table&mesa=${encodeURIComponent(t)}`))}
            >
              <span className="tnum">Mesa {t}</span>
              {o ? (
                <>
                  <span>
                    Comanda #{o.number} · {minutesSince(o.createdAt)} min
                  </span>
                  <b>
                    <Money cents={o.totalCents} />
                  </b>
                  {o.paidCents > 0 && (
                    <small>
                      pago <Money cents={o.paidCents} />
                    </small>
                  )}
                </>
              ) : (
                <span className="muted">Livre</span>
              )}
            </button>
          );
        })}
      </div>
      {tables.length === 0 && (
        <Empty title="Nenhuma mesa cadastrada">
          <Button onClick={() => nav('/ajustes')}>Cadastrar mesas em Ajustes</Button>
        </Empty>
      )}
      {open && <OrderDrawer orderId={open} onClose={() => setOpen(null)} />}
    </Layout>
  );
}
