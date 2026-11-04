import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { formatBRL, formatPhoneBR, normalizeUsername, ROLE_LABEL, ROLES, type Role } from '@guto/core';
import { Layout } from '../components/Layout';
import { Alert, Button, Empty, Field, Loading, Modal, MoneyInput, Tabs, useAction } from '../components/ui';
import { del, get, post, put, upload } from '../lib/api';
import { Logo } from '../components/Logo';
import { PublicLinkCard } from '../components/PublicLink';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useSettings } from '../lib/queries';

type Tab = 'store' | 'nbs' | 'couriers' | 'users' | 'wa' | 'audit' | 'me';

export default function Settings() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (sp.get('aba') as Tab) || 'store');
  // o menu lateral abre direto numa aba (ex.: Bairros e taxas)
  useEffect(() => {
    const a = sp.get('aba') as Tab | null;
    if (a) setTab(a);
  }, [sp]);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'store', label: 'Loja' },
    { id: 'nbs', label: 'Bairros e taxas' },
    { id: 'couriers', label: 'Entregadores' },
    ...(can('users.manage') ? [{ id: 'users' as Tab, label: 'Usuários' }] : []),
    { id: 'wa', label: 'WhatsApp' },
    ...(can('audit.view') ? [{ id: 'audit' as Tab, label: 'Auditoria' }] : []),
    { id: 'me', label: 'Minha senha' },
  ];
  return (
    <Layout title="Ajustes">
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'store' && <Store />}
      {tab === 'store' && <ResetMovement />}
      {tab === 'nbs' && <Neighborhoods />}
      {tab === 'couriers' && <Couriers />}
      {tab === 'users' && <Users />}
      {tab === 'wa' && <WaSettings />}
      {tab === 'audit' && <Audit />}
      {tab === 'me' && <MyPassword />}
    </Layout>
  );
}

function Store() {
  const s = useSettings();
  const qc = useQueryClient();
  const [f, setF] = useState<any>(null);
  const { busy, go } = useAction();
  useEffect(() => {
    if (s.data && !f) setF({ ...s.data, tablesText: s.data.tables.join(', ') });
  }, [s.data, f]);
  if (!f) return <Loading />;
  const set = (p: any) => setF({ ...f, ...p });
  return (
    <section className="card">
      <div className="row">
        <Field label="Nome da loja"><input value={f.storeName} onChange={(e) => set({ storeName: e.target.value })} /></Field>
        <Field label="Telefone"><input value={f.storePhone} onChange={(e) => set({ storePhone: e.target.value })} /></Field>
      </div>
      <Field label="Endereço"><input value={f.storeAddress} onChange={(e) => set({ storeAddress: e.target.value })} /></Field>
      <Field label="Logo da loja" hint="PNG (de preferência com fundo transparente), JPG ou WebP. Aparece no menu, na tela de entrada, no cardápio digital e no topo da nota (em preto e branco na impressora térmica)." group>
        <div className="hstack" style={{ gap: 12, alignItems: 'center' }}>
          <span className="logo-chip"><Logo size={56} /></span>
          <label className="btn">
            {s.data?.logoUrl ? 'Trocar logo' : 'Enviar logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void go(async () => {
                  const saved = await upload('/api/settings/logo', file);
                  qc.setQueryData(['settings'], saved);
                  await qc.invalidateQueries({ queryKey: ['brand'] });
                }, { success: 'Logo atualizada' });
              }}
            />
          </label>
          {s.data?.logoUrl && (
            <Button variant="ghost" onClick={() => go(async () => {
              const saved = await del('/api/settings/logo');
              qc.setQueryData(['settings'], saved);
              await qc.invalidateQueries({ queryKey: ['brand'] });
            }, { success: 'Logo removida' })}>Remover</Button>
          )}
        </div>
      </Field>
      <Field label="Mesas (separadas por vírgula)"><input value={f.tablesText} onChange={(e) => set({ tablesText: e.target.value })} /></Field>
      <PublicLinkCard />
      <h3>Cardápio digital</h3>
      <label className="check"><input type="checkbox" checked={f.onlineOrdersEnabled} onChange={(e) => set({ onlineOrdersEnabled: e.target.checked })} /> Aceitar pedidos pelo cardápio digital (só com o dia aberto)</label>
      <div className="row">
        <Field label="Pedido mínimo online"><MoneyInput value={f.onlineMinOrderCents} onChange={(v) => set({ onlineMinOrderCents: v ?? 0 })} /></Field>
        <Field label="Previsão retirada (min)"><input type="number" value={f.pickupEtaMinutes} onChange={(e) => set({ pickupEtaMinutes: Number(e.target.value) })} /></Field>
        <Field label="Previsão entrega (min)"><input type="number" value={f.deliveryEtaMinutes} onChange={(e) => set({ deliveryEtaMinutes: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Formas de pagamento aceitas online (na entrega/retirada)" group>
        <div className="hstack">
          {(['cash', 'pix_manual', 'debit', 'credit', 'voucher'] as const).map((m) => (
            <label key={m} className="check">
              <input type="checkbox" checked={f.onlinePaymentMethods.includes(m)} onChange={(e) => set({ onlinePaymentMethods: e.target.checked ? [...f.onlinePaymentMethods, m] : f.onlinePaymentMethods.filter((x: string) => x !== m) })} />
              {{ cash: 'Dinheiro', pix_manual: 'Pix', debit: 'Débito', credit: 'Crédito', voucher: 'Vale-refeição' }[m]}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Chave Pix exibida ao cliente (opcional)" hint="O pagamento só é confirmado após a conferência no extrato."><input value={f.pixKeyDisplay} onChange={(e) => set({ pixKeyDisplay: e.target.value })} /></Field>
      <h3>Operação</h3>
      <div className="row">
        <Field label="Desconto máximo do caixa (%)" hint="Acima disso exige gerente"><input type="number" value={f.cashierMaxDiscountBp / 100} onChange={(e) => set({ cashierMaxDiscountBp: Math.round(Number(e.target.value) * 100) })} /></Field>
        <Field label="Atraso na cozinha (min)"><input type="number" value={f.kitchenLateMinutes} onChange={(e) => set({ kitchenLateMinutes: Number(e.target.value) })} /></Field>
        <Field label="Janela de alerta de duplicidade (min)"><input type="number" value={f.duplicateWindowMinutes} onChange={(e) => set({ duplicateWindowMinutes: Number(e.target.value) })} /></Field>
        <Field label="Bobina padrão">
          <select value={f.printWidth} onChange={(e) => set({ printWidth: Number(e.target.value) })}><option value={80}>80 mm</option><option value={58}>58 mm</option></select>
        </Field>
      </div>
      <h3>Nota não fiscal (conta e comprovante)</h3>
      <Field label="CNPJ ou CPF impresso na nota (opcional)" hint="Ex.: CNPJ 12.345.678/0001-90. A nota continua NÃO sendo documento fiscal."><input value={f.storeDocument} maxLength={40} onChange={(e) => set({ storeDocument: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={f.autoPrintReceipt} onChange={(e) => set({ autoPrintReceipt: e.target.checked })} /> Abrir a impressão da nota automaticamente quando o pedido for quitado</label>
      <Field label="Rodapé da nota"><input value={f.receiptFooter} onChange={(e) => set({ receiptFooter: e.target.value })} /></Field>
      <Field label="Retenção sugerida de dados de clientes inativos (meses)" hint="Referência para revisão periódica; a exclusão é feita em Clientes."><input type="number" value={f.dataRetentionMonths} onChange={(e) => set({ dataRetentionMonths: Number(e.target.value) })} /></Field>
      <Button variant="primary" busy={busy} onClick={() => go(async () => {
        const { tablesText, ...rest } = f;
        const tables = String(tablesText).split(',').map((t: string) => t.trim()).filter(Boolean);
        const saved = await put('/api/settings', { ...rest, tables });
        qc.setQueryData(['settings'], saved);
        setF({ ...saved, tablesText: saved.tables.join(', ') });
      }, { success: 'Configurações salvas' })}>Salvar</Button>
    </section>
  );
}

function Neighborhoods() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['neighborhoods'], queryFn: () => get<any[]>('/api/neighborhoods') });
  const [edit, setEdit] = useState<any | null>(null);
  const { busy, go } = useAction();
  return (
    <section className="card">
      <div className="page-head"><p className="muted" style={{ margin: 0 }}>Taxa cobrada do cliente e repasse ao entregador são valores separados. Distâncias não são calculadas.</p><div className="grow" /><Button variant="primary" onClick={() => setEdit({ name: '', feeCents: 0, courierFeeCents: null, minOrderCents: 0, etaMinutes: 45, active: true })}>+ Bairro</Button></div>
      {list.isLoading ? <Loading /> : (
        <table className="table">
          <thead><tr><th>Bairro</th><th className="right">Taxa cliente</th><th className="right">Repasse</th><th className="right">Mínimo</th><th className="right">Previsão</th><th></th></tr></thead>
          <tbody>
            {list.data?.map((n) => (
              <tr key={n.id}>
                <td>{n.name} {!n.active && <span className="badge">inativo</span>}</td>
                <td className="right">{formatBRL(n.feeCents)}</td>
                <td className="right">{n.courierFeeCents != null ? formatBRL(n.courierFeeCents) : <small className="muted">padrão do entregador</small>}</td>
                <td className="right">{n.minOrderCents ? formatBRL(n.minOrderCents) : '—'}</td>
                <td className="right">{n.etaMinutes} min</td>
                <td className="right"><Button size="sm" onClick={() => setEdit(n)}>Editar</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && (
        <Modal title={edit.id ? `Editar ${edit.name}` : 'Novo bairro'} onClose={() => setEdit(null)} footer={
          <Button variant="primary" busy={busy} disabled={!edit.name.trim()} onClick={() => go(async () => { await post('/api/neighborhoods', edit); await qc.invalidateQueries({ queryKey: ['neighborhoods'] }); setEdit(null); }, { success: 'Bairro salvo' })}>Salvar</Button>
        }>
          <Field label="Nome"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="row">
            <Field label="Taxa cobrada do cliente"><MoneyInput value={edit.feeCents} onChange={(v) => setEdit({ ...edit, feeCents: v ?? 0 })} /></Field>
            <Field label="Repasse ao entregador" hint="Vazio = padrão do entregador"><MoneyInput value={edit.courierFeeCents} onChange={(v) => setEdit({ ...edit, courierFeeCents: v })} /></Field>
          </div>
          <div className="row">
            <Field label="Pedido mínimo (online)"><MoneyInput value={edit.minOrderCents} onChange={(v) => setEdit({ ...edit, minOrderCents: v ?? 0 })} /></Field>
            <Field label="Previsão (min)"><input type="number" value={edit.etaMinutes} onChange={(e) => setEdit({ ...edit, etaMinutes: Number(e.target.value) })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Atendemos este bairro</label>
        </Modal>
      )}
    </section>
  );
}

function Couriers() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['couriers', 'all'], queryFn: () => get<any[]>('/api/couriers?all=1') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<any[]>('/api/users'), enabled: can('users.manage') });
  const [edit, setEdit] = useState<any | null>(null);
  const { busy, go } = useAction();
  return (
    <section className="card">
      <div className="page-head"><div className="grow" /><Button variant="primary" onClick={() => setEdit({ name: '', phone: '', defaultFeeCents: 500, userId: null, active: true })}>+ Entregador</Button></div>
      <table className="table">
        <thead><tr><th>Nome</th><th>Telefone</th><th className="right">Repasse padrão</th><th>Login</th><th></th></tr></thead>
        <tbody>
          {list.data?.map((c) => (
            <tr key={c.id}>
              <td>{c.name} {!c.active && <span className="badge">inativo</span>}</td>
              <td>{formatPhoneBR(c.phone)}</td>
              <td className="right">{formatBRL(c.defaultFeeCents)}</td>
              <td>{c.userId ? <span className="badge green">vinculado</span> : <span className="badge">sem acesso</span>}</td>
              <td className="right"><Button size="sm" onClick={() => setEdit({ ...c, phone: c.phone ?? '' })}>Editar</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <Modal title={edit.id ? `Editar ${edit.name}` : 'Novo entregador'} onClose={() => setEdit(null)} footer={
          <Button variant="primary" busy={busy} disabled={!edit.name.trim()} onClick={() => go(async () => { await post('/api/couriers', { ...edit, phone: edit.phone || null }); await qc.invalidateQueries({ queryKey: ['couriers'] }); setEdit(null); }, { success: 'Entregador salvo' })}>Salvar</Button>
        }>
          <Field label="Nome"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="row">
            <Field label="Telefone"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Repasse padrão por entrega"><MoneyInput value={edit.defaultFeeCents} onChange={(v) => setEdit({ ...edit, defaultFeeCents: v ?? 0 })} /></Field>
          </div>
          {can('users.manage') && (
            <Field label="Usuário de acesso (perfil Entregador)" hint="Com acesso, ele vê somente as próprias entregas.">
              <select value={edit.userId ?? ''} onChange={(e) => setEdit({ ...edit, userId: e.target.value || null })}>
                <option value="">Sem acesso ao sistema</option>
                {users.data?.filter((u) => u.role === 'courier').map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
              </select>
            </Field>
          )}
          <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Ativo</label>
        </Modal>
      )}
    </section>
  );
}

function Users() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['users'], queryFn: () => get<any[]>('/api/users') });
  const [edit, setEdit] = useState<any | null>(null);
  const [saved, setSaved] = useState<{ name: string; username: string; role: string; password: string } | null>(null);
  return (
    <section className="card">
      <div className="page-head"><div className="grow" /><Button variant="primary" onClick={() => setEdit({ name: '', username: '', role: 'waiter', active: true, password: '' })}>+ Usuário</Button></div>
      <table className="table">
        <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>
          {list.data?.map((u) => (
            <tr key={u.id}>
              <td>{u.name} {!u.active && <span className="badge red">inativo</span>}</td>
              <td className="mono">{u.username}</td>
              <td>{ROLE_LABEL[u.role as Role]}</td>
              <td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</td>
              <td className="right"><Button size="sm" onClick={() => setEdit({ ...u, password: '' })}>Editar</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && <UserForm user={edit} onClose={() => setEdit(null)} onSaved={(u) => { void qc.invalidateQueries({ queryKey: ['users'] }); setEdit(null); setSaved(u); }} />}
      {saved && (
        <Modal title="Usuário pronto para entrar" onClose={() => setSaved(null)} footer={<Button variant="primary" onClick={() => setSaved(null)}>Entendi</Button>}>
          <p>Passe estes dados para <b>{saved.name}</b>:</p>
          <dl className="dl login-card">
            <dt>Usuário</dt><dd className="mono">{saved.username}</dd>
            <dt>Senha</dt><dd>{saved.password ? <span className="mono">{saved.password}</span> : <span className="muted">a mesma de antes</span>}</dd>
            <dt>Perfil</dt><dd>{ROLE_LABEL[saved.role as Role]}</dd>
          </dl>
          <p className="muted">No celular: Wi-Fi da loja → QR em “Celulares e cozinha” → entrar com o usuário e a senha acima. Maiúsculas e acentos no usuário não fazem diferença; na senha, fazem.</p>
        </Modal>
      )}
    </section>
  );
}

const PURPOSES: Record<string, string> = {
  order_received: 'Pedido recebido (aguardando confirmação)',
  order_accepted: 'Pedido confirmado pela loja',
  order_ready: 'Pronto para retirada',
  order_dispatched: 'Saiu para entrega',
  order_cancelled: 'Pedido cancelado',
};

function WaSettings() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const status = useQuery({ queryKey: ['wa', 'status'], queryFn: () => get<any>('/api/whatsapp/status') });
  const s = useSettings();
  const replies = useQuery({ queryKey: ['wa', 'quick'], queryFn: () => get<any[]>('/api/whatsapp/quick-replies') });
  const templates = useQuery({ queryKey: ['wa', 'templates'], queryFn: () => get<any[]>('/api/whatsapp/templates') });
  const [reply, setReply] = useState<any | null>(null);
  const [tpl, setTpl] = useState<any | null>(null);
  const [greet, setGreet] = useState<string | null>(null);
  const { busy, go } = useAction();
  return (
    <>
      <section className="card">
        <h2>Integração</h2>
        {status.data?.mode === 'cloud' ? (
          <div className="alert ok">Modo oficial (Cloud API) configurado. Webhook: <code>{location.origin}{status.data.webhookPath}</code> · Graph API {status.data.graphVersion}</div>
        ) : (
          <div className="alert warn">
            <b>Modo demonstrativo.</b> Para ativar o envio real: conta Meta Business verificada, número na WhatsApp Business Platform, token de usuário de sistema, App Secret e templates aprovados.
            Configure as variáveis <code>WHATSAPP_*</code> no servidor (veja docs/WHATSAPP.md) e cadastre o webhook <code>{location.origin}/api/webhooks/whatsapp</code> (campo “messages”).
          </div>
        )}
        {s.data && (
          <>
            <label className="check"><input type="checkbox" checked={s.data.waAutoReplyEnabled} onChange={(e) => go(async () => { qc.setQueryData(['settings'], await put('/api/settings', { waAutoReplyEnabled: e.target.checked })); })} /> Respostas automáticas (menu 1-2-3) ativadas</label>
            <Field label="Mensagem de boas-vindas">
              <textarea value={greet ?? s.data.waGreeting} onChange={(e) => setGreet(e.target.value)} rows={4} />
            </Field>
            {greet !== null && <Button size="sm" variant="primary" busy={busy} onClick={() => go(async () => { qc.setQueryData(['settings'], await put('/api/settings', { waGreeting: greet })); setGreet(null); }, { success: 'Salvo' })}>Salvar mensagem</Button>}
          </>
        )}
      </section>
      <section className="card">
        <div className="hstack"><h2 style={{ margin: 0 }}>Respostas rápidas</h2><span className="spacer" /><Button size="sm" onClick={() => setReply({ title: '', body: '' })}>+ Nova</Button></div>
        {replies.data?.length === 0 && <Empty title="Nenhuma" />}
        {replies.data?.map((r) => (
          <div key={r.id} className="hstack" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <b>{r.title}</b><small className="muted" style={{ flex: 1 }}>{r.body}</small>
            <Button size="sm" onClick={() => setReply(r)}>Editar</Button>
            <Button size="sm" variant="ghost" onClick={() => go(async () => { await del(`/api/whatsapp/quick-replies/${r.id}`); await qc.invalidateQueries({ queryKey: ['wa', 'quick'] }); })}>Excluir</Button>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Templates aprovados (fora da janela de 24h)</h2>
        <p className="muted">Cadastre aqui o nome EXATO e o idioma do template já aprovado no Gerenciador do WhatsApp. Parâmetros do corpo: {'{{1}}'} = número do pedido, {'{{2}}'} = valor/previsão/link, {'{{3}}'} = link.</p>
        <table className="table">
          <thead><tr><th>Uso</th><th>Template</th><th></th></tr></thead>
          <tbody>
            {Object.entries(PURPOSES).map(([p, label]) => {
              const t = templates.data?.find((x) => x.purpose === p);
              return (
                <tr key={p}>
                  <td>{label}</td>
                  <td>{t ? <>{t.name} <small className="muted">({t.language})</small> {!t.active && <span className="badge">inativo</span>}</> : <span className="badge orange">não configurado</span>}</td>
                  <td className="right">{can('whatsapp.configure') && <Button size="sm" onClick={() => setTpl(t ?? { purpose: p, name: '', language: 'pt_BR', bodyPreview: '', active: true })}>Configurar</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {reply && (
        <Modal title="Resposta rápida" onClose={() => setReply(null)} footer={<Button variant="primary" busy={busy} disabled={!reply.title.trim() || !reply.body.trim()} onClick={() => go(async () => { await post('/api/whatsapp/quick-replies', reply); await qc.invalidateQueries({ queryKey: ['wa', 'quick'] }); setReply(null); })}>Salvar</Button>}>
          <Field label="Título"><input value={reply.title} onChange={(e) => setReply({ ...reply, title: e.target.value })} /></Field>
          <Field label="Texto"><textarea value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} rows={4} /></Field>
        </Modal>
      )}
      {tpl && (
        <Modal title={`Template: ${PURPOSES[tpl.purpose]}`} onClose={() => setTpl(null)} footer={<Button variant="primary" busy={busy} disabled={!/^[a-z0-9_]+$/.test(tpl.name) || !tpl.bodyPreview.trim()} onClick={() => go(async () => { await post('/api/whatsapp/templates', { purpose: tpl.purpose, name: tpl.name, language: tpl.language, bodyPreview: tpl.bodyPreview, active: tpl.active }); await qc.invalidateQueries({ queryKey: ['wa', 'templates'] }); setTpl(null); }, { success: 'Template salvo' })}>Salvar</Button>}>
          <Field label="Nome do template (minúsculas e _)"><input value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} /></Field>
          <Field label="Idioma"><input value={tpl.language} onChange={(e) => setTpl({ ...tpl, language: e.target.value })} /></Field>
          <Field label="Texto do template (cópia para referência)"><textarea value={tpl.bodyPreview} onChange={(e) => setTpl({ ...tpl, bodyPreview: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={tpl.active} onChange={(e) => setTpl({ ...tpl, active: e.target.checked })} /> Ativo</label>
        </Modal>
      )}
    </>
  );
}

function Audit() {
  const [entity, setEntity] = useState('');
  const q = useQuery({ queryKey: ['audit', entity], queryFn: () => get<any[]>('/api/audit' + (entity ? `?entity=${entity}` : '')) });
  return (
    <section className="card">
      <Field label="Filtrar">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">Tudo</option>
          {['order', 'payment', 'cash_session', 'cash_movement', 'business_day', 'user', 'product', 'stock_item', 'customer', 'courier', 'settings', 'report'].map((x) => <option key={x}>{x}</option>)}
        </select>
      </Field>
      {q.isLoading ? <Loading /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhes</th></tr></thead>
            <tbody>
              {q.data?.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{formatDateTime(a.createdAt)}</td>
                  <td>{a.userName ?? 'sistema'}{a.authorizedByName && <div><small className="muted">autorizado por {a.authorizedByName}</small></div>}</td>
                  <td className="mono">{a.action}</td>
                  <td><small className="mono" style={{ wordBreak: 'break-all' }}>{a.data ? JSON.stringify(a.data).slice(0, 220) : ''}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function MyPassword() {
  const { logout } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [rep, setRep] = useState('');
  const { busy, go } = useAction();
  return (
    <section className="card" style={{ maxWidth: 420 }}>
      <Field label="Senha atual"><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="Nova senha" hint="Mínimo 8 caracteres"><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Repita a nova senha" error={rep && rep !== next ? 'As senhas não conferem' : undefined}><input type="password" autoComplete="new-password" value={rep} onChange={(e) => setRep(e.target.value)} /></Field>
      <Button variant="primary" busy={busy} disabled={!cur || next.length < 8 || next !== rep} onClick={() => go(async () => { await post('/api/auth/password', { current: cur, next }); await logout(); }, { success: 'Senha alterada. Entre novamente.' })}>Alterar senha</Button>
    </section>
  );
}

/**
 * Cadastro de usuário. Sem transformar o texto enquanto se digita (no celular isso brigava com o corretor do
 * teclado e o texto "voltava") e sem preenchimento automático do navegador (que trocava pelo login salvo).
 */
function UserForm({ user, onClose, onSaved }: { user: any; onClose: () => void; onSaved: (u: { name: string; username: string; role: string; password: string }) => void }) {
  const [f, setF] = useState({ ...user, password: '' });
  const [show, setShow] = useState(false);
  const [touchedLogin, setTouchedLogin] = useState(!!user.id);
  const { busy, go } = useAction();
  const login = normalizeUsername(f.username);
  const loginOk = /^[a-z0-9._-]{3,40}$/.test(login);
  const pwOk = f.id ? !f.password || f.password.length >= 8 : f.password.length >= 8;
  const noFill = { autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'none', spellCheck: false, 'data-lpignore': 'true', 'data-1p-ignore': 'true' } as const;
  return (
    <Modal title={f.id ? `Editar ${user.name}` : 'Novo usuário'} onClose={onClose} footer={
      <Button variant="primary" busy={busy} disabled={!f.name.trim() || !loginOk || !pwOk} onClick={() => go(async () => {
        const r = await post<{ username: string }>('/api/users', { id: f.id, name: f.name.trim(), username: login, role: f.role, active: f.active, ...(f.password ? { password: f.password } : {}) });
        onSaved({ name: f.name.trim(), username: r.username, role: f.role, password: f.password });
      }, { success: 'Usuário salvo' })}>Salvar</Button>
    }>
      <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <Field label="Nome da pessoa">
          <input name="guto-nome-pessoa" value={f.name} {...noFill} autoCapitalize="words"
            onChange={(e) => setF({ ...f, name: e.target.value, ...(touchedLogin ? {} : { username: normalizeUsername(e.target.value.split(' ')[0] ?? '') }) })} />
        </Field>
        <div className="row">
          <Field label="Usuário (para entrar)" hint={f.username ? (loginOk ? <>Entra como: <b className="mono">{login}</b></> : 'Pelo menos 3 letras ou números') : 'Ex.: ana, joao.silva'} error={f.username && !loginOk ? 'Usuário curto demais' : undefined}>
            <input name="guto-novo-login" value={f.username} {...noFill} onChange={(e) => { setTouchedLogin(true); setF({ ...f, username: e.target.value }); }} />
          </Field>
          <Field label="Perfil">
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          </Field>
        </div>
        <Field label={f.id ? 'Nova senha (deixe vazio para manter)' : 'Senha'} hint="Mínimo 8 caracteres. Maiúsculas e minúsculas fazem diferença." error={f.password && f.password.length < 8 ? `Faltam ${8 - f.password.length} caracteres` : undefined}>
          <div className="pw-row">
            <input name="guto-nova-senha" type={show ? 'text' : 'password'} value={f.password} autoComplete="new-password" autoCorrect="off" autoCapitalize="none" spellCheck={false} data-lpignore="true" onChange={(e) => setF({ ...f, password: e.target.value })} />
            <Button size="sm" variant="ghost" onClick={() => setShow(!show)}>{show ? 'Esconder' : 'Mostrar'}</Button>
          </div>
        </Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo</label>
      </form>
    </Modal>
  );
}

/** Zerar pedidos de teste (só admin): apaga o movimento e devolve o estoque; cardápio e ajustes ficam. */
function ResetMovement() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState('');
  const [customers, setCustomers] = useState(true);
  const [done, setDone] = useState<{ counts: Record<string, number>; backupFile: string } | null>(null);
  const { busy, go } = useAction();
  if (!can('users.manage')) return null;
  return (
    <section className="card danger-zone">
      <h3 style={{ marginTop: 0 }}>Zerar pedidos de teste</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Use depois dos testes, antes de abrir de verdade. Apaga <b>pedidos, cozinha, pagamentos, caixas, dias, entregas, acertos de motoboy e despesas</b>
        {' '}e devolve ao estoque o que os pedidos baixaram. <b>Mantém</b> cardápio, acréscimos, bairros, usuários, entregadores, impressoras e ajustes.
        Antes de apagar, uma cópia de tudo é guardada na pasta da loja.
      </p>
      <Button variant="danger" onClick={() => { setOpen(true); setTxt(''); setDone(null); }}>Zerar pedidos de teste…</Button>
      {open && (
        <Modal
          title={done ? 'Pedidos zerados' : 'Zerar pedidos de teste'}
          onClose={() => setOpen(false)}
          footer={
            done ? (
              <Button variant="primary" onClick={() => setOpen(false)}>Concluir</Button>
            ) : (
              <>
                <Button onClick={() => setOpen(false)}>Cancelar</Button>
                <Button
                  variant="danger"
                  className="solid"
                  busy={busy}
                  disabled={txt.trim().toUpperCase() !== 'ZERAR'}
                  onClick={() =>
                    go(async () => {
                      const r = await post<{ counts: Record<string, number>; backupFile: string }>('/api/admin/reset-movement', { confirm: txt, customers });
                      setDone(r);
                      await qc.invalidateQueries();
                    })
                  }
                >
                  Zerar agora
                </Button>
              </>
            )
          }
        >
          {done ? (
            <>
              <p>Pronto. Foram apagados <b>{done.counts.orders ?? 0}</b> pedidos{customers ? ` e ${done.counts.customers ?? 0} clientes` : ''}; o estoque foi devolvido.</p>
              <p>Para vender de novo: <b>Caixa e dia → abrir o dia e o caixa</b>. A numeração dos pedidos recomeça do 1.</p>
              <small className="muted">Cópia do que foi apagado: {done.backupFile}</small>
            </>
          ) : (
            <>
              <Alert kind="warn">Isto não pode ser desfeito pelo sistema (a cópia fica guardada para o suporte). Feche o caixa só depois de conferir que é teste.</Alert>
              <label className="check" style={{ margin: '10px 0' }}>
                <input type="checkbox" checked={customers} onChange={(e) => setCustomers(e.target.checked)} /> <span>Apagar também os <b>clientes</b> cadastrados nos testes</span>
              </label>
              <Field label="Para confirmar, digite ZERAR">
                <input value={txt} onChange={(e) => setTxt(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
              </Field>
            </>
          )}
        </Modal>
      )}
    </section>
  );
}
