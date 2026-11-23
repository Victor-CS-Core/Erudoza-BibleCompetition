import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XP_REWARD_TIMING, XpRewardOverlay, useXpReward } from "./XpReward";
import type { XpReward } from "../../api/trainingTypes";

// CSS imports are stubbed in this test setup, so the fidelity pins read the
// real stylesheet from disk (same pattern as GameLayer.test.tsx).
const nodeFs = "node:" + "fs";
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: string, encoding: string): string };
const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ".";
const gameLayerCss = readFileSync(`${cwd}/src/components/game/game-layer.css`, "utf8");

// Real-curve-shaped snapshots (Lv 7 Guide: 2000 XP floor, 800 XP span).
const basic: XpReward = {
  earned: 10,
  before: { total: 2286, level: 7, levelName: "Guide", xpIntoLevel: 286, xpForNext: 514 },
  after: { total: 2296, level: 7, levelName: "Guide", xpIntoLevel: 296, xpForNext: 504 },
};
const followUp: XpReward = {
  earned: 10,
  before: { total: 2296, level: 7, levelName: "Guide", xpIntoLevel: 296, xpForNext: 504 },
  after: { total: 2306, level: 7, levelName: "Guide", xpIntoLevel: 306, xpForNext: 494 },
};
// The mockup's level-up shape: 286/400 in the level + 120 earned → the bar
// fills, the badge flips, and 6 XP of overflow lands in the new level.
const levelUp: XpReward = {
  earned: 120,
  before: { total: 686, level: 5, levelName: "Scribe", xpIntoLevel: 286, xpForNext: 114 },
  after: { total: 806, level: 6, levelName: "Scholar", xpIntoLevel: 6, xpForNext: 394 },
};

function Harness() {
  const { reward, fire } = useXpReward();
  return (
    <>
      <button data-testid="fire-basic" onClick={() => fire(basic)}>basic</button>
      <button data-testid="fire-follow" onClick={() => fire(followUp)}>follow</button>
      <button data-testid="fire-levelup" onClick={() => fire(levelUp)}>levelup</button>
      <button data-testid="fire-zero" onClick={() => fire({ ...basic, earned: 0 })}>zero</button>
      <XpRewardOverlay reward={reward} name="Sam R." avatar={null} />
    </>
  );
}

const FULL_RUN = XP_REWARD_TIMING.flightDelayMs + XP_REWARD_TIMING.flightMs + 60 + XP_REWARD_TIMING.countMs + XP_REWARD_TIMING.holdMs + XP_REWARD_TIMING.exitMs + 50;

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("XpRewardOverlay", () => {
  it("renders nothing until a reward fires, and ignores non-positive rewards", () => {
    render(<Harness />);
    expect(screen.queryByTestId("xp-reward-overlay")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("fire-zero"));
    expect(screen.queryByTestId("xp-reward-overlay")).not.toBeInTheDocument();
  });

  it("pops the earned XP, shows the profile bar, and lands the count on the server's after state", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("fire-basic"));
    // The pop carries the exact server-awarded amount; the bar opens on the
    // server's before state.
    expect(screen.getByTestId("xp-reward-pop")).toHaveTextContent("+10 XP");
    expect(screen.getByTestId("xp-reward-bar")).toBeInTheDocument();
    expect(screen.getByText("Sam R.")).toBeInTheDocument();
    expect(screen.getByTestId("xp-reward-total")).toHaveTextContent("2286 XP");
    expect(screen.getByTestId("xp-reward-level")).toHaveTextContent("Level 7 · Guide");
    expect(screen.getByTestId("xp-reward-into")).toHaveTextContent("286 / 800 XP");
    expect(screen.getByRole("status")).toHaveTextContent("+10 XP earned");
    // The full sequence lands exactly on the server's after state, then the
    // bar dismisses itself.
    advance(FULL_RUN);
    expect(screen.queryByTestId("xp-reward-overlay")).not.toBeInTheDocument();
  });

  it("counts up to the after totals mid-sequence (not just at the end)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("fire-basic"));
    advance(XP_REWARD_TIMING.flightDelayMs + XP_REWARD_TIMING.flightMs + 60 + XP_REWARD_TIMING.countMs + 10);
    expect(screen.getByTestId("xp-reward-total")).toHaveTextContent("2296 XP");
    expect(screen.getByTestId("xp-reward-into")).toHaveTextContent("296 / 800 XP");
    advance(XP_REWARD_TIMING.holdMs + XP_REWARD_TIMING.exitMs + 50);
    expect(screen.queryByTestId("xp-reward-overlay")).not.toBeInTheDocument();
  });

  it("level-up: the badge flips to the new level and the overflow lands in its bar", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("fire-levelup"));
    expect(screen.getByTestId("xp-reward-pop")).toHaveTextContent("+120 XP");
    advance(XP_REWARD_TIMING.flightDelayMs + XP_REWARD_TIMING.flightMs + 60 + XP_REWARD_TIMING.countMs + 10);
    expect(screen.getByTestId("xp-reward-total")).toHaveTextContent("806 XP");
    expect(screen.getByTestId("xp-reward-level")).toHaveTextContent("Level 6 · Scholar");
    expect(screen.getByTestId("xp-reward-into")).toHaveTextContent("6 / 400 XP");
    // The crest is inside the aria-hidden overlay, so query the DOM directly.
    expect(document.querySelector('.game-level-crest[aria-label="Level 6 · Scholar"]')).not.toBeNull();
    // The crest wrapper carries the flip pulse after the level changed.
    expect(document.querySelector(".game-xp-reward__crest.is-flipping")).not.toBeNull();
  });

  it("merges a second correct answer into the running bar instead of stacking", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("fire-basic"));
    advance(300); // mid-flight of the first reward
    fireEvent.click(screen.getByTestId("fire-follow"));
    expect(screen.getAllByTestId("xp-reward-bar")).toHaveLength(1);
    expect(screen.getByTestId("xp-reward-pop")).toHaveTextContent("+10 XP");
    expect(screen.getByRole("status")).toHaveTextContent("+10 XP earned");
    advance(FULL_RUN);
    expect(screen.queryByTestId("xp-reward-overlay")).not.toBeInTheDocument();
  });

  it("merging retargets the count to the newest server state", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("fire-basic"));
    advance(XP_REWARD_TIMING.flightDelayMs + XP_REWARD_TIMING.flightMs + 60 + XP_REWARD_TIMING.countMs + 10);
    expect(screen.getByTestId("xp-reward-total")).toHaveTextContent("2296 XP");
    fireEvent.click(screen.getByTestId("fire-follow"));
    advance(XP_REWARD_TIMING.flightDelayMs + XP_REWARD_TIMING.flightMs + 60 + XP_REWARD_TIMING.countMs + 10);
    expect(screen.getByTestId("xp-reward-total")).toHaveTextContent("2306 XP");
    expect(screen.getByTestId("xp-reward-into")).toHaveTextContent("306 / 800 XP");
  });

  it("calm variant (reduced motion): no coin ever, values settle, bar dismisses", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
    render(<Harness />);
    fireEvent.click(screen.getByTestId("fire-basic"));
    expect(screen.getByTestId("xp-reward-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("xp-reward-coin")).not.toBeInTheDocument();
    advance(XP_REWARD_TIMING.calmSettleMs + 10);
    expect(screen.getByTestId("xp-reward-total")).toHaveTextContent("2296 XP");
    expect(screen.queryByTestId("xp-reward-coin")).not.toBeInTheDocument();
    advance(XP_REWARD_TIMING.calmHoldMs + XP_REWARD_TIMING.exitMs + 50);
    expect(screen.queryByTestId("xp-reward-overlay")).not.toBeInTheDocument();
  });

  it("unmounting mid-animation cancels everything — no timers fire afterwards", () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByTestId("fire-basic"));
    advance(300); // pop up, coin in flight
    expect(screen.getByTestId("xp-reward-overlay")).toBeInTheDocument();
    unmount();
    // Any leaked timer/interval would surface as a React state-update error
    // or a thrown fake-timer callback here.
    expect(() => advance(10_000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stylesheet pins: fixed non-interactive overlay, 58px navy bar, no transition: all", () => {
    expect(gameLayerCss).toMatch(/\.game-xp-reward \{[^}]*position: fixed/);
    expect(gameLayerCss).toMatch(/\.game-xp-reward \{[^}]*pointer-events: none/);
    expect(gameLayerCss).toMatch(/\.game-xp-reward__bar \{[^}]*height: 58px/);
    expect(gameLayerCss).toMatch(/\.game-xp-reward__bar \{[^}]*background: var\(--er-navy-surface\)/);
    const rewardCss = gameLayerCss.slice(gameLayerCss.indexOf(".game-xp-reward {"));
    expect(rewardCss).not.toContain("transition: all");
  });
});
