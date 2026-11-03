import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STOCK_MOVEMENT_LABEL } from '@guto/core';
import { Layout } from '../components/Layout';
import { formatBRL } from '@guto/core';
import { Button, Chips, Empty, Field, Loading, Modal, MoneyInput, Tabs, useAction } from '../components/ui';
import { useMenu } from '../lib/queries';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';

const UNITS = ['un', 'g', 'kg', 'ml', 'l', 'fatia', 'porção'];
const fmtQty = (q: string) => Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default function Stock() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'items' | 'moves'>('items');
  const items = useQuery({ queryKey: ['stock'], queryFn: () => get<any[]>('/api/stock') });
  const moves = useQuery({ queryKey: ['stock', 'moves'], queryFn: () => get<any[]>('/api/stock/movements'), enabled: tab === 'moves' });
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [mov, setMov] = useState<any | null>(null);
  const [sell, setSell] = useState<any | null>(null);
  const [onlyLow, setOnlyLow] = useState(false);
  const list = (items.data ?? []).filter((i) => !onlyLow || i.low);
  return (
    <Layout title="Estoque">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'items', label: 'Insumos e produtos' }, { id: 'moves', label: 'Movimentações' }]} />
      {tab === 'items' && (
        <>
          <div className="page-head">
            <label className="check"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Só estoque baixo</label>
            <div className="grow" />
            {can('stock.manage') && <Button variant="primary" onClick={() => setEdit('new')}>+ Novo item</Button>}
          </div>
          <p className="muted">
            <b>Estoque</b> é o que a loja tem guardado; <b>à venda</b> é o que aparece no PDV, nas mesas e no celular dos atendentes. Para vender
            um item do estoque (ex.: cerveja, refrigerante), use <b>Vender</b>: ele vai para o cardápio com o preço e cada venda baixa o estoque.
            Lanches com vários ingredientes são cadastrados em <b>Cardápio</b> (ficha técnica).
          </p>
          <p className="muted">
            A venda baixa o estoque automaticamente pela ficha técnica quando o item é lançado. No cancelamento, itens não iniciados pela cozinha voltam ao estoque; já preparados são registrados como perda. Cada item é baixado uma única vez.
          </p>
          {items.isLoading ? <Loading /> : !list.length ? <Empty title="Nenhum insumo" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Item</th><th className="right">Quantidade</th><th className="right">Mínimo</th><th className="right">Custo/unid.</th><th>Vendido / usado em</th><th></th></tr></thead>
                <tbody>
                  {list.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name} {i.low && <span className="badge red">baixo</span>} {Number(i.quantity) < 0 && <span className="badge orange">negativo — confira</span>}</td>
                      <td className="right num">{fmtQty(i.quantity)} {i.unit}</td>
                      <td className="right num">{fmtQty(i.minQuantity)} {i.unit}</td>
                      <td className="right num">{i.unitCostCents != null ? `R$ ${(Number(i.unitCostCents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—'}</td>
                      <td>
                        {i.soldAs?.length ? (
                          i.soldAs.join(', ')
                        ) : can('menu.manage') ? (
                          <Button size="sm" variant="primary" onClick={() => setSell(i)}>Vender</Button>
                        ) : (
                          <span className="muted">não vendido</span>
                        )}
                      </td>
                      <td className="right">
                        {can('stock.manage') && (
                          <div className="hstack" style={{ justifyContent: 'flex-end' }}>
                            <Button size="sm" onClick={() => setMov(i)}>Movimentar</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEdit(i)}>Editar</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {tab === 'moves' && (moves.isLoading ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Data</th><th>Insumo</th><th>Tipo</th><th className="right">Qtd</th><th>Motivo</th><th>Usuário</th></tr></thead>
            <tbody>
              {moves.data?.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.createdAt)}</td>
                  <td>{m.itemName}</td>
                  <td>{STOCK_MOVEMENT_LABEL[m.type as keyof typeof STOCK_MOVEMENT_LABEL]}</td>
                  <td className="right num" style={{ color: Number(m.quantity) < 0 ? 'var(--red)' : 'var(--green)' }}>{Number(m.quantity) > 0 ? '+' : ''}{fmtQty(m.quantity)} {m.unit}</td>
                  <td>{m.reason ?? (m.sourceType === 'order_item' ? 'Venda' : '')}</td>
                  <td>{m.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {edit && <ItemForm item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {mov && <MoveForm item={mov} onClose={() => setMov(null)} />}
      {sell && <SellForm item={sell} onClose={() => setSell(null)} />}
    </Layout>
  );
}

const QTY_RE = /^\d+([.,]\d{1,3})?$/;
type SellState = { on: boolean; categoryId: string; priceCents: number | null; code: string; per: string; name: string };

/** Campos para pôr um item do estoque à venda (categoria, preço, código, quanto baixa por venda). */
function SellFields({ v, onChange, unit, itemName }: { v: SellState; onChange: (v: SellState) => void; unit: string; itemName: string }) {
  const menu = useMenu();
  const cats = menu.data ?? [];
  return (
    <div className="sell-box">
      <Field label="Categoria no cardápio">
        <select value={v.categoryId} onChange={(e) => onChange({ ...v, categoryId: e.target.value })}>
          <option value="">Escolha…</option>
          {cats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="row">
        <Field label="Nome na venda"><input value={v.name} placeholder={itemName || 'mesmo nome do estoque'} onChange={(e) => onChange({ ...v, name: e.target.value })} maxLength={80} /></Field>
        <Field label="Preço de venda"><MoneyInput value={v.priceCents} onChange={(p) => onChange({ ...v, priceCents: p })} /></Field>
      </div>
      <div className="row">
        <Field label="Código no PDV (opcional)" hint="Número para digitar e tecle Enter"><input value={v.code} inputMode="numeric" maxLength={10} onChange={(e) => onChange({ ...v, code: e.target.value })} /></Field>
        <Field label={`Baixa do estoque por venda (${unit})`} hint={unit === 'un' ? '1 venda = 1 unidade' : `Ex.: 0,5 ${unit}`}><input inputMode="decimal" value={v.per} onChange={(e) => onChange({ ...v, per: e.target.value })} /></Field>
      </div>
    </div>
  );
}
const sellReady = (v: SellState) => !!v.categoryId && !!v.priceCents && v.priceCents > 0 && QTY_RE.test(v.per.trim()) && Number(v.per.replace(',', '.')) > 0;
const sellBody = (v: SellState) => ({ categoryId: v.categoryId, priceCents: v.priceCents, name: v.name.trim() || null, code: v.code.trim() || null, quantityPerSale: v.per.trim().replace(',', '.') });
const emptySell = (): SellState => ({ on: true, categoryId: '', priceCents: null, code: '', per: '1', name: '' });

function SellForm({ item, onClose }: { item: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<SellState>(emptySell);
  const { busy, go } = useAction();
  return (
    <Modal title={`Vender ${item.name}`} onClose={onClose} footer={
      <Button variant="primary" busy={busy} disabled={!sellReady(v)} onClick={() => go(async () => {
        await post(`/api/stock/${item.id}/sell`, sellBody(v));
        await Promise.all([qc.invalidateQueries({ queryKey: ['stock'] }), qc.invalidateQueries({ queryKey: ['menu'] })]);
        onClose();
      }, { success: `${item.name} à venda: já aparece no PDV, nas mesas e no celular` })}>Pôr à venda{v.priceCents ? ` por ${formatBRL(v.priceCents)}` : ''}</Button>
    }>
      <p className="muted">O item vai para o cardápio e cada venda baixa o estoque.</p>
      <SellFields v={v} onChange={setV} unit={item.unit} itemName={item.name} />
    </Modal>
  );
}

function ItemForm({ item, onClose }: { item: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [f, setF] = useState({ name: item?.name ?? '', unit: item?.unit ?? 'un', minQuantity: item ? String(Number(item.minQuantity)) : '0', unitCost: item?.unitCostCents != null ? String(Number(item.unitCostCents) / 100).replace('.', ',') : '', initial: '' });
  const [sell, setSell] = useState<SellState>(() => ({ ...emptySell(), on: false }));
  const { busy, go } = useAction();
  const toCents = (v: string) => (v.trim() ? String(Math.round(Number(v.replace(',', '.')) * 1000000) / 10000) : null);
  const initialOk = !f.initial.trim() || QTY_RE.test(f.initial.trim());
  const canSell = !item && can('menu.manage');
  const valid = !!f.name.trim() && initialOk && (!sell.on || sellReady(sell));
  return (
    <Modal title={item ? `Editar ${item.name}` : 'Novo item do estoque'} onClose={onClose} footer={
      <Button variant="primary" busy={busy} disabled={!valid} onClick={() => go(async () => {
        const saved = await post<{ id: string }>('/api/stock', { id: item?.id, name: f.name, unit: f.unit, minQuantity: f.minQuantity.replace(',', '.') || '0', unitCostCents: toCents(f.unitCost) });
        if (!item && f.initial.trim() && Number(f.initial.replace(',', '.')) > 0)
          await post('/api/stock/movements', { stockItemId: saved.id, type: 'entry', quantity: f.initial.trim().replace(',', '.'), reason: 'Estoque inicial' });
        if (canSell && sell.on) await post(`/api/stock/${saved.id}/sell`, sellBody(sell));
        await Promise.all([qc.invalidateQueries({ queryKey: ['stock'] }), qc.invalidateQueries({ queryKey: ['menu'] })]);
        onClose();
      }, { success: canSell && sell.on ? 'Salvo e à venda: já aparece no PDV, nas mesas e no celular' : 'Item salvo' })}>Salvar</Button>
    }>
      <Field label="Nome"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="row">
        <Field label="Unidade"><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Estoque mínimo"><input inputMode="decimal" value={f.minQuantity} onChange={(e) => setF({ ...f, minQuantity: e.target.value })} /></Field>
        <Field label="Custo por unidade (R$)" hint="Pode ter frações de centavo (ex.: 0,022 por grama)"><input inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>
      </div>
      {!item && (
        <Field label={`Quantidade que tem agora (${f.unit})`} hint="Lançada como entrada “Estoque inicial”." error={initialOk ? undefined : 'Use números (até 3 casas)'}>
          <input inputMode="decimal" value={f.initial} onChange={(e) => setF({ ...f, initial: e.target.value })} placeholder="0" />
        </Field>
      )}
      {canSell && (
        <>
          <label className="check sell-toggle">
            <input type="checkbox" checked={sell.on} onChange={(e) => setSell({ ...sell, on: e.target.checked })} />
            <span><b>Vender este item</b> — aparece no PDV, nas mesas e no celular dos atendentes (ex.: bebidas)</span>
          </label>
          {sell.on && <SellFields v={sell} onChange={setSell} unit={f.unit} itemName={f.name} />}
        </>
      )}
    </Modal>
  );
}

function MoveForm({ item, onClose }: { item: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'entry' | 'loss' | 'manual_out' | 'adjustment'>('entry');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const { busy, go } = useAction();
  const valid = /^\d+([.,]\d{1,3})?$/.test(qty.trim()) && reason.trim();
  return (
    <Modal title={`Movimentar ${item.name}`} onClose={onClose} footer={
      <Button variant="primary" busy={busy} disabled={!valid} onClick={() => go(async () => {
        await post('/api/stock/movements', { stockItemId: item.id, type, quantity: qty.trim().replace(',', '.'), reason });
        await qc.invalidateQueries({ queryKey: ['stock'] });
        onClose();
      }, { success: 'Movimentação registrada' })}>Registrar</Button>
    }>
      <p>Atual: <b>{fmtQty(item.quantity)} {item.unit}</b></p>
      <Chips label="Tipo" value={type} onChange={setType} options={[{ id: 'entry', label: 'Entrada' }, { id: 'loss', label: 'Perda' }, { id: 'manual_out', label: 'Saída' }, { id: 'adjustment', label: 'Ajuste (contagem)' }]} />
      <div style={{ height: 10 }} />
      <Field label={type === 'adjustment' ? `Quantidade contada (${item.unit})` : `Quantidade (${item.unit})`} hint={type === 'adjustment' ? 'O sistema calcula a diferença e registra o ajuste.' : undefined}>
        <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label="Motivo"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={type === 'entry' ? 'Ex.: compra NF 123' : 'Ex.: vencido'} /></Field>
    </Modal>
  );
}
