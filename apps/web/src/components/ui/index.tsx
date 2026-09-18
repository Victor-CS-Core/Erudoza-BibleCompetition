// bm-design-system: Erudoza primitives. Styling lives in styles/design-system.css.
import type { Ref, AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, type LinkProps } from "react-router-dom";
export { ProgressMeter, WeeklyProgressStrip } from "./TrainingProgress";
export { HonorArtwork } from "./HonorArtwork";
export { ToastProvider, useToast, type ToastTone, type ToastAction, type ToastOptions, type ToastApi } from "./toast";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "inverse";
type ActionStyle = { variant?: Variant; size?: "default" | "compact" | "large" };
const actionClass = (variant: Variant, size: string, extra = "") => `ds-button ds-button-${variant} ds-button-${size} ${extra}`;
export function Button({ variant = "primary", size = "default", className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & ActionStyle & { ref?: Ref<HTMLButtonElement> }) {
  return <button type={type} className={actionClass(variant, size, className)} {...props} />;
}
export function LinkButton({ variant = "primary", size = "default", className, ...props }: LinkProps & ActionStyle) {
  return <Link className={actionClass(variant, size, className)} {...props} />;
}
export function ExternalLinkButton({ variant = "secondary", size = "default", className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & ActionStyle) {
  return <a className={actionClass(variant, size, className)} {...props} />;
}
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={`ds-input ${className}`} {...props} />; }
export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={`ds-input ds-select ${className}`} {...props} />; }
export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) { return <textarea className={`ds-input ds-textarea ${className}`} {...props} />; }
export function Panel({ as: Tag = "section", className = "", ...props }: HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "div" | "aside" }) { return <Tag className={`ds-panel ${className}`} {...props} />; }
export function PageHeader({ as: Tag = "header", titleId, title, description, action, children, className = "" }: { as?: "header" | "div"; titleId?: string; title: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return <Tag className={`ds-page-header ${className}`}><div><h1 id={titleId}>{title}</h1>{description && <p>{description}</p>}{children}</div>{action && <div className="ds-page-action">{action}</div>}</Tag>;
}
/** Contextual help: a question-mark icon beside a section heading. The section's detail message lives in the tooltip box. Tap/click toggles, Escape and outside presses dismiss. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <span className="ds-help-tip" ref={wrapRef}>
      <button type="button" className="ds-help-tip-trigger" aria-expanded={open} aria-controls={open ? tipId : undefined} aria-label={label}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((value) => !value); }}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.55 9.45a2.75 2.75 0 1 1 4.05 2.45c-.72.44-1.5.92-1.55 2.05" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <circle cx="12.05" cy="16.75" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && <span role="tooltip" id={tipId} className="ds-help-tip-box">{children}</span>}
    </span>
  );
}
export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" | "info" }) { return <span className={`ds-badge ds-badge-${tone} ${className}`} {...props} />; }
export function Notice({ tone = "info", className = "", ...props }: HTMLAttributes<HTMLDivElement> & { tone?: "info" | "success" | "danger" }) { return <div role={tone === "danger" ? "alert" : "status"} className={`ds-notice ds-notice-${tone} ${className}`} {...props} />; }
export function LoadingState({ label = "Loading…" }: { label?: string }) { return <div className="ds-loading" role="status"><span aria-hidden="true" />{label}</div>; }
export function EmptyState({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) { return <div className="ds-empty"><h3>{title}</h3><p>{description}</p>{action && <div className="ds-empty-action">{action}</div>}</div>; }
/** Accessible on/off switch. The whole row is the tap target; the track shows the state. */
export function Switch({ checked, onChange, label, description, disabled = false, pending = false }: {
  checked: boolean; onChange(next: boolean): void; label: ReactNode; description?: ReactNode; disabled?: boolean; pending?: boolean;
}) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled || pending} aria-busy={pending || undefined}
    className="ds-switch" onClick={() => onChange(!checked)}>
    <span className="ds-switch-text"><span className="ds-switch-label">{label}</span>{description ? <span className="ds-switch-description">{description}</span> : null}</span>
    <span className="ds-switch-track" aria-hidden="true" />
  </button>;
}
