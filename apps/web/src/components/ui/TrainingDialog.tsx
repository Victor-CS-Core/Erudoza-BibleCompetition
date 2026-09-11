import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./index";

export function TrainingDialog({ open, title, onClose, children, pending = false }: {
  open: boolean; title: string; onClose(): void; children: ReactNode; pending?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>("button, select, input, [tabindex='0']")?.focus();
    return () => { element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [open]);
  if (!open) return null;
  return <dialog className="ds-dialog ds-training-dialog" ref={dialog} aria-labelledby={titleId} aria-busy={pending} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><Button variant="ghost" aria-label="Close dialog" disabled={pending} onClick={onClose}>Close</Button></header>
    <div className="ds-training-dialog-body">{children}</div>
  </dialog>;
}
