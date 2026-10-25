import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@guto/core';
import { Layout } from '../components/Layout';
import { Button, Empty, Field, Loading, Money, MoneyInput, useAction, useUi } from '../components/ui';
import { del, get, post } from '../lib/api';
import { daysAgoISO, formatDate, todayISO } from '../lib/format';

const CATS = ['Insumos', 'Embalagens', 'Gás', 'Energia', 'Água', 'Aluguel', 'Salários', 'Manutenção', 'Impostos e taxas', 'Marketing', 'Outros'];

export default function Expenses() {
  const qc = useQueryClient();
  const ui = useUi();
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const list = useQuery({ queryKey: ['expenses', from, to], queryFn: () => get<any[]>(`/api/expenses?from=${from}&to=${to}`) });
  const [f, setF] = useState({ date: todayISO(), category: 'Insumos', description: '', amount: null as number | null, paidFromCash: false });
  const { busy, go } = useAction();
  const total = (list.data ?? []).reduce((a, e) => a + e.amountCents, 0);
  return (
    <Layout title="Despesas">
      <section className="card">
        <h2>Nova despesa</h2>
        <div className="row">
          <Field label="Data"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Categoria"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Descrição"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={200} /></Field>
          <Field label="Valor"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
        </div>
        <div className="hstack">
          <label className="check"><input type="checkbox" checked={f.paidFromCash} onChange={(e) => setF({ ...f, paidFromCash: e.target.checked })} /> Paga com dinheiro do caixa aberto</label>
          <span className="spacer" />
          <Button variant="primary" busy={busy} disabled={!f.description.trim() || !f.amount} onClick={() => go(async () => {
            await post('/api/expenses', { date: f.date, category: f.category, description: f.description, amountCents: f.amount, paidFromCash: f.paidFromCash });
            setF({ ...f, description: '', amount: null });
            await qc.invalidateQueries({ queryKey: ['expenses'] });
            await qc.invalidateQueries({ queryKey: ['cash'] });
          }, { success: 'Despesa registrada' })}>Registrar</Button>
        </div>
      </section>
      <section className="card">
        <div className="row">
          <Field label="De"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="stat shrink"><div className="label">Total no período</div><div className="value">{formatBRL(total)}</div></div>
        </div>
        {list.isLoading ? <Loading /> : !list.data?.length ? <Empty title="Nenhuma despesa no período" /> : (
          <table className="table">
            <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th className="right">Valor</th><th></th></tr></thead>
            <tbody>
              {list.data.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date + 'T12:00:00')}</td>
                  <td>{e.category}</td>
                  <td>{e.description} {e.paidFromCash && <span className="badge">caixa</span>}</td>
                  <td className="right"><Money cents={e.amountCents} /></td>
                  <td className="right">
                    {!e.paidFromCash && <Button size="sm" variant="ghost" onClick={async () => {
                      if (!(await ui.confirm({ title: 'Excluir despesa?', danger: true, confirmLabel: 'Excluir' }))) return;
                      await go(async () => { await del(`/api/expenses/${e.id}`); await qc.invalidateQueries({ queryKey: ['expenses'] }); });
                    }}>Excluir</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}
