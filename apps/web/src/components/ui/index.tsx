// bm-design-system: Erudoza primitives. Styling lives in styles/design-system.css.
import type { Ref, AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
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
export function Badge({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" | "info" }) { return <span className={`ds-badge ds-badge-${tone} ${className}`} {...props} />; }
export function Notice({ tone = "info", className = "", ...props }: HTMLAttributes<HTMLDivElement> & { tone?: "info" | "success" | "danger" }) { return <div role={tone === "danger" ? "alert" : "status"} className={`ds-notice ds-notice-${tone} ${className}`} {...props} />; }
export function LoadingState({ label = "Loading…" }: { label?: string }) { return <div className="ds-loading" role="status"><span aria-hidden="true" />{label}</div>; }
export function EmptyState({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) { return <div className="ds-empty"><h3>{title}</h3><p>{description}</p>{action && <div className="ds-empty-action">{action}</div>}</div>; }
