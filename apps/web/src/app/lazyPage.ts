import { lazy, type ComponentType } from "react";

/** Lazy route loading with chunk-failure recovery.
 *
 *  Route pages are code-split; a dynamic import can fail transiently on a
 *  phone (network drop, or the edge still settling in the minutes after a
 *  deploy) even though the page itself is fine. A bare React.lazy turns that
 *  one failed fetch into the app's dead-end error page — the failure behind
 *  the Nov 24 report of Control Center quick actions "throwing the same
 *  error" while every destination rendered cleanly on real data. Recovery:
 *  retry the import once; if it still fails, reload the page once (a fresh
 *  index + asset manifest heals version skew) — never twice in a row, so a
 *  genuinely broken build still surfaces the error page instead of looping. */

export const CHUNK_RELOAD_KEY = "erudoza:chunk-reload";

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

function sessionStore(): StorageLike | null {
  try { return window.sessionStorage; } catch { return null; }
}

export async function loadWithChunkRecovery<T>(
  load: () => Promise<T>,
  store: StorageLike | null = sessionStore(),
  reload: () => void = () => window.location.reload(),
): Promise<T> {
  try {
    const module = await load();
    try { store?.removeItem(CHUNK_RELOAD_KEY); } catch { /* storage is best-effort */ }
    return module;
  } catch {
    // One immediate retry covers a transient network failure.
    try {
      const module = await load();
      try { store?.removeItem(CHUNK_RELOAD_KEY); } catch { /* storage is best-effort */ }
      return module;
    } catch (second) {
      let alreadyReloaded = false;
      try {
        alreadyReloaded = store?.getItem(CHUNK_RELOAD_KEY) != null;
        if (!alreadyReloaded) store?.setItem(CHUNK_RELOAD_KEY, "1");
      } catch { /* storage is best-effort */ }
      if (alreadyReloaded) throw second;
      reload();
      // The reload is coming; never resolve, so Suspense keeps the route's
      // loading state instead of flashing the error page first.
      return new Promise<T>(() => {});
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() => loadWithChunkRecovery(load));
}
