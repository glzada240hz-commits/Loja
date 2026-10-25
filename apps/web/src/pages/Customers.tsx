import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL, formatPhoneBR } from '@guto/core';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { StatusBadge } from '../components/status';
import { Button, Empty, Field, Loading, Modal, useAction, useUi } from '../components/ui';
import { del, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';

export default function Customers() {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['customers', q], queryFn: () => get<any[]>('/api/customers?q=' + encodeURIComponent(q)), enabled: q.trim().length >= 2 });
  return (
    <Layout title="Clientes">
      <input type="search" placeholder="Buscar por nome ou telefone (mín. 2 caracteres)" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 420, marginBottom: 12 }} aria-label="Buscar cliente" />
      {q.trim().length < 2 ? (
        <Empty title="Digite para buscar" />
      ) : list.isLoading ? (
        <Loading />
      ) : !list.data?.length ? (
        <Empty title="Nenhum cliente encontrado" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th className="right">Pedidos</th>
                <th>Último pedido</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setSel(c.id)}>
                  <td>{c.name}</td>
                  <td>{formatPhoneBR(c.phone)}</td>
                  <td className="right">{c.orders}</td>
                  <td>{c.lastOrderAt ? formatDateTime(c.lastOrderAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && <CustomerModal id={sel} onClose={() => setSel(null)} />}
    </Layout>
  );
}

function CustomerModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const ui = useUi();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['customer', id], queryFn: () => get<any>(`/api/customers/${id}`) });
  const [edit, setEdit] = useState<{ name: string; phone: string; notes: string } | null>(null);
  const [order, setOrder] = useState<string | null>(null);
  const { busy, go } = useAction();
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['customer', id] });
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };
  if (!c.data) return <Modal title="Cliente" onClose={onClose}><Loading /></Modal>;
  const d = c.data;
  return (
    <Modal wide title={d.name} onClose={onClose}>
      {edit ? (
        <div>
          <div className="row">
            <Field label="Nome"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Telefone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          </div>
          <Field label="Observações internas" hint="Ex.: alergias, preferências. Visível no atendimento.">
            <textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} maxLength={500} />
          </Field>
          <div className="hstack">
            <Button onClick={() => setEdit(null)}>Cancelar</Button>
            <Button variant="primary" busy={busy} onClick={() => go(async () => { await patch(`/api/customers/${id}`, { name: edit.name, phone: edit.phone || null, notes: edit.notes || null }); setEdit(null); reload(); }, { success: 'Cliente atualizado' })}>
              Salvar
            </Button>
          </div>
        </div>
      ) : (
        <div className="hstack" style={{ marginBottom: 10 }}>
          <span>{formatPhoneBR(d.phone)}</span>
          {d.anonymizedAt && <span className="badge red">dados removidos</span>}
          <span className="spacer" />
          {can('customers.manage') && !d.anonymizedAt && <Button size="sm" onClick={() => setEdit({ name: d.name, phone: d.phone ?? '', notes: d.notes ?? '' })}>Editar</Button>}
        </div>
      )}
      {d.notes && !edit && <div className="alert warn">{d.notes}</div>}
      {d.whatsapp && (
        <p>
          <small>
            WhatsApp: atualizações de pedido {d.whatsapp.optInOrderUpdates ? 'autorizadas' : 'não autorizadas'}
            {d.whatsapp.optInAt ? ` em ${formatDateTime(d.whatsapp.optInAt)} (${d.whatsapp.optInSource})` : ''}
            {d.whatsapp.optOutAt ? ` · pediu para sair em ${formatDateTime(d.whatsapp.optOutAt)}` : ''}
          </small>
        </p>
      )}
      <h3>Endereços</h3>
      {d.addresses.length === 0 && <p className="muted">Nenhum endereço salvo.</p>}
      {d.addresses.map((a: any) => (
        <div key={a.id} className="hstack" style={{ padding: '4px 0' }}>
          <span>
            {a.street}, {a.number} {a.complement && `(${a.complement})`} — {a.neighborhoodName}
          </span>
          <span className="spacer" />
          {can('customers.manage') && (
            <Button size="sm" variant="ghost" onClick={() => go(async () => { await del(`/api/customers/${id}/addresses/${a.id}`); reload(); })}>
              Remover
            </Button>
          )}
        </div>
      ))}
      <h3 style={{ marginTop: 12 }}>Pedidos</h3>
      {d.history.map((o: any) => (
        <div key={o.id} className="hstack" style={{ padding: '4px 0' }}>
          <button type="button" className="btn ghost sm" onClick={() => setOrder(o.id)}>#{o.number}</button>
          <small>{formatDateTime(o.createdAt)}</small>
          <StatusBadge status={o.status} />
          <span className="spacer" />
          {formatBRL(o.totalCents)}
        </div>
      ))}
      {can('customers.erase') && !d.anonymizedAt && (
        <div className="alert error" style={{ marginTop: 16 }}>
          <b>Privacidade:</b> a pedido do titular, remova nome, telefone, endereços e conversas. Os valores dos pedidos são mantidos de forma anônima para fins contábeis.
          <div style={{ marginTop: 8 }}>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                const reason = await ui.confirm({ title: 'Excluir dados pessoais', message: 'Esta ação não pode ser desfeita.', reasonLabel: 'Registro do pedido do titular (data, canal)', confirmLabel: 'Excluir dados', danger: true });
                if (typeof reason !== 'string') return;
                await go(async () => { await post(`/api/customers/${id}/anonymize`, { reason }); reload(); }, { success: 'Dados pessoais removidos' });
              }}
            >
              Excluir dados pessoais
            </Button>
          </div>
        </div>
      )}
      {order && <OrderDrawer orderId={order} onClose={() => setOrder(null)} />}
    </Modal>
  );
}
