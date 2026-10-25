import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL, formatPhoneBR, mapsLink, PAYMENT_METHOD_LABEL } from '@guto/core';
import { Layout } from '../components/Layout';
import { DeliveryBadge } from '../components/status';
import { Button, Empty, ErrorBox, Loading, useAction, useUi } from '../components/ui';
import { get, post } from '../lib/api';
import { formatTime } from '../lib/format';

interface Delivery {
  id: string; number: number; customerName: string | null; customerPhone: string | null; addrStreet: string | null; addrNumber: string | null;
  addrComplement: string | null; addrReference: string | null; neighborhoodName: string | null; balanceCents: number; paymentIntent: any;
  changeForCents: number | null; notes: string | null; deliveryStatus: any; deliveryIssue: string | null; deliveryRunId: string | null;
  courierFeeCents: number | null; stage: string; dispatchedAt: string | null; deliveredAt: string | null; itemCount: number;
}

/** Tela do entregador: só as entregas atribuídas a ele, com o necessário para entregar. */
export default function Courier() {
  const qc = useQueryClient();
  const ui = useUi();
  const q = useQuery({ queryKey: ['courier'], queryFn: () => get<{ courier: any; runs: any[]; deliveries: Delivery[] }>('/api/courier/me'), refetchInterval: 30000 });
  const { busy, go } = useAction();
  const reload = () => qc.invalidateQueries({ queryKey: ['courier'] });
  if (q.isLoading) return <Layout title="Minhas entregas"><Loading /></Layout>;
  if (q.error) return <Layout title="Minhas entregas"><ErrorBox error={q.error} retry={() => q.refetch()} /></Layout>;
  const { courier, runs, deliveries } = q.data!;
  if (!courier) return <Layout title="Minhas entregas"><Empty title="Seu usuário não está vinculado a um cadastro de entregador">Peça ao gerente para vincular em Ajustes → Entregadores.</Empty></Layout>;
  const pendingRuns = runs.filter((r) => r.status === 'assigned');
  const active = deliveries.filter((d) => d.deliveryStatus === 'en_route' || d.deliveryStatus === 'issue');
  const done = deliveries.filter((d) => d.deliveryStatus === 'delivered');

  const status = async (d: Delivery, s: 'delivered' | 'issue' | 'en_route') => {
    let note: string | null = null;
    if (s === 'issue') {
      const r = await ui.confirm({ title: `Ocorrência no pedido #${d.number}`, reasonLabel: 'Descreva (ex.: cliente não atende)', confirmLabel: 'Registrar' });
      if (typeof r !== 'string') return;
      note = r;
    }
    if (s === 'delivered') {
      const ok = await ui.confirm({ title: `Confirmar entrega do #${d.number}?`, message: d.balanceCents > 0 ? `Valor a receber do cliente: ${formatBRL(d.balanceCents)}` : 'Pedido já pago.', confirmLabel: 'Entregue' });
      if (!ok) return;
    }
    await go(async () => {
      await post(`/api/deliveries/${d.id}/status`, { status: s, note });
      await reload();
    });
  };

  const card = (d: Delivery) => {
    const addr = `${d.addrStreet}, ${d.addrNumber} - ${d.neighborhoodName}`;
    return (
      <div key={d.id} className="courier-card">
        <div className="hstack">
          <b style={{ fontSize: '1.3rem' }}>#{d.number}</b>
          <DeliveryBadge status={d.deliveryStatus} />
          <span className="spacer" />
          <small>{d.itemCount} item(ns)</small>
        </div>
        <div className="addr" style={{ marginTop: 6 }}>
          {d.addrStreet}, {d.addrNumber}
          {d.addrComplement ? ` — ${d.addrComplement}` : ''}
        </div>
        <div>{d.neighborhoodName}</div>
        {d.addrReference && <div className="muted">Ref.: {d.addrReference}</div>}
        <div style={{ marginTop: 6 }}>
          {d.customerName} ·{' '}
          {d.customerPhone && <a href={`tel:+${d.customerPhone}`}>{formatPhoneBR(d.customerPhone)}</a>}
        </div>
        {d.notes && <div className="alert warn" style={{ marginTop: 6 }}>{d.notes}</div>}
        <div className="collect" style={{ marginTop: 8 }}>
          {d.balanceCents > 0 ? (
            <>
              Receber: {formatBRL(d.balanceCents)}
              {d.paymentIntent && <small className="muted"> · {PAYMENT_METHOD_LABEL[d.paymentIntent as keyof typeof PAYMENT_METHOD_LABEL]}</small>}
              {d.changeForCents ? <div style={{ fontSize: '1rem' }}>Levar troco para {formatBRL(d.changeForCents)} (troco {formatBRL(d.changeForCents - d.balanceCents)})</div> : null}
            </>
          ) : (
            <span style={{ color: 'var(--green)' }}>Já pago</span>
          )}
        </div>
        {d.deliveryIssue && d.deliveryStatus === 'issue' && <div className="alert error" style={{ marginTop: 6 }}>Ocorrência: {d.deliveryIssue}</div>}
        <div className="hstack" style={{ marginTop: 10 }}>
          <a className="btn" href={mapsLink(addr)} target="_blank" rel="noreferrer">
            Navegar
          </a>
          {(d.deliveryStatus === 'en_route' || d.deliveryStatus === 'issue') && (
            <>
              <Button variant="success" size="lg" style={{ flex: 1 }} busy={busy} onClick={() => status(d, 'delivered')}>
                Entregue
              </Button>
              {d.deliveryStatus === 'en_route' ? (
                <Button busy={busy} onClick={() => status(d, 'issue')}>
                  Ocorrência
                </Button>
              ) : (
                <Button busy={busy} onClick={() => status(d, 'en_route')}>
                  Retomar
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Layout title="Minhas entregas">
      <p className="muted">
        Olá, {courier.name}. A rota e a distância não são calculadas pelo sistema — use o botão “Navegar”.
      </p>
      {pendingRuns.map((r) => {
        const list = deliveries.filter((d) => d.deliveryRunId === r.id && d.deliveryStatus === 'waiting');
        if (!list.length) return null;
        const notReady = list.some((d) => d.stage !== 'ready');
        return (
          <section key={r.id} className="card" style={{ marginBottom: 12, borderColor: 'var(--brand)' }}>
            <h2>Próxima saída ({list.length} pedido(s))</h2>
            {list.map(card)}
            <Button variant="dark" size="lg" block busy={busy} disabled={notReady} onClick={() => go(async () => { await post(`/api/deliveries/runs/${r.id}/depart`, {}); await reload(); }, { success: 'Boa entrega!' })}>
              {notReady ? 'Aguardando a cozinha…' : 'Saí para entrega'}
            </Button>
          </section>
        );
      })}
      <h2>Em rota ({active.length})</h2>
      {active.length === 0 && <Empty title="Nenhuma entrega em rota" />}
      {active.map(card)}
      <h2 style={{ marginTop: 16 }}>Entregues hoje ({done.length})</h2>
      {done.map((d) => (
        <div key={d.id} className="hstack" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <b>#{d.number}</b> {d.neighborhoodName} <small className="muted">{formatTime(d.deliveredAt)}</small>
          <span className="spacer" />
          {d.courierFeeCents != null && <span>{formatBRL(d.courierFeeCents)}</span>}
        </div>
      ))}
      {done.length > 0 && (
        <p style={{ marginTop: 8 }}>
          Repasses do dia (sem bônus/descontos): <b>{formatBRL(done.reduce((a, d) => a + (d.courierFeeCents ?? 0), 0))}</b>
        </p>
      )}
    </Layout>
  );
}
