import { useEffect, useRef, useState } from "react";
import { LevelCrest, XPBar, type PlayerCardXp } from "../../components/game/GameLayer";

/**
 * Refinement R2 — the collapsing HQ hero's other half. On phones, once
 * the full hero card has scrolled completely off-screen, this slim fixed
 * strip takes over at the top of the viewport: level crest, first name,
 * level, and a mini XP bar. It is an overlay — the page underneath never
 * reflows — and while it is up it lends its height to the scroller's
 * scroll-padding, so jumping to a card (the frame's hash reveal uses
 * scrollIntoView) never lands that card hidden underneath the strip.
 * The strip renders only while the hero is fully off-screen, so the
 * student's identity appears exactly once per screen: the hero carries
 * no avatar (the masthead does), and the strip carries the crest, never
 * a second character. Under reduced motion it simply appears/disappears;
 * the short fade runs only under no-preference (student.css).
 */
export function HqIdentityStrip({ name, xp }: { name: string; xp: PlayerCardXp }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const firstName = name.trim().split(/\s+/)[0] || name;

  useEffect(() => {
    const strip = stripRef.current;
    const hero = strip?.closest(".student-home")?.querySelector(".training-hq-hero");
    if (!strip || !hero || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.target === hero) setVisible(!entry.isIntersecting);
    }, { threshold: 0 });
    observer.observe(hero);
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
    <div ref={stripRef} className={`hq-identity-strip${visible ? " is-visible" : ""}`} aria-hidden={!visible} data-testid="hq-identity-strip">
      <LevelCrest level={xp.level} levelName={xp.levelName} size="row" />
      <span className="hq-identity-strip__name">{firstName}</span>
      <span className="hq-identity-strip__level">Level {xp.level} · {xp.levelName}</span>
      <XPBar xp={xp} className="hq-identity-strip__xp" />
    </div>
  );
}
