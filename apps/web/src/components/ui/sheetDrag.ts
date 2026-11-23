import { useEffect, useRef, type RefObject } from "react";

/**
 * Drag-to-dismiss for the phone bottom sheet (the ≤760px `.ds-dialog`
 * presentation). The gesture is deliberately small and pure so the state
 * logic can be pinned by unit tests: a drag starts on the sheet's handle
 * or header, follows the pointer downward only, and on release either
 * dismisses through the dialog's normal close path or snaps back — the
 * sheet is never left half-dragged.
 */

/** Drag distance (px) past which releasing always dismisses. */
export const SHEET_DISMISS_OFFSET_PX = 110;
/** A shorter drag still dismisses when it ends as a downward flick. */
export const SHEET_FLICK_OFFSET_PX = 40;
/** Downward velocity (px/ms, trailing 100ms) that counts as a flick. */
export const SHEET_DISMISS_VELOCITY_PX_PER_MS = 0.45;

export type SheetDragSample = { y: number; t: number };

/** Downward-only drag distance: the sheet never follows the pointer up. */
export function sheetDragOffset(startY: number, currentY: number): number {
  return Math.max(0, Math.round(currentY - startY));
}

/** Mean downward velocity over the trailing 100ms of the drag (px/ms). */
export function sheetDragVelocity(samples: readonly SheetDragSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find(sample => sample.t >= last.t - 100) ?? samples[0];
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

/** Release decision: far enough, or a short drag ending in a downward flick. */
export function shouldDismissSheet(offset: number, velocity: number): boolean {
  return offset > SHEET_DISMISS_OFFSET_PX
    || (offset > SHEET_FLICK_OFFSET_PX && velocity > SHEET_DISMISS_VELOCITY_PX_PER_MS);
}

function settleSheet(dialog: HTMLDialogElement, dismiss: boolean, onDismiss: () => void): void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.style.transform = "";
    if (dismiss) onDismiss();
  };
  if (typeof dialog.animate !== "function") { finish(); return; }
  const from = dialog.style.transform || "translateY(0px)";
  // The drag itself is direct manipulation (the sheet follows the finger);
  // the release settle is animation, so reduced motion settles instantly.
  const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animation = dialog.animate(
    [{ transform: from }, { transform: dismiss ? "translateY(100%)" : "translateY(0px)" }],
    { duration: reducedMotion ? 0 : dismiss ? 200 : 180, easing: "ease-out" },
  );
  animation.onfinish = finish;
  animation.oncancel = finish;
}

/**
 * Wires the drag gesture onto a `<dialog>`'s handle/header region. Only
 * enabled at phone widths (the caller passes `enabled`); drags that start
 * on an interactive element (the Close button, a link, a field) never
 * begin, so the header's own controls keep working, and `touch-action:
 * none` on the region (design-system.css) keeps the sheet's own scrolling
 * from fighting the gesture. Focus, Escape, Close-button and
 * scroll-lock semantics are untouched — dismissal goes through
 * `onDismiss`, the same close path as every other way of closing the
 * dialog.
 */
export function useSheetDrag(
  dialogRef: RefObject<HTMLDialogElement | null>,
  { enabled, onDismiss }: { enabled: boolean; onDismiss(): void },
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !enabled) return;
    let dragging = false;
    let pointerId = -1;
    let startY = 0;
    let offset = 0;
    let samples: SheetDragSample[] = [];

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Interactive children keep their own behavior — a drag never starts
      // from the Close button or any control inside the header.
      if (target.closest("button, a, input, select, textarea")) return;
      const region = target.closest(".ds-sheet-handle, .ds-training-dialog > header");
      if (!region || !dialog.contains(region)) return;
      dragging = true;
      pointerId = event.pointerId;
      startY = event.clientY;
      offset = 0;
      samples = [{ y: event.clientY, t: event.timeStamp }];
      try { target.setPointerCapture?.(event.pointerId); } catch { /* capture is a nicety, not a requirement */ }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      offset = sheetDragOffset(startY, event.clientY);
      samples.push({ y: event.clientY, t: event.timeStamp });
      dialog.style.transform = `translateY(${offset}px)`;
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      dragging = false;
      samples.push({ y: event.clientY, t: event.timeStamp });
      settleSheet(dialog, shouldDismissSheet(offset, sheetDragVelocity(samples)), () => dismissRef.current());
    };
    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("pointermove", onPointerMove);
    dialog.addEventListener("pointerup", onPointerEnd);
    dialog.addEventListener("pointercancel", onPointerEnd);
    return () => {
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointermove", onPointerMove);
      dialog.removeEventListener("pointerup", onPointerEnd);
      dialog.removeEventListener("pointercancel", onPointerEnd);
      dialog.style.transform = "";
    };
  }, [dialogRef, enabled]);
}
