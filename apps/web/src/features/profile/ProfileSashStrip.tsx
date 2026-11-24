import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CharacterConfig } from "../../../shared/profileCharacter";
import { Button } from "../../components/ui";

const CharacterPortrait = lazy(() => import("./character/CharacterPreview").then(module => ({ default: module.CharacterPortrait })));

/**
 * Avatar dedupe (Nov 23) — the combined profile header's collapsed state,
 * following the HQ identity strip's pattern (HqIdentityStrip): on phones,
 * once the combined header card (`.profile-header-card`) has scrolled
 * completely off-screen, this slim fixed strip takes over at the top of
 * the viewport carrying the character face, the player's name and level
 * in text, and the Edit + Share actions — the sash thumbnail's
 * scroll-persistent preview role, without the header's streak/XP detail.
 * The face belongs here because the level is spelled out in text beside
 * it (owner direction, 2026-11-23); no crest rides in the strip. It is
 * an overlay (the page never reflows) and while visible it lends its
 * height to the scroller's scroll-padding, restored exactly on
 * hide/unmount.
 *
 * Rendered on all four profile tabs: the header's sash row is identical
 * everywhere, so its collapsed state is too. (At phone widths the
 * character stage is display:none, so on the Character and Achievement
 * patches tabs this strip is the only scroll-persistent face — the same
 * role it plays on Profile and Share.)
 */
export function ProfileSashStrip({ appearance, name, level, onEdit, onShare, onOpenFullscreen, onError }: {
  appearance: CharacterConfig;
  name: string;
  level: string | null;
  onEdit: () => void;
  onShare: () => void;
  onOpenFullscreen: () => void;
  onError?: (message: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const strip = stripRef.current;
    const header = strip?.closest(".profile-page")?.querySelector(".profile-header-card");
    if (!strip || !header || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.target === header) setVisible(!entry.isIntersecting);
    }, { threshold: 0 });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const strip = stripRef.current;
    if (!strip) return;
    const height = `${strip.offsetHeight}px`;
    // Compensate every plausible scroller: the nearest scrollable
    // ancestor (embedded frames) and the document itself (the real app,
    // whose window is the scroller). Restored exactly on hide/unmount.
    const targets: HTMLElement[] = [document.documentElement];
    let ancestor = strip.parentElement;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (/(auto|scroll)/.test(style.overflowY) && ancestor.scrollHeight > ancestor.clientHeight) { targets.push(ancestor); break; }
      ancestor = ancestor.parentElement;
    }
    const previous = targets.map(target => target.style.scrollPaddingTop);
    for (const target of targets) target.style.scrollPaddingTop = height;
    return () => { targets.forEach((target, index) => { target.style.scrollPaddingTop = previous[index]; }); };
  }, [visible]);

  return (
    <div ref={stripRef} className={`profile-sash-strip${visible ? " is-visible" : ""}`} aria-hidden={!visible} data-testid="profile-sash-strip">
      <button type="button" className="profile-sash-strip__thumb" onClick={onOpenFullscreen} aria-label="View your character fullscreen" tabIndex={visible ? 0 : -1}>
        <Suspense fallback={null}><CharacterPortrait appearance={appearance} onError={onError} /></Suspense>
      </button>
      <span className="profile-sash-strip__id"><strong>{name.trim().split(/\s+/)[0] || name}</strong>{level && <small>{level}</small>}</span>
      <div className="profile-sash-strip__actions">
        <Button size="compact" onClick={onEdit} tabIndex={visible ? 0 : -1}>Edit</Button>
        <Button size="compact" variant="secondary" onClick={onShare} tabIndex={visible ? 0 : -1}>Share</Button>
      </div>
    </div>
  );
}
