import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BoardAvatar } from "../../api/types";
import type { XpLevelSnapshot, XpReward } from "../../api/trainingTypes";
import { EntryAvatar, LevelCrest } from "./GameLayer";

/**
 * XP reward animation (approved mockup, xp-reward-animation-mockup): when an
 * answer earns XP, "+N XP" pops at the answer point, a slim navy bar with
 * the student's avatar, name and level progress slides in at the top, a gold
 * coin arcs from the pop to the bar, and the counter counts up while the
 * progress fill animates — levelling up flips the crest to the new level
 * with the overflow carried into it. The bar dismisses itself (~2.2s total)
 * and is pointer-events: none throughout: it never blocks or delays play.
 *
 * Every number comes from the server's per-attempt reward snapshot
 * (`XpReward`): the amount earned and the level state before/after. This
 * component only interpolates between those two server states.
 */

export const XP_REWARD_TIMING = {
  /** How long the "+N XP" pop lives. */
  popMs: 950,
  /** Beat before the coin launches, so the pop registers first. */
  flightDelayMs: 200,
  /** Coin arc from the pop to the bar's avatar. */
  flightMs: 550,
  /** Counter + fill run once the coin lands. */
  countMs: 600,
  /** Hold on the landed state before the bar leaves. */
  holdMs: 650,
  exitMs: 200,
  /** Calm (reduced-motion) variant: values settle, then the bar holds. */
  calmSettleMs: 250,
  calmHoldMs: 1400,
} as const;

export type XpRewardFire = { data: XpReward; nonce: number };

/** Fire-and-forget reward state for a session page. Non-positive rewards are ignored. */
export function useXpReward() {
  const [reward, setReward] = useState<XpRewardFire | null>(null);
  const fire = useCallback((data: XpReward | null | undefined) => {
    if (!data || !(data.earned > 0)) return;
    setReward(prev => ({ data, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);
  return { reward, fire };
}

type DisplayState = {
  total: number;
  level: number;
  levelName: string;
  into: number;
  span: number;
};

function snapshotDisplay(snapshot: XpLevelSnapshot): DisplayState {
  return {
    total: snapshot.total,
    level: snapshot.level,
    levelName: snapshot.levelName,
    into: snapshot.xpIntoLevel,
    span: Math.max(1, snapshot.xpIntoLevel + snapshot.xpForNext, snapshot.xpIntoLevel),
  };
}

/**
 * Interpolate the bar between the on-screen state and the server's target
 * snapshot. A level-up fills the current level's bar first, flips, then
 * fills the overflow into the new level — the total counts linearly across
 * the flip, so the counter never jumps.
 */
function interpolateDisplay(from: DisplayState, fromTotal: number, to: XpLevelSnapshot, p: number): DisplayState {
  const total = Math.round(fromTotal + (to.total - fromTotal) * p);
  const toDisplay = snapshotDisplay(to);
  if (to.level <= from.level || to.total <= fromTotal) {
    return {
      total,
      level: to.level,
      levelName: to.levelName,
      into: Math.round(from.into + (to.xpIntoLevel - from.into) * p),
      span: toDisplay.span,
    };
  }
  const delta = to.total - fromTotal;
  const fillNeeded = Math.max(0, from.span - from.into);
  const pFlip = delta > 0 ? Math.min(1, fillNeeded / delta) : 1;
  if (p < pFlip) {
    return { total, level: from.level, levelName: from.levelName, into: Math.round(from.into + delta * p), span: from.span };
  }
  const overflowP = pFlip >= 1 ? 1 : (p - pFlip) / (1 - pFlip);
  return {
    total,
    level: to.level,
    levelName: to.levelName,
    into: Math.round(to.xpIntoLevel * overflowP),
    span: toDisplay.span,
  };
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

export function XpRewardOverlay({
  reward,
  name,
  avatar,
  getAnchor,
}: {
  reward: XpRewardFire | null;
  name: string;
  avatar?: BoardAvatar | null;
  /** The answer/feedback element the pop (and coin) start from; measured at fire time. */
  getAnchor?: () => HTMLElement | null;
}) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [pop, setPop] = useState<{ amount: number; x: number; y: number; key: number } | null>(null);
  const [coin, setCoin] = useState<{ x: number; y: number; key: number } | null>(null);
  const [flipKey, setFlipKey] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [calm] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  const avatarRef = useRef<HTMLSpanElement>(null);
  const coinRef = useRef<HTMLSpanElement>(null);
  const displayRef = useRef<DisplayState | null>(null);
  const timersRef = useRef<number[]>([]);
  const intervalRef = useRef<number | null>(null);
  const coinAnimRef = useRef<Animation | null>(null);
  const flightRef = useRef<{ x: number; y: number; key: number } | null>(null);
  const runRef = useRef(0);
  const lastNonceRef = useRef(0);
  const lastLevelRef = useRef(0);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
    if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
    if (coinAnimRef.current) { coinAnimRef.current.cancel(); coinAnimRef.current = null; }
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  // Unmount (session end, navigation): cancel everything so no timer,
  // interval or WAAPI animation outlives the overlay.
  useEffect(() => clearTimers, [clearTimers]);

  const applyDisplay = useCallback((next: DisplayState) => {
    if (lastLevelRef.current && next.level !== lastLevelRef.current) setFlipKey(key => key + 1);
    lastLevelRef.current = next.level;
    displayRef.current = next;
    setDisplay(next);
  }, []);

  useEffect(() => {
    if (!reward || reward.nonce === lastNonceRef.current) return;
    lastNonceRef.current = reward.nonce;
    const data = reward.data;
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    clearTimers();

    // Merge rule: a reward landing while the bar is up keeps the bar and
    // retargets the count from whatever is on screen right now.
    const startDisplay = displayRef.current ?? snapshotDisplay(data.before);
    const startTotal = displayRef.current?.total ?? data.before.total;
    setVisible(true);
    setExiting(false);
    applyDisplay(startDisplay);
    setAnnouncement(`+${data.earned} XP earned`);

    // The pop sits on the answer point (the feedback block / check row).
    const anchor = getAnchor?.();
    const anchorRect = anchor?.getBoundingClientRect();
    const popPos = anchorRect && anchorRect.width > 0
      ? { x: anchorRect.left + anchorRect.width / 2, y: anchorRect.top }
      : { x: typeof window !== "undefined" ? window.innerWidth / 2 : 195, y: 132 };
    setPop({ amount: data.earned, x: popPos.x, y: popPos.y, key: reward.nonce });
    later(() => { if (alive()) setPop(null); }, XP_REWARD_TIMING.popMs);

    const finish = () => {
      if (!alive()) return;
      applyDisplay(snapshotDisplay(data.after));
      later(() => { if (alive()) setExiting(true); }, XP_REWARD_TIMING.holdMs);
      later(() => {
        if (!alive()) return;
        setVisible(false);
        setExiting(false);
        setDisplay(null);
        displayRef.current = null;
        setCoin(null);
      }, XP_REWARD_TIMING.holdMs + XP_REWARD_TIMING.exitMs);
    };

    if (calm) {
      // Calm variant: no flight, no rise — the values settle, the bar holds.
      later(() => {
        if (!alive()) return;
        applyDisplay(snapshotDisplay(data.after));
        later(() => { if (alive()) setExiting(true); }, XP_REWARD_TIMING.calmHoldMs);
        later(() => {
          if (!alive()) return;
          setVisible(false);
          setExiting(false);
          setDisplay(null);
          displayRef.current = null;
        }, XP_REWARD_TIMING.calmHoldMs + XP_REWARD_TIMING.exitMs);
      }, XP_REWARD_TIMING.calmSettleMs);
      return;
    }

    const beginCount = () => {
      if (!alive()) return;
      setCoin(null);
      const t0 = performance.now();
      intervalRef.current = window.setInterval(() => {
        if (!alive()) return;
        const p = Math.min(1, (performance.now() - t0) / XP_REWARD_TIMING.countMs);
        applyDisplay(interpolateDisplay(startDisplay, startTotal, data.after, easeOutCubic(p)));
        if (p >= 1) {
          if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
          finish();
        }
      }, 16);
    };

    later(() => {
      if (!alive()) return;
      const target = avatarRef.current?.getBoundingClientRect();
      if (!target || target.width === 0) { beginCount(); return; }
      const flight = { x: popPos.x, y: popPos.y, key: reward.nonce };
      flightRef.current = flight;
      setCoin(flight);
      // The coin element mounts with this state; its flight starts in the
      // effect below once the ref exists.
      later(() => { if (alive() && flightRef.current === flight) beginCount(); }, XP_REWARD_TIMING.flightMs + 60);
    }, XP_REWARD_TIMING.flightDelayMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reward]);

  // Launch the coin's WAAPI arc once it has mounted.
  useEffect(() => {
    if (!coin || calm) return;
    const el = coinRef.current;
    const target = avatarRef.current?.getBoundingClientRect();
    if (!el || !target) return;
    const dx = target.left + target.width / 2 - coin.x;
    const dy = target.top + target.height / 2 - coin.y;
    if (typeof el.animate !== "function") return;
    const animation = el.animate([
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 64}px)) scale(1.05)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.45)`, opacity: 0.9 },
    ], { duration: XP_REWARD_TIMING.flightMs, easing: "cubic-bezier(.3,.65,.35,1)", fill: "forwards" });
    coinAnimRef.current = animation;
    return () => { animation.cancel(); if (coinAnimRef.current === animation) coinAnimRef.current = null; };
  }, [coin, calm]);

  // Portaled to <body>: the session stages style their direct children
  // (.er-study-stage > * { position: relative; z-index: 1 }), which would
  // override this overlay's fixed positioning and trap it inside the stage.
  // At body level the fixed, pointer-events:none contract always holds.
  return createPortal(
    <>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      {visible && display && (
        <div className="game-xp-reward" aria-hidden="true" data-testid="xp-reward-overlay">
          <div className={`game-xp-reward__bar ${exiting ? "is-exiting" : ""} ${calm ? "is-calm" : ""}`} data-testid="xp-reward-bar">
            <span className="game-xp-reward__avatar" ref={avatarRef}>
              <EntryAvatar avatar={avatar} name={name} size="card" />
            </span>
            <div className="game-xp-reward__main">
              <div className="game-xp-reward__line">
                <strong className="game-xp-reward__name">{name}</strong>
                <span className="game-xp-reward__total" data-testid="xp-reward-total">{display.total} XP</span>
              </div>
              <div className="game-xp-reward__track">
                <span style={{ width: `${Math.min(100, Math.max(0, (display.into / display.span) * 100))}%` }} />
              </div>
              <div className="game-xp-reward__caption">
                <span data-testid="xp-reward-level">Level {display.level} · {display.levelName}</span>
                <span data-testid="xp-reward-into">{display.into} / {display.span} XP</span>
              </div>
            </div>
            <span className={`game-xp-reward__crest ${flipKey > 0 ? "is-flipping" : ""}`} key={flipKey}>
              <LevelCrest level={display.level} levelName={display.levelName} size="row" />
            </span>
          </div>
          {pop && (
            <div
              className={`game-xp-reward__pop ${calm ? "is-calm" : ""}`}
              key={pop.key}
              style={{ left: pop.x, top: pop.y }}
              data-testid="xp-reward-pop"
            >
              +{pop.amount} XP
            </div>
          )}
          {coin && !calm && (
            <span className="game-xp-reward__coin" key={coin.key} ref={coinRef} style={{ left: coin.x, top: coin.y }} data-testid="xp-reward-coin">
              <span aria-hidden="true">★</span>
            </span>
          )}
        </div>
      )}
    </>,
    document.body,
  );
}
