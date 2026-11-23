import { useEffect } from "react";

/**
 * Shared scroll lock for modal overlays (dialogs, the command hub, sheets).
 *
 * iOS Safari does not stop background scrolling or rubber-banding with
 * `overflow: hidden` alone, and a native <dialog>'s top layer does not
 * reliably freeze the page behind it there either — so the lock pins the
 * body with `position: fixed` at the current scroll offset and restores the
 * exact position when the last overlay closes. Locks are reference-counted:
 * stacked/nested overlays share one lock and the page stays frozen until
 * every overlay has released. The overlay's own internal scroll areas are
 * unaffected (they live inside the dialog, above the fixed body).
 */
type SavedBody = {
  scrollY: number;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
  overscrollBehavior: string;
};

let lockCount = 0;
let saved: SavedBody | null = null;

function acquire() {
  lockCount += 1;
  if (lockCount > 1 || typeof document === "undefined") return;
  const body = document.body;
  saved = {
    scrollY: window.scrollY,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    overscrollBehavior: document.documentElement.style.overscrollBehavior,
  };
  body.style.position = "fixed";
  body.style.top = `-${saved.scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  document.documentElement.style.overscrollBehavior = "none";
  body.classList.add("scroll-locked");
}

function release() {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0 || !saved || typeof document === "undefined") return;
  const body = document.body;
  const restore = saved;
  saved = null;
  body.style.position = restore.position;
  body.style.top = restore.top;
  body.style.left = restore.left;
  body.style.right = restore.right;
  body.style.width = restore.width;
  body.style.overflow = restore.overflow;
  document.documentElement.style.overscrollBehavior = restore.overscrollBehavior;
  body.classList.remove("scroll-locked");
  window.scrollTo(0, restore.scrollY);
}

/** Imperative lock for class components / non-React callers. Pair every call with unlockScroll(). */
export function lockScroll() { acquire(); }
export function unlockScroll() { release(); }

/** Test/diagnostic view of how many overlays currently hold the lock. */
export function scrollLockCount() { return lockCount; }

/** Lock background scrolling while `active` (default true) for the component's lifetime. */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    acquire();
    return () => { release(); };
  }, [active]);
}
