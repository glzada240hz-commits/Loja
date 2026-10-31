import { useState } from 'react';
import { X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@guto/core';
import { Layout } from '../components/Layout';
import { Button, Empty, Field, Loading, Modal, MoneyInput, Tabs, useAction, useUi } from '../components/ui';
import { del, get, post, put, upload } from '../lib/api';
import { useMenu } from '../lib/queries';
import type { MenuCategory, MenuProduct } from '../lib/types';

export default function MenuAdmin() {
  const [tab, setTab] = useState<'products' | 'groups' | 'categories'>('products');
  return (
    <Layout title="Cardápio">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'products', label: 'Produtos' }, { id: 'groups', label: 'Adicionais' }, { id: 'categories', label: 'Categorias' }]} />
      {tab === 'products' && <Products />}
      {tab === 'groups' && <Groups />}
      {tab === 'categories' && <Categories />}
    </Layout>
  );
}

function Products() {
  const menu = useMenu();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<MenuProduct | 'new' | null>(null);
  const [recipe, setRecipe] = useState<{ variantId: string; label: string } | null>(null);
  const { go } = useAction();
  if (menu.isLoading) return <Loading />;
  const cats = menu.data ?? [];
  const toggle = (target: 'product' | 'variant', id: string, available: boolean) =>
    go(async () => {
      await post('/api/menu/availability', { target, id, available });
      await qc.invalidateQueries({ queryKey: ['menu'] });
    });
  return (
    <>
      <div className="page-head">
        <p className="muted" style={{ margin: 0 }}>
          Alterar preço ou nome não muda pedidos já registrados (cada pedido guarda o próprio retrato).
        </p>
        <div className="grow" />
        <Button variant="primary" onClick={() => setEdit('new')} disabled={!cats.length}>
          + Novo produto
        </Button>
      </div>
      {cats.map((c) => (
        <section key={c.id} className="card">
          <h2>{c.name} {!c.sendToKitchen && <span className="badge">não vai para a cozinha</span>}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cód.</th>
                  <th>Produto</th>
                  <th>Preço</th>
                  <th>Custo</th>
                  <th>Disponível</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {c.products.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.code}</td>
                    <td>
                      <b>{p.name}</b> {p.kind === 'combo' && <span className="badge blue">combo</span>} {!p.showOnline && <span className="badge">fora do cardápio digital</span>}
                      {p.groups.length > 0 && <div><small className="muted">{p.groups.map((g) => g.name).join(', ')}</small></div>}
                    </td>
                    <td>
                      {p.variants.map((v) => (
                        <div key={v.id} className="nowrap">
                          {p.variants.length > 1 && <small>{v.name}: </small>}
                          {formatBRL(v.priceCents)}
                        </div>
                      ))}
                    </td>
                    <td>
                      {p.variants.map((v) => (
                        <div key={v.id} className="nowrap">
                          {v.costCents == null ? <span className="badge orange">sem custo</span> : formatBRL(v.costCents)}{' '}
                          <button type="button" className="btn ghost sm" onClick={() => setRecipe({ variantId: v.id, label: p.name + (p.variants.length > 1 ? ' ' + v.name : '') })}>
                            ficha
                          </button>
                        </div>
                      ))}
                    </td>
                    <td>
                      <label className="check">
                        <input type="checkbox" checked={p.available} onChange={(e) => toggle('product', p.id, e.target.checked)} aria-label={`${p.name} disponível`} />
                        {p.available ? 'Sim' : <span className="badge red">indisponível</span>}
                      </label>
                    </td>
                    <td className="right">
                      <Button size="sm" onClick={() => setEdit(p)}>
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!cats.length && <Empty title="Cadastre uma categoria primeiro" />}
      {edit && <ProductForm product={edit === 'new' ? null : edit} cats={cats} onClose={() => setEdit(null)} />}
      {recipe && <RecipeDialog {...recipe} onClose={() => setRecipe(null)} />}
    </>
  );
}

function ProductForm({ product, cats, onClose }: { product: MenuProduct | null; cats: MenuCategory[]; onClose: () => void }) {
  const qc = useQueryClient();
  const ui = useUi();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => get<any[]>('/api/menu/groups') });
  const allVariants = cats.flatMap((c) => c.products.filter((p) => p.kind === 'simple').flatMap((p) => p.variants.map((v) => ({ id: v.id, label: p.name + (v.name !== 'Único' ? ' ' + v.name : '') }))));
  const [f, setF] = useState({
    name: product?.name ?? '',
    code: product?.code ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? cats[0]?.id ?? '',
    kind: product?.kind ?? ('simple' as 'simple' | 'combo'),
    available: product?.available ?? true,
    showOnline: product?.showOnline ?? true,
    variants: product?.variants.map((v) => ({ id: v.id as string | undefined, name: v.name, priceCents: v.priceCents as number | null, costCents: v.costCents })) ?? [{ id: undefined, name: 'Único', priceCents: null, costCents: null }],
    groupIds: product?.groups.map((g) => g.id) ?? [],
    combo: product?.combo.map((c) => ({ variantId: c.variantId, quantity: c.quantity })) ?? [],
  });
  const { busy, go } = useAction();
  const valid = f.name.trim() && f.categoryId && f.variants.every((v) => v.priceCents != null && v.name.trim()) && (f.kind === 'simple' || f.combo.length > 0);
  const save = () =>
    go(async () => {
      await post('/api/menu/products', {
        id: product?.id,
        ...f,
        code: f.code || null,
        description: f.description || null,
        variants: f.variants.map((v) => ({ ...v, costCents: v.costCents ?? null })),
        combo: f.kind === 'combo' ? f.combo : [],
      });
      await qc.invalidateQueries({ queryKey: ['menu'] });
      onClose();
    }, { success: 'Produto salvo' });
  return (
    <Modal
      wide
      title={product ? `Editar ${product.name}` : 'Novo produto'}
      onClose={onClose}
      footer={
        <>
          {product && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await ui.confirm({ title: `Arquivar ${product.name}?`, message: 'Sai do cardápio. Pedidos antigos continuam intactos.', danger: true, confirmLabel: 'Arquivar' }))) return;
                await go(async () => { await del(`/api/menu/products/${product.id}`); await qc.invalidateQueries({ queryKey: ['menu'] }); onClose(); }, { success: 'Produto arquivado' });
              }}
            >
              Arquivar
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" busy={busy} disabled={!valid} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="row">
        <Field label="Nome"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
        <Field label="Código (atalho)"><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={10} style={{ maxWidth: 120 }} /></Field>
        <Field label="Categoria">
          <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Descrição"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={400} /></Field>
      <div className="hstack">
        <label className="check"><input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} /> Disponível</label>
        <label className="check"><input type="checkbox" checked={f.showOnline} onChange={(e) => setF({ ...f, showOnline: e.target.checked })} /> Mostrar no cardápio digital</label>
        <label className="check"><input type="checkbox" checked={f.kind === 'combo'} onChange={(e) => setF({ ...f, kind: e.target.checked ? 'combo' : 'simple' })} /> É um combo</label>
      </div>
      <h3 style={{ marginTop: 10 }}>Tamanhos e preços</h3>
      {f.variants.map((v, i) => (
        <div key={i} className="row">
          <Field label="Tamanho"><input value={v.name} onChange={(e) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></Field>
          <Field label="Preço de venda"><MoneyInput value={v.priceCents} onChange={(c) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, priceCents: c } : x)) })} /></Field>
          <Field label="Custo (opcional)"><MoneyInput value={v.costCents} onChange={(c) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, costCents: c } : x)) })} /></Field>
          {f.variants.length > 1 && <Button className="shrink" variant="ghost" aria-label="Remover tamanho" onClick={() => setF({ ...f, variants: f.variants.filter((_, j) => j !== i) })} icon={X} />}
        </div>
      ))}
      <Button size="sm" onClick={() => setF({ ...f, variants: [...f.variants, { id: undefined, name: '', priceCents: null, costCents: null }] })}>+ Tamanho</Button>
      {f.kind === 'combo' && (
        <>
          <h3 style={{ marginTop: 12 }}>Itens do combo</h3>
          <small className="muted">A baixa de estoque usa a ficha técnica de cada item.</small>
          {f.combo.map((c, i) => (
            <div key={i} className="row">
              <Field label="Item">
                <select value={c.variantId} onChange={(e) => setF({ ...f, combo: f.combo.map((x, j) => (j === i ? { ...x, variantId: e.target.value } : x)) })}>
                  {allVariants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Qtd"><input type="number" min={1} max={20} value={c.quantity} onChange={(e) => setF({ ...f, combo: f.combo.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x)) })} style={{ maxWidth: 90 }} /></Field>
              <Button className="shrink" variant="ghost" aria-label="Remover" onClick={() => setF({ ...f, combo: f.combo.filter((_, j) => j !== i) })} icon={X} />
            </div>
          ))}
          <Button size="sm" disabled={!allVariants.length} onClick={() => setF({ ...f, combo: [...f.combo, { variantId: allVariants[0]!.id, quantity: 1 }] })}>+ Item do combo</Button>
        </>
      )}
      <h3 style={{ marginTop: 12 }}>Grupos de adicionais</h3>
      {groups.data?.map((g) => (
        <label key={g.id} className="check">
          <input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={(e) => setF({ ...f, groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })} />
          {g.name} <small className="muted">({g.options.length} opções)</small>
        </label>
      ))}
      {product && <PhotoField product={product} />}
    </Modal>
  );
}

function PhotoField({ product }: { product: MenuProduct }) {
  const qc = useQueryClient();
  const { busy, go } = useAction();
  return (
    <div style={{ marginTop: 12 }}>
      <h3>Foto</h3>
      <div className="hstack">
        {product.imagePath ? <img src={product.imagePath} alt="" width={96} height={96} style={{ objectFit: 'cover', borderRadius: 10 }} /> : <span className="muted">Sem foto</span>}
        <label className="btn">
          {busy ? 'Enviando…' : 'Enviar foto'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void go(async () => { await upload(`/api/menu/products/${product.id}/image`, file); await qc.invalidateQueries({ queryKey: ['menu'] }); }, { success: 'Foto atualizada' });
            }}
          />
        </label>
        {product.imagePath && <Button size="sm" onClick={() => go(async () => { await del(`/api/menu/products/${product.id}/image`); await qc.invalidateQueries({ queryKey: ['menu'] }); })}>Remover</Button>}
      </div>
      <small className="muted">JPG, PNG ou WebP, até 3 MB.</small>
    </div>
  );
}

function RecipeDialog({ variantId, optionId, label, onClose }: { variantId?: string; optionId?: string; label: string; onClose: () => void }) {
  const stock = useQuery({ queryKey: ['stock'], queryFn: () => get<any[]>('/api/stock') });
  const key = variantId ? `variantId=${variantId}` : `optionId=${optionId}`;
  const r = useQuery({ queryKey: ['recipe', key], queryFn: () => get<any>(`/api/menu/recipes?${key}`) });
  const [items, setItems] = useState<{ stockItemId: string; quantity: string }[] | null>(null);
  const { busy, go } = useAction();
  const list = items ?? r.data?.items.map((i: any) => ({ stockItemId: i.stockItemId, quantity: String(Number(i.quantity)) })) ?? [];
  return (
    <Modal
      title={`Ficha técnica — ${label}`}
      onClose={onClose}
      footer={
        <Button variant="primary" busy={busy} onClick={() => go(async () => { await put('/api/menu/recipes', { variantId, optionId, items: list.filter((x: any) => x.stockItemId && Number(x.quantity) > 0).map((x: any) => ({ ...x, quantity: String(x.quantity).replace(',', '.') })) }); onClose(); }, { success: 'Ficha técnica salva' })}>
          Salvar
        </Button>
      }
    >
      {r.isLoading || stock.isLoading ? (
        <Loading />
      ) : (
        <>
          <p className="muted">Quantidade de cada insumo consumida por unidade vendida. É usada na baixa automática de estoque.</p>
          {r.data?.cost && (
            <p>
              Custo estimado pela ficha: {r.data.cost.costCents != null ? formatBRL(r.data.cost.costCents) : '—'} {!r.data.cost.complete && <span className="badge orange">insumo sem custo</span>}
            </p>
          )}
          {list.map((it: any, i: number) => (
            <div key={i} className="row">
              <Field label="Insumo">
                <select value={it.stockItemId} onChange={(e) => setItems(list.map((x: any, j: number) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}>
                  <option value="">Selecione…</option>
                  {stock.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}
                </select>
              </Field>
              <Field label="Quantidade"><input inputMode="decimal" value={it.quantity} onChange={(e) => setItems(list.map((x: any, j: number) => (j === i ? { ...x, quantity: e.target.value } : x)))} style={{ maxWidth: 120 }} /></Field>
              <Button className="shrink" variant="ghost" aria-label="Remover" onClick={() => setItems(list.filter((_: any, j: number) => j !== i))} icon={X} />
            </div>
          ))}
          <Button size="sm" onClick={() => setItems([...list, { stockItemId: '', quantity: '1' }])}>+ Insumo</Button>
        </>
      )}
    </Modal>
  );
}

function Groups() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => get<any[]>('/api/menu/groups') });
  const [edit, setEdit] = useState<any | 'new' | null>(null);
  const [recipe, setRecipe] = useState<{ optionId: string; label: string } | null>(null);
  const { go } = useAction();
  if (groups.isLoading) return <Loading />;
  return (
    <>
      <div className="page-head">
        <p className="muted" style={{ margin: 0 }}>Grupos de adicionais com limites mínimo e máximo (0 = sem limite). Associe aos produtos na edição do produto.</p>
        <div className="grow" />
        <Button variant="primary" onClick={() => setEdit('new')}>+ Novo grupo</Button>
      </div>
      {groups.data?.map((g) => (
        <section key={g.id} className="card">
          <div className="hstack">
            <h2 style={{ margin: 0 }}>{g.name}</h2>
            <small className="muted">mín. {g.minSelect} · máx. {g.maxSelect || 'sem limite'}</small>
            <span className="spacer" />
            <Button size="sm" onClick={() => setEdit(g)}>Editar</Button>
          </div>
          <table className="table" style={{ marginTop: 8 }}>
            <tbody>
              {g.options.map((o: any) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{o.priceCents ? formatBRL(o.priceCents) : 'grátis'}</td>
                  <td>{o.costCents != null ? `custo ${formatBRL(o.costCents)}` : o.priceCents ? <span className="badge orange">sem custo</span> : ''}</td>
                  <td>
                    <label className="check">
                      <input type="checkbox" checked={o.available} onChange={(e) => go(async () => { await post('/api/menu/availability', { target: 'option', id: o.id, available: e.target.checked }); await qc.invalidateQueries({ queryKey: ['groups'] }); await qc.invalidateQueries({ queryKey: ['menu'] }); })} aria-label={`${o.name} disponível`} />
                      disponível
                    </label>
                  </td>
                  <td className="right"><button type="button" className="btn ghost sm" onClick={() => setRecipe({ optionId: o.id, label: o.name })}>ficha</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {edit && <GroupForm group={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {recipe && <RecipeDialog {...recipe} onClose={() => setRecipe(null)} />}
    </>
  );
}

function GroupForm({ group, onClose }: { group: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: group?.name ?? '',
    minSelect: group?.minSelect ?? 0,
    maxSelect: group?.maxSelect ?? 0,
    options: (group?.options ?? []).map((o: any) => ({ id: o.id, name: o.name, priceCents: o.priceCents as number | null, costCents: o.costCents as number | null, available: o.available })),
  });
  const { busy, go } = useAction();
  const valid = f.name.trim() && f.options.every((o: any) => o.name.trim() && o.priceCents != null) && (f.maxSelect === 0 || f.minSelect <= f.maxSelect);
  return (
    <Modal
      wide
      title={group ? `Editar ${group.name}` : 'Novo grupo de adicionais'}
      onClose={onClose}
      footer={
        <Button variant="primary" busy={busy} disabled={!valid} onClick={() => go(async () => { await post('/api/menu/groups', { id: group?.id, ...f }); await qc.invalidateQueries({ queryKey: ['groups'] }); await qc.invalidateQueries({ queryKey: ['menu'] }); onClose(); }, { success: 'Grupo salvo' })}>
          Salvar
        </Button>
      }
    >
      <div className="row">
        <Field label="Nome do grupo"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mínimo"><input type="number" min={0} max={20} value={f.minSelect} onChange={(e) => setF({ ...f, minSelect: Number(e.target.value) })} /></Field>
        <Field label="Máximo (0 = sem limite)"><input type="number" min={0} max={20} value={f.maxSelect} onChange={(e) => setF({ ...f, maxSelect: Number(e.target.value) })} /></Field>
      </div>
      {f.options.map((o: any, i: number) => (
        <div key={i} className="row">
          <Field label="Opção"><input value={o.name} onChange={(e) => setF({ ...f, options: f.options.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)) })} /></Field>
          <Field label="Preço"><MoneyInput value={o.priceCents} onChange={(c) => setF({ ...f, options: f.options.map((x: any, j: number) => (j === i ? { ...x, priceCents: c } : x)) })} /></Field>
          <Field label="Custo"><MoneyInput value={o.costCents} onChange={(c) => setF({ ...f, options: f.options.map((x: any, j: number) => (j === i ? { ...x, costCents: c } : x)) })} /></Field>
          <Button className="shrink" variant="ghost" aria-label="Remover" onClick={() => setF({ ...f, options: f.options.filter((_: any, j: number) => j !== i) })} icon={X} />
        </div>
      ))}
      <Button size="sm" onClick={() => setF({ ...f, options: [...f.options, { name: '', priceCents: 0, costCents: null, available: true }] })}>+ Opção</Button>
    </Modal>
  );
}

function Categories() {
  const menu = useMenu();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const { busy, go } = useAction();
  return (
    <section className="card">
      <div className="row">
        <Field label="Nova categoria"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Button className="shrink" variant="primary" busy={busy} disabled={!name.trim()} onClick={() => go(async () => { await post('/api/menu/categories', { name, sort: (menu.data?.length ?? 0) + 1 }); setName(''); await qc.invalidateQueries({ queryKey: ['menu'] }); })}>
          Adicionar
        </Button>
      </div>
      <table className="table">
        <thead><tr><th>Categoria</th><th>Ordem</th><th>Vai para a cozinha</th><th></th></tr></thead>
        <tbody>
          {menu.data?.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.sort}</td>
              <td>
                <input type="checkbox" checked={c.sendToKitchen} aria-label={`${c.name} vai para a cozinha`} onChange={(e) => go(async () => { await post('/api/menu/categories', { id: c.id, name: c.name, sort: c.sort, sendToKitchen: e.target.checked }); await qc.invalidateQueries({ queryKey: ['menu'] }); })} />
              </td>
              <td className="right">
                <Button size="sm" variant="ghost" disabled={c.products.length > 0} title={c.products.length ? 'Arquive os produtos antes' : ''} onClick={() => go(async () => { await post('/api/menu/categories', { id: c.id, name: c.name, active: false }); await qc.invalidateQueries({ queryKey: ['menu'] }); })}>
                  Remover
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
