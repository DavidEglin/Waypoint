import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Alert, Eye, EyeOff } from './Icons';

// ---- Toasts ----
const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const nextId = useRef(0);
  const show = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---- Form pieces ----
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      <Alert /> <span>{message}</span>
    </p>
  );
}

export function TextField({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
    </div>
  );
}

/** Password (or secret) input with a show/hide toggle. Values are never pre-filled from the server. */
export function SecretField({ label, hint, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} className="input" type={shown ? 'text' : 'password'} aria-describedby={hint ? `${id}-hint` : undefined} spellCheck={false} autoCapitalize="off" {...props} />
        <button type="button" className="btn btn-icon" aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={shown} onClick={() => setShown((s) => !s)}>
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
    </div>
  );
}

// ---- Modal (native <dialog>: focus trap, Escape and inert background come for free) ----
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
