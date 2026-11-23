import type { ReactNode } from "react";

/**
 * The Option D bottom action dock: a phone-only sticky bar that carries a
 * flow's single primary action in the thumb zone, directly above the mobile
 * tab bar. Pages render it only in phone layout (see usePhoneLayout) with the
 * exact same action element the in-flow layout uses on desktop — the dock
 * replaces that in-flow primary, never duplicates it. Positioning, safe-area
 * handling and the page's compensating scroll padding live in
 * command-center.css (`.mobile-action-dock`).
 */
export function ActionDock({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mobile-action-dock" role="region" aria-label={label}>{children}</div>;
}
