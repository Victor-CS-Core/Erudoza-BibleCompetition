import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./toast.css";

export type ToastTone = "success" | "danger" | "info";
export interface ToastAction { label: string; onAction: () => void; }
export interface ToastOptions { duration?: number; action?: ToastAction; }
export interface ToastApi {
  success(message: string, options?: ToastOptions): string;
  danger(message: string, options?: ToastOptions): string;
  info(message: string, options?: ToastOptions): string;
  dismiss(id: string): void;
}

interface ToastItem { id: string; tone: ToastTone; message: string; action?: ToastAction; duration: number; }

const ToastContext = createContext<ToastApi | null>(null);
const DEFAULT_DURATION: Record<ToastTone, number> = { success: 5000, info: 5000, danger: 8000 };
const MAX_VISIBLE = 4;

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}

function ToastStack({ toasts, onDismiss, onPause, onResume }: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  if (!toasts.length) return null;
  return <div className="er-toast-stack" aria-hidden={false}>
    {toasts.map(toast => <div key={toast.id} className={`er-toast er-toast-${toast.tone}`}
      role={toast.tone === "danger" ? "alert" : "status"}
      onMouseEnter={() => onPause(toast.id)} onMouseLeave={() => onResume(toast.id)}
      onFocus={() => onPause(toast.id)} onBlur={() => onResume(toast.id)}>
      <span className="er-toast-icon" aria-hidden="true">{toast.tone === "success" ? "✓" : toast.tone === "danger" ? "!" : "i"}</span>
      <p className="er-toast-message">{toast.message}</p>
      {toast.action && <button type="button" className="er-toast-action" onClick={() => { toast.action!.onAction(); onDismiss(toast.id); }}>{toast.action.label}</button>}
      <button type="button" className="er-toast-dismiss" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}><span aria-hidden="true">×</span></button>
    </div>)}
  </div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const idRef = useRef(0);

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const dismiss = useCallback((id: string) => {
    clearTimer(id);
    setToasts(current => current.filter(toast => toast.id !== id));
  }, [clearTimer]);

  const startTimer = useCallback((toast: ToastItem) => {
    clearTimer(toast.id);
    if (toast.duration > 0) timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), toast.duration));
  }, [clearTimer, dismiss]);

  const push = useCallback((tone: ToastTone, message: string, options?: ToastOptions): string => {
    const id = `toast-${++idRef.current}`;
    const toast: ToastItem = { id, tone, message, action: options?.action, duration: options?.duration ?? DEFAULT_DURATION[tone] };
    setToasts(current => {
      const next = [...current, toast];
      const overflow = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
      overflow.forEach(item => clearTimer(item.id));
      return next.slice(-MAX_VISIBLE);
    });
    startTimer(toast);
    return id;
  }, [clearTimer, startTimer]);

  const resume = useCallback((id: string) => {
    const toast = toastsRef.current.find(item => item.id === id);
    if (toast) startTimer(toast);
  }, [startTimer]);
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  useEffect(() => () => { timers.current.forEach(timer => clearTimeout(timer)); timers.current.clear(); }, []);

  const api: ToastApi = {
    success: (message, options) => push("success", message, options),
    danger: (message, options) => push("danger", message, options),
    info: (message, options) => push("info", message, options),
    dismiss,
  };

  return <ToastContext.Provider value={api}>
    {children}
    {createPortal(<ToastStack toasts={toasts} onDismiss={dismiss} onPause={clearTimer} onResume={resume} />, document.body)}
  </ToastContext.Provider>;
}
