import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CASH_MOVEMENT_LABEL, formatBRL, PAYMENT_METHOD_LABEL, type PaymentMethod } from '@guto/core';
import { Layout } from '../components/Layout';
import { Button, Empty, ErrorBox, Field, Loading, Modal, Money, MoneyInput, useAction, useUi } from '../components/ui';
import { ApiError, get, newIdemKey, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatDateTime, formatTime } from '../lib/format';
import { useDay } from '../lib/queries';

export default function Cash() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const ui = useUi();
  const day = useDay();
  const cash = useQuery({ queryKey: ['cash'], queryFn: () => get<any>('/api/cash'), enabled: !!day.data?.day });
  const sessions = useQuery({ queryKey: ['cash', 'sessions'], queryFn: () => get<any[]>('/api/cash/sessions'), enabled: can('reports.view') });
  const [opening, setOpening] = useState<number | null>(null);
  const [mov, setMov] = useState<null | 'supply' | 'withdrawal'>(null);
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<any>(null);
  const { busy, go } = useAction();
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['cash'] });
    void qc.invalidateQueries({ queryKey: ['day'] });
  };

  const closeDay = async () => {
    const ok = await ui.confirm({
      title: 'Fechar o dia operacional?',
      message: 'Todos os pedidos precisam estar finalizados ou cancelados e o caixa fechado. Depois disso a numeração recomeça no próximo dia.',
      confirmLabel: 'Fechar dia',
    });
    if (!ok) return;
    try {
      await post('/api/day/close', {});
      ui.toast('Dia fechado', 'ok');
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'day_has_open_orders') {
        ui.toast(`${e.message}: ${e.details.orders.map((o: any) => '#' + o.number).join(', ')}`, 'error');
      } else ui.toast((e as Error).message, 'error');
    }
  };

  if (day.isLoading) return <Layout title="Caixa e dia"><Loading /></Layout>;
  const d = day.data?.day;
  const c = cash.data;
  return (
    <Layout title="Caixa e dia operacional">
      <div className="grid cols-2">
        <section className="card">
          <h2>Dia operacional</h2>
          {d ? (
            <>
              <p>
                Aberto em <b>{formatDateTime(d.openedAt)}</b> (referência {formatDate(d.referenceDate + 'T12:00:00')}). Pedidos feitos depois da meia-noite continuam neste dia até o
                fechamento.
              </p>
              <p>Pedidos no dia: {d.lastOrderNumber}</p>
              {can('business_day.manage') && (
                <Button variant="dark" onClick={closeDay}>
                  Fechar dia
                </Button>
              )}
            </>
          ) : (
            <>
              <p>Nenhum dia aberto. Abra o dia para começar a vender.</p>
              {can('business_day.open') && (
                <Button variant="primary" size="lg" busy={busy} onClick={() => go(async () => { await post('/api/day/open', {}); reload(); }, { success: 'Dia aberto' })}>
                  Abrir dia
                </Button>
              )}
            </>
          )}
        </section>
        <section className="card">
          <h2>Caixa</h2>
          {!d ? (
            <p className="muted">Abra o dia primeiro.</p>
          ) : cash.isLoading ? (
            <Loading />
          ) : cash.error ? (
            <ErrorBox error={cash.error} />
          ) : !c || c.session.status === 'closed' ? (
            <>
              <p>Caixa fechado.</p>
              <div className="row">
                <Field label="Fundo de troco (valor inicial)">
                  <MoneyInput value={opening} onChange={setOpening} />
                </Field>
                <Button className="shrink" variant="primary" busy={busy} disabled={opening == null} onClick={() => go(async () => { await post('/api/cash/open', { openingCents: opening }); reload(); }, { success: 'Caixa aberto' })}>
                  Abrir caixa
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                Aberto às {formatTime(c.session.openedAt)} com {formatBRL(c.session.openingCents)}.
              </p>
              <div className="hstack">
                <Button onClick={() => setMov('supply')}>+ Suprimento</Button>
                <Button onClick={() => setMov('withdrawal')}>− Sangria</Button>
                <span className="spacer" />
                <Button variant="dark" onClick={() => setClosing(true)}>
                  Fechar caixa
                </Button>
              </div>
            </>
          )}
        </section>
      </div>

      {c && c.session.status === 'open' && (
        <>
          <div className="grid cols-4" style={{ marginTop: 12 }}>
            <div className="stat">
              <div className="label">Dinheiro esperado na gaveta</div>
              <div className="value">{c.summary.expectedCash == null ? 'oculto' : formatBRL(c.summary.expectedCash)}</div>
              {c.summary.expectedCash == null && <div className="sub">Conferência cega: conte antes de ver o esperado</div>}
            </div>
            <div className="stat">
              <div className="label">Suprimentos</div>
              <div className="value">{formatBRL(c.summary.supplies)}</div>
            </div>
            <div className="stat">
              <div className="label">Sangrias</div>
              <div className="value">{formatBRL(c.summary.withdrawals)}</div>
            </div>
            <div className="stat">
              <div className="label">Repasses/despesas pagos</div>
              <div className="value">{formatBRL(c.summary.courierPayouts + c.summary.expensesPaid)}</div>
            </div>
          </div>
          {c.summary.byMethod && <MethodSummary byMethod={c.summary.byMethod} />}
          <section className="card" style={{ marginTop: 12 }}>
            <h2>Movimentações</h2>
            <Movements list={c.movements} />
          </section>
        </>
      )}

      {can('reports.view') && (
        <section className="card" style={{ marginTop: 12 }}>
          <h2>Caixas anteriores</h2>
          {!sessions.data?.length ? (
            <Empty title="Sem registros" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Abertura</th>
                    <th>Fechamento</th>
                    <th className="right">Esperado</th>
                    <th className="right">Contado</th>
                    <th className="right">Diferença</th>
                    <th>Justificativa</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.data.map((s) => (
                    <tr key={s.id}>
                      <td>{formatDateTime(s.openedAt)}</td>
                      <td>{s.closedAt ? formatDateTime(s.closedAt) : <span className="badge green">aberto</span>}</td>
                      <td className="right">{s.expectedCashCents != null && <Money cents={s.expectedCashCents} />}</td>
                      <td className="right">{s.countedCashCents != null && <Money cents={s.countedCashCents} />}</td>
                      <td className="right">{s.differenceCents != null && <span className={s.differenceCents ? 'badge red' : 'badge green'}>{formatBRL(s.differenceCents)}</span>}</td>
                      <td>{s.justification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {mov && <MovementDialog type={mov} onClose={() => setMov(null)} onDone={() => { setMov(null); reload(); }} />}
      {closing && (
        <CloseDialog
          onClose={() => setClosing(false)}
          onDone={(r) => {
            setClosing(false);
            setCloseResult(r);
            reload();
          }}
        />
      )}
      {closeResult && (
        <Modal title="Caixa fechado" onClose={() => setCloseResult(null)} footer={<Button variant="primary" onClick={() => setCloseResult(null)}>OK</Button>}>
          <div className="totals">
            <span>Dinheiro esperado</span>
            <Money cents={closeResult.summary.expectedCash} />
            <span>Dinheiro contado</span>
            <Money cents={closeResult.session.countedCashCents} />
            <b>Diferença</b>
            <b className={closeResult.session.differenceCents ? 'num' : 'num'} style={{ color: closeResult.session.differenceCents ? 'var(--red)' : 'var(--green)' }}>
              {formatBRL(closeResult.session.differenceCents)}
            </b>
          </div>
          <MethodSummary byMethod={closeResult.summary.byMethod} />
        </Modal>
      )}
    </Layout>
  );
}

function MethodSummary({ byMethod }: { byMethod: Record<string, { received: number; refunded: number; net: number }> }) {
  const entries = Object.entries(byMethod);
  return (
    <section className="card" style={{ marginTop: 12 }}>
      <h2>Recebimentos por forma de pagamento</h2>
      {entries.length === 0 ? (
        <Empty title="Nenhum recebimento ainda" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Forma</th>
              <th className="right">Recebido</th>
              <th className="right">Estornado</th>
              <th className="right">Líquido</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([m, v]) => (
              <tr key={m}>
                <td>{PAYMENT_METHOD_LABEL[m as PaymentMethod]}</td>
                <td className="right"><Money cents={v.received} /></td>
                <td className="right"><Money cents={v.refunded} /></td>
                <td className="right"><b><Money cents={v.net} /></b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <small className="muted">Recebimentos são o que entrou de fato; podem diferir das vendas (contas pendentes) e não representam lucro.</small>
    </section>
  );
}

function Movements({ list }: { list: any[] }) {
  if (!list.length) return <Empty title="Sem movimentações" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Tipo</th>
            <th>Forma</th>
            <th>Descrição</th>
            <th>Usuário</th>
            <th className="right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {list.map((m) => (
            <tr key={m.id}>
              <td>{formatTime(m.createdAt)}</td>
              <td>{CASH_MOVEMENT_LABEL[m.type as keyof typeof CASH_MOVEMENT_LABEL]}</td>
              <td>{PAYMENT_METHOD_LABEL[m.method as PaymentMethod]}</td>
              <td>{m.reason}</td>
              <td>{m.userName}</td>
              <td className="right" style={{ color: m.amountCents < 0 ? 'var(--red)' : undefined }}>
                <Money cents={m.amountCents} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementDialog({ type, onClose, onDone }: { type: 'supply' | 'withdrawal'; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [key] = useState(newIdemKey);
  const { busy, go } = useAction();
  return (
    <Modal
      title={type === 'supply' ? 'Suprimento (entrada de dinheiro)' : 'Sangria (retirada de dinheiro)'}
      onClose={onClose}
      footer={
        <Button variant="primary" busy={busy} disabled={!amount || !reason.trim()} onClick={() => go(async () => { await post('/api/cash/movements', { type, amountCents: amount, reason }, { idempotencyKey: key }); onDone(); }, { success: 'Movimentação registrada' })}>
          Registrar
        </Button>
      }
    >
      <Field label="Valor">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <Field label="Motivo">
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={type === 'supply' ? 'Ex.: troco extra' : 'Ex.: depósito no banco'} />
      </Field>
    </Modal>
  );
}

function CloseDialog({ onClose, onDone }: { onClose: () => void; onDone: (r: any) => void }) {
  const [counted, setCounted] = useState<number | null>(null);
  const [just, setJust] = useState('');
  const [diff, setDiff] = useState<number | null>(null);
  const { busy, run } = useAction();
  const submit = async () => {
    try {
      const r = await run((sup) => post('/api/cash/close', { countedCashCents: counted, justification: just || null, supervisor: sup }), { silent: ['justification_required'] });
      if (r) onDone(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'justification_required') setDiff(e.details.differenceCents);
    }
  };
  return (
    <Modal
      title="Fechar caixa"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="dark" busy={busy} disabled={counted == null || (diff != null && !just.trim())} onClick={submit}>
            Fechar caixa
          </Button>
        </>
      }
    >
      <p>Conte o dinheiro físico da gaveta (incluindo o fundo de troco) e informe o total.</p>
      <Field label="Dinheiro contado">
        <MoneyInput value={counted} onChange={(v) => { setCounted(v); setDiff(null); }} />
      </Field>
      {diff != null && (
        <div className="alert error" role="alert">
          Divergência de <b>{formatBRL(diff)}</b> em relação ao esperado. Confira a contagem ou informe a justificativa.
        </div>
      )}
      {diff != null && (
        <Field label="Justificativa da divergência">
          <textarea value={just} onChange={(e) => setJust(e.target.value)} maxLength={500} />
        </Field>
      )}
      <small className="muted">Cartão e Pix são conferidos pelo resumo por forma de pagamento. O fechamento pode exigir autorização do gerente.</small>
    </Modal>
  );
}
