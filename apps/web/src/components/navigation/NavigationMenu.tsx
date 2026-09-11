import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppIcon } from "../AppIcon";
import { Button } from "../ui";

export function NavigationMenu({ label, children, name }: { label: ReactNode; children: ReactNode; name: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const focusOutside = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape); document.addEventListener("focusin", focusOutside);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); document.removeEventListener("focusin", focusOutside); };
  }, [open]);
  return <div ref={root} className="command-menu-wrap">
    <Button ref={trigger} variant="ghost" size="compact" aria-label={name} aria-expanded={open} onClick={() => setOpen(!open)}>{label}<AppIcon name="chevron" /></Button>
    {open && <div className="command-menu ds-panel" onBlur={event => { if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false); }} onClick={event => { if ((event.target as HTMLElement).closest("a")) setOpen(false); }}>{children}</div>}
  </div>;
}
