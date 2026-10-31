import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, Inbox, Minus, Plus, X, XCircle, type LucideIcon } from 'lucide-react';
import { formatBRL, parseBRL } from '@guto/core';
import { ApiError } from '../lib/api';

export type { LucideIcon };

// ---------------- Botão ----------------

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'dark' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'lg';
  block?: boolean;
  busy?: boolean;
  /** ícone à esquerda do texto (ou sozinho, com aria-label) */
  icon?: LucideIcon;
  /** atalho de teclado exibido no botão (ex.: "F4") */
  kbd?: string;
};
export function Button({ variant, size, block, busy, className, children, disabled, icon: Ico, kbd, ...rest }: BtnProps) {
  const iconOnly = !!Ico && (children == null || children === false);
  const cls = ['btn', variant, size, block && 'block', iconOnly && 'icon-only', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="spin" aria-hidden /> : Ico && <Ico className="icon" aria-hidden />}
      {children}
      {kbd && (
        <span className="kbd" aria-hidden>
          {kbd}
        </span>
      )}
    </button>
  );
}

/** Aviso dentro da página, sempre com ícone + texto (não depende só de cor). */
export function Alert({ kind = 'info', icon, children, action, role }: { kind?: 'info' | 'warn' | 'error' | 'ok' | 'bill'; icon?: LucideIcon; children: ReactNode; action?: ReactNode; role?: string }) {
  const Ico = icon ?? (kind === 'ok' ? CheckCircle2 : kind === 'error' ? XCircle : kind === 'warn' ? AlertTriangle : Info);
  return (
    <div className={'alert ' + kind} role={role ?? (kind === 'error' ? 'alert' : undefined)}>
      <Ico className="icon" aria-hidden />
      <div className="alert-body">{children}</div>
      {action}
    </div>
  );
}

// ---------------- Campos ----------------

export function Field({ label, hint, error, children, group }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; group?: boolean }) {
  const id = useId();
  if (group) {
    // para grupos de botões/controles compostos: <label> não pode envolver vários controles
    return (
      <div className="field" role="group" aria-labelledby={id}>
        <span id={id}>{label}</span>
        {children}
        {hint && <small className="hint">{hint}</small>}
        {error && <small className="err">{error}</small>}
      </div>
    );
  }
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
      {error && <small className="err">{error}</small>}
    </label>
  );
}

/** Entrada de valor em reais. Mantém o texto digitado e entrega centavos inteiros (ou null). */
export function MoneyInput({
  value,
  onChange,
  ...rest
}: { value: number | null; onChange: (cents: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value == null ? '' : (value / 100).toFixed(2).replace('.', ','));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value == null ? '' : (value / 100).toFixed(2).replace('.', ','));
    }
  }, [value]);
  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const c = parseBRL(e.target.value);
        last.current = c;
        onChange(c);
      }}
      onBlur={() => {
        const c = parseBRL(text);
        if (c != null) setText((c / 100).toFixed(2).replace('.', ','));
      }}
    />
  );
}

export function Stepper({ value, min = 0, max = 99, onChange, label }: { value: number; min?: number; max?: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Diminuir ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={18} aria-hidden />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={`Aumentar ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={18} aria-hidden />
      </button>
    </span>
  );
}

export const Money = ({ cents, className }: { cents: number | null | undefined; className?: string }) => (
  <span className={['num', 'nowrap', className].filter(Boolean).join(' ')}>{cents == null ? '—' : formatBRL(cents)}</span>
);

// ---------------- Modal ----------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // no celular/tablet não foca campo de texto ao abrir: o teclado cobriria o conteúdo e os botões
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const first = touch ? null : ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    if (first) first.focus();
    else ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1} style={{ outline: 'none' }}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="btn ghost sm icon-only" onClick={onClose} aria-label="Fechar" data-close>
            <X className="icon" aria-hidden />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- Toasts ----------------

interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  text: string;
}
interface UiCtx {
  toast(text: string, kind?: Toast['kind']): void;
  confirm(opts: ConfirmOpts): Promise<string | boolean | null>;
  supervisor(message: string): Promise<{ username: string; password: string } | null>;
}
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** pede um texto obrigatório (ex.: motivo) e o devolve */
  reasonLabel?: string;
}

const UI = createContext<UiCtx | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirm] = useState<(ConfirmOpts & { resolve: (v: string | boolean | null) => void }) | null>(null);
  const [supState, setSup] = useState<{ message: string; resolve: (v: { username: string; password: string } | null) => void } | null>(null);
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4000);
  }, []);
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<string | boolean | null>((resolve) => setConfirm({ ...opts, resolve })), []);
  const supervisor = useCallback(
    (message: string) => new Promise<{ username: string; password: string } | null>((resolve) => setSup({ message, resolve })),
    [],
  );

  return (
    <UI.Provider value={{ toast, confirm, supervisor }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>
            {t.kind === 'ok' ? <CheckCircle2 className="icon" aria-hidden /> : t.kind === 'error' ? <XCircle className="icon" aria-hidden /> : <Info className="icon" aria-hidden />}
            <span>{t.text}</span>
            <button type="button" aria-label="Fechar aviso" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      {confirmState && (
        <ConfirmDialog
          {...confirmState}
          onDone={(v) => {
            confirmState.resolve(v);
            setConfirm(null);
          }}
        />
      )}
      {supState && (
        <SupervisorDialog
          message={supState.message}
          onDone={(v) => {
            supState.resolve(v);
            setSup(null);
          }}
        />
      )}
    </UI.Provider>
  );
}

export function useUi() {
  const v = useContext(UI);
  if (!v) throw new Error('UiProvider ausente');
  return v;
}

function ConfirmDialog({ title, message, confirmLabel, danger, reasonLabel, onDone }: ConfirmOpts & { onDone: (v: string | boolean | null) => void }) {
  const [reason, setReason] = useState('');
  const ok = !reasonLabel || reason.trim().length >= 3;
  return (
    <Modal
      title={title}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button onClick={() => onDone(null)}>Voltar</Button>
          <Button variant={danger ? 'danger' : 'primary'} className={danger ? 'solid' : undefined} disabled={!ok} onClick={() => onDone(reasonLabel ? reason.trim() : true)}>
            {confirmLabel ?? 'Confirmar'}
          </Button>
        </>
      }
    >
      {message && <div style={{ marginBottom: 10 }}>{message}</div>}
      {reasonLabel && (
        <Field label={reasonLabel} hint="Obrigatório (mínimo 3 caracteres). Fica registrado no histórico.">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
      )}
    </Modal>
  );
}

function SupervisorDialog({ message, onDone }: { message: string; onDone: (v: { username: string; password: string } | null) => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  return (
    <Modal
      title="Autorização do gerente"
      onClose={() => onDone(null)}
      footer={
        <>
          <Button onClick={() => onDone(null)}>Cancelar</Button>
          <Button variant="primary" type="submit" form="sup-form" disabled={!username || !password}>
            Autorizar
          </Button>
        </>
      }
    >
      <form
        id="sup-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (username && password) onDone({ username, password });
        }}
      >
        <Alert kind="warn">{message}</Alert>
        <Field label="Usuário do gerente">
          <input value={username} onChange={(e) => setU(e.target.value)} autoComplete="off" autoCapitalize="none" />
        </Field>
        <Field label="Senha">
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="off" />
        </Field>
        <small className="muted">A autorização fica registrada na auditoria com o nome do gerente.</small>
      </form>
    </Modal>
  );
}

/**
 * Executa uma ação com: bloqueio contra clique duplo, mensagens de erro claras e
 * pedido de autorização do gerente quando o servidor exigir.
 */
export function useAction() {
  const { toast, supervisor } = useUi();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(
    async <T,>(fn: (sup?: { username: string; password: string }) => Promise<T>, opts: { success?: string; silent?: string[] } = {}): Promise<T | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(true);
      try {
        let sup: { username: string; password: string } | undefined;
        for (;;) {
          try {
            const r = await fn(sup);
            if (opts.success) toast(opts.success, 'ok');
            return r;
          } catch (e) {
            if (e instanceof ApiError && e.code === 'supervisor_required') {
              const s = await supervisor(e.message);
              if (!s) return undefined;
              sup = s;
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        if (!(e instanceof ApiError && opts.silent?.includes(e.code))) toast(e instanceof Error ? e.message : 'Erro inesperado', 'error');
        if (e instanceof ApiError) throw e;
        return undefined;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [toast, supervisor],
  );
  /** Igual a run, mas engole o erro (já mostrado ao usuário). */
  const go = useCallback(
    <T,>(fn: (sup?: { username: string; password: string }) => Promise<T>, opts?: { success?: string }) => run(fn, opts).catch(() => undefined),
    [run],
  );
  return { busy, run, go };
}

// ---------------- Estados ----------------

export function Loading({ text = 'Carregando…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spin" aria-hidden /> {text}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Alert
      kind="error"
      action={
        retry && (
          <Button size="sm" onClick={retry}>
            Tentar de novo
          </Button>
        )
      }
    >
      <b>Não foi possível carregar.</b> {error instanceof Error ? error.message : ''}
    </Alert>
  );
}

export function Empty({ title, children, icon: Ico = Inbox, compact }: { title: string; children?: ReactNode; icon?: LucideIcon; compact?: boolean }) {
  return (
    <div className={'empty' + (compact ? ' compact' : '')}>
      <Ico className="icon" aria-hidden />
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options, label, scroll }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[]; label: string; scroll?: boolean }) {
  return (
    <div className={'chips' + (scroll ? ' scroll' : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className="chip" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Grupo de opções exclusivas com aparência de controle segmentado. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; icon?: LucideIcon }[]; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.icon && <o.icon className="icon" aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Menu "mais ações": tira do caminho ações raras ou destrutivas sem escondê-las. */
export function MoreMenu({ label = 'Mais ações', children, up = true }: { label?: string; children: ReactNode; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="menu-pop" ref={ref}>
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open && (
        <span className={'menu-list' + (up ? '' : ' down')} role="menu" onClick={() => setOpen(false)}>
          {children}
        </span>
      )}
    </span>
  );
}
