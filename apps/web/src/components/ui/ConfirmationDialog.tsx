import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, Notice } from "./index";

export function ConfirmationDialog({ title, description, confirmLabel, pendingLabel = "Saving…", variant = "primary", pending = false, disabled = false, error, children, onCancel, onConfirm }: {
  title: string; description: ReactNode; confirmLabel: string; pendingLabel?: string; variant?: "primary" | "danger";
  pending?: boolean; disabled?: boolean; error?: string | null; children?: ReactNode; onCancel: () => void; onConfirm: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLButtonElement>('button[data-cancel]')?.focus();
    return () => { element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="ds-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={pending}
    style={{ margin: "auto", inset: 0, height: "min(360px, calc(100dvh - 32px))", maxHeight: "calc(100dvh - 32px)" }}
    onCancel={event => { event.preventDefault(); if (!pending) onCancel(); }}>
    <form className="flex h-full min-h-0 flex-col gap-4" onSubmit={event => { event.preventDefault(); if (!pending && !disabled) onConfirm(); }}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto"><p id={`${id}-description`}>{description}</p>{children}{error && <Notice className="mt-3" tone="danger">{error}</Notice>}</div>
      <div className="flex shrink-0 justify-end gap-3">
        <Button data-cancel variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="min-w-28" variant={variant} disabled={pending || disabled}>{pending ? pendingLabel : confirmLabel}</Button>
      </div>
    </form>
  </dialog>;
}
