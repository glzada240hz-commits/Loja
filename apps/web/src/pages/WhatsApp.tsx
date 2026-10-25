import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL, formatPhoneBR, ORDER_STATUS_LABEL } from '@guto/core';
import { Layout } from '../components/Layout';
import { OrderDrawer } from '../components/OrderDrawer';
import { Button, Empty, Field, Loading, Modal, Tabs, useAction } from '../components/ui';
import { get, newIdemKey, patch, post } from '../lib/api';
import { formatDateTime, formatTime } from '../lib/format';

const STATUS_ICON: Record<string, string> = { queued: '🕓 na fila', sending: '⏳ enviando', sent: '✓ enviada', delivered: '✓✓ entregue', read: '✓✓ lida', failed: '⚠ falhou', received: '' };

export default function WhatsApp() {
  const [tab, setTab] = useState<'inbox' | 'monitor'>('inbox');
  const status = useQuery({ queryKey: ['wa', 'status'], queryFn: () => get<any>('/api/whatsapp/status') });
  return (
    <Layout title="WhatsApp" flush>
      {status.data?.mode === 'demo' && (
        <div className="alert warn" style={{ margin: 0, borderRadius: 0 }}>
          <b>MODO DEMONSTRATIVO:</b> nenhuma mensagem é enviada a clientes reais. Configure a WhatsApp Business Platform (Cloud API) para ativar o envio. Use “Simular mensagem” para testar.
        </div>
      )}
      <div style={{ padding: '0 12px', background: 'var(--panel)' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'inbox', label: 'Conversas' }, { id: 'monitor', label: 'Monitoramento de falhas' }]} />
      </div>
      {tab === 'inbox' ? <Inbox demo={status.data?.mode === 'demo'} /> : <div style={{ padding: 12 }}><Monitor /></div>}
    </Layout>
  );
}

function Inbox({ demo }: { demo: boolean }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [sim, setSim] = useState(false);
  const list = useQuery({ queryKey: ['wa', 'list', q], queryFn: () => get<any[]>('/api/whatsapp/conversations?q=' + encodeURIComponent(q)), refetchInterval: 30000 });
  return (
    <div className={'wa' + (sel ? ' has-chat' : '')} style={{ height: 'calc(100% - 52px)' }}>
      <aside className="wa-list" aria-label="Conversas">
        <div style={{ padding: 10, display: 'flex', gap: 6 }}>
          <input type="search" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar conversa" />
          {demo && <Button size="sm" onClick={() => setSim(true)}>Simular</Button>}
        </div>
        {list.isLoading && <Loading />}
        {list.data?.length === 0 && <Empty title="Nenhuma conversa" />}
        {list.data?.map((c) => (
          <button key={c.id} type="button" className="wa-conv" aria-current={sel === c.id} onClick={() => setSel(c.id)}>
            <div className="hstack">
              <b>{c.customerName ?? c.profileName ?? formatPhoneBR(c.waId)}</b>
              <span className="spacer" />
              <small className="muted">{c.lastMessageAt ? formatTime(c.lastMessageAt) : ''}</small>
            </div>
            <div className="last">{c.lastBody}</div>
            <div className="hstack" style={{ marginTop: 2 }}>
              {c.needsHuman && <span className="badge red">pediu atendente</span>}
              {c.botPaused && !c.needsHuman && <span className="badge">robô pausado</span>}
              {c.unreadCount > 0 && <span className="badge yellow">{c.unreadCount} nova(s)</span>}
              {c.failedCount > 0 && <span className="badge orange">{c.failedCount} falha(s)</span>}
              {!c.windowOpen && <span className="badge">janela fechada</span>}
            </div>
          </button>
        ))}
      </aside>
      {sel ? <Chat id={sel} onBack={() => setSel(null)} /> : <div className="wa-chat"><Empty title="Selecione uma conversa" /></div>}
      {sim && <SimulateDialog onClose={() => setSim(false)} />}
    </div>
  );
}

function Chat({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['wa', 'conv', id], queryFn: () => get<any>(`/api/whatsapp/conversations/${id}`), refetchInterval: 15000 });
  const replies = useQuery({ queryKey: ['wa', 'quick'], queryFn: () => get<any[]>('/api/whatsapp/quick-replies') });
  const [text, setText] = useState('');
  const [order, setOrder] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const key = useRef(newIdemKey());
  const { busy, go } = useAction();
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [c.data?.messages.length]);
  const reload = () => qc.invalidateQueries({ queryKey: ['wa'] });
  if (!c.data) return <div className="wa-chat"><Loading /></div>;
  const { contact, messages, orders, customer } = c.data;
  const send = () =>
    go(async () => {
      await post(`/api/whatsapp/conversations/${id}/messages`, { body: text }, { idempotencyKey: key.current });
      key.current = newIdemKey();
      setText('');
      await reload();
    });
  const upd = (p: Record<string, unknown>) => go(async () => { await patch(`/api/whatsapp/conversations/${id}`, p); await reload(); });
  return (
    <>
      <section className="wa-chat" aria-label="Conversa">
        <div className="topbar">
          <Button size="sm" variant="ghost" onClick={onBack} className="menu-toggle" aria-label="Voltar">←</Button>
          <b>{customer?.name ?? contact.profileName ?? formatPhoneBR(contact.waId)}</b>
          <small className="muted">{formatPhoneBR(contact.waId)}</small>
          <span className="grow" />
          {contact.needsHuman ? (
            <Button size="sm" onClick={() => upd({ needsHuman: false, botPaused: false })}>Concluir atendimento</Button>
          ) : (
            <Button size="sm" onClick={() => upd({ botPaused: !contact.botPaused })}>{contact.botPaused ? 'Reativar robô' : 'Pausar robô'}</Button>
          )}
        </div>
        <div className="wa-msgs">
          {messages.map((m: any) => (
            <div key={m.id} className={'bubble' + (m.direction === 'out' ? ' out' : '') + (m.automated ? ' auto' : '') + (m.status === 'failed' ? ' failed' : '')}>
              {m.templateName && <small className="muted">[template {m.templateName}] </small>}
              {m.body}
              <div className="meta">
                {m.automated ? 'automática · ' : ''}
                {formatDateTime(m.createdAt)} {m.direction === 'out' && STATUS_ICON[m.status]}
                {m.status === 'failed' && (
                  <>
                    <br />
                    <span style={{ color: 'var(--red)' }}>{m.error}</span>{' '}
                    <button type="button" className="btn sm" onClick={() => go(async () => { await post(`/api/whatsapp/messages/${m.id}/retry`, {}); await reload(); })}>reenviar</button>
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {!contact.windowOpen ? (
          <div className="alert warn" style={{ margin: 10 }}>
            Janela de 24h fechada: pela regra da plataforma só é possível enviar template aprovado até o cliente responder.
          </div>
        ) : (
          <div className="wa-compose">
            <select aria-label="Respostas rápidas" value="" onChange={(e) => { const r = replies.data?.find((x) => x.id === e.target.value); if (r) setText(r.body); }} style={{ width: 140 }}>
              <option value="">Rápidas…</option>
              {replies.data?.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Mensagem" rows={2} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && text.trim()) { e.preventDefault(); void send(); } }} aria-label="Mensagem" />
            <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={send}>Enviar</Button>
          </div>
        )}
      </section>
      <aside className="wa-side">
        <h3>Cliente</h3>
        {customer ? <p>{customer.name}<br /><small className="muted">{customer.notes}</small></p> : <p className="muted">Sem cadastro vinculado (vincula automaticamente pelo telefone ao fazer um pedido).</p>}
        <Button size="sm" disabled={!contact.windowOpen} onClick={() => go(async () => { await post(`/api/whatsapp/conversations/${id}/menu-link`, {}); await reload(); }, { success: 'Link enviado' })}>Enviar link do cardápio</Button>
        <h3 style={{ marginTop: 14 }}>Consentimento</h3>
        <label className="check"><input type="checkbox" checked={contact.optInOrderUpdates} onChange={(e) => upd({ optInOrderUpdates: e.target.checked })} /> Atualizações de pedido</label>
        <label className="check"><input type="checkbox" checked={contact.optInMarketing} onChange={(e) => upd({ optInMarketing: e.target.checked })} /> Promoções</label>
        <small className="muted">
          {contact.optInAt ? `Registrado em ${formatDateTime(contact.optInAt)} (${contact.optInSource})` : 'Sem registro de consentimento.'}
          {contact.optOutAt ? ` Pediu para sair em ${formatDateTime(contact.optOutAt)}.` : ''}
        </small>
        <h3 style={{ marginTop: 14 }}>Pedidos deste número</h3>
        {orders.length === 0 && <p className="muted">Nenhum.</p>}
        {orders.map((o: any) => (
          <div key={o.id} className="hstack" style={{ padding: '3px 0' }}>
            <button type="button" className="btn ghost sm" onClick={() => setOrder(o.id)}>#{o.number}</button>
            <small>{ORDER_STATUS_LABEL[o.status as 'open']} · {formatBRL(o.totalCents)}</small>
          </div>
        ))}
      </aside>
      {order && <OrderDrawer orderId={order} onClose={() => setOrder(null)} />}
    </>
  );
}

function SimulateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('11 97777-0000');
  const [name, setName] = useState('Cliente teste');
  const [text, setText] = useState('Oi');
  const { busy, go } = useAction();
  return (
    <Modal title="Simular mensagem recebida (modo demonstrativo)" onClose={onClose} footer={
      <Button variant="primary" busy={busy} onClick={() => go(async () => { await post('/api/whatsapp/demo/inbound', { phone, name, text }); await qc.invalidateQueries({ queryKey: ['wa'] }); onClose(); }, { success: 'Mensagem simulada recebida' })}>Simular</Button>
    }>
      <p className="muted">Passa pelo mesmo processamento do webhook real (deduplicação, robô, janela de 24h). Nada é enviado de verdade.</p>
      <Field label="Telefone"><input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Nome no perfil"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Texto" hint="Teste: 1 (cardápio), 2 (status), 3 (atendente), PARAR"><input value={text} onChange={(e) => setText(e.target.value)} /></Field>
    </Modal>
  );
}

function Monitor() {
  const qc = useQueryClient();
  const m = useQuery({ queryKey: ['wa', 'monitor'], queryFn: () => get<any>('/api/whatsapp/monitor'), refetchInterval: 30000 });
  const { go } = useAction();
  if (!m.data) return <Loading />;
  const count = (arr: any[], s: string) => arr.find((x) => x.status === s)?.count ?? 0;
  return (
    <>
      <div className="grid cols-4">
        <div className="stat"><div className="label">Na fila</div><div className="value">{count(m.data.queue, 'queued')}</div></div>
        <div className="stat"><div className="label">Enviando</div><div className="value">{count(m.data.queue, 'sending')}</div></div>
        <div className="stat"><div className="label">Falhas de envio</div><div className="value">{count(m.data.queue, 'failed')}</div></div>
        <div className="stat"><div className="label">Webhooks pendentes/falhos</div><div className="value">{count(m.data.events, 'pending') + count(m.data.events, 'failed')}</div></div>
      </div>
      <section className="card" style={{ marginTop: 12 }}>
        <h2>Mensagens com falha</h2>
        {m.data.failedMessages.length === 0 ? <Empty title="Nenhuma falha" /> : (
          <table className="table">
            <thead><tr><th>Quando</th><th>Para</th><th>Mensagem</th><th>Erro</th><th></th></tr></thead>
            <tbody>
              {m.data.failedMessages.map((x: any) => (
                <tr key={x.id}>
                  <td>{formatDateTime(x.createdAt)}</td>
                  <td>{x.profileName ?? formatPhoneBR(x.waId)}</td>
                  <td style={{ maxWidth: 280 }}>{x.body}</td>
                  <td><small>{x.error}</small></td>
                  <td><Button size="sm" onClick={() => go(async () => { await post(`/api/whatsapp/messages/${x.id}/retry`, {}); await qc.invalidateQueries({ queryKey: ['wa'] }); })}>Reenviar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card">
        <h2>Eventos de webhook com erro</h2>
        {m.data.failedEvents.length === 0 ? <Empty title="Nenhum" /> : (
          <table className="table">
            <thead><tr><th>Recebido</th><th>Tipo</th><th>Tentativas</th><th>Erro</th><th></th></tr></thead>
            <tbody>
              {m.data.failedEvents.map((e: any) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.receivedAt)}</td><td>{e.kind}</td><td>{e.attempts}</td><td><small>{e.error}</small></td>
                  <td><Button size="sm" onClick={() => go(async () => { await post(`/api/whatsapp/events/${e.id}/retry`, {}); await qc.invalidateQueries({ queryKey: ['wa'] }); })}>Reprocessar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
