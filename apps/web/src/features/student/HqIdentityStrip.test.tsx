import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HqIdentityStrip } from "./HqIdentityStrip";
import type { PlayerCardXp } from "../../components/game/GameLayer";

const xp: PlayerCardXp = { total: 612, xpIntoLevel: 112, xpForNext: 288, nextLevelName: "Scribe", level: 4, levelName: "Keeper" };

function renderStrip() {
  return render(
    <div className="training-dashboard student-home">
      <section className="training-hq-hero">hero</section>
      <HqIdentityStrip name="Sam Rivera" xp={xp} avatar={<span data-entry-avatar="character" />} />
    </div>,
  );
}

type IoEntry = { isIntersecting: boolean; target: Element };
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: (entries: IoEntry[]) => void;
  constructor(callback: (entries: IoEntry[]) => void) { this.callback = callback; MockIntersectionObserver.instances.push(this); }
  observe() {}
  unobserve() {}
  disconnect() {}
  report(entry: IoEntry) { this.callback([entry]); }
}

afterEach(() => { vi.unstubAllGlobals(); MockIntersectionObserver.instances = []; document.documentElement.style.scrollPaddingTop = ""; });

describe("HqIdentityStrip (R2 collapsing hero)", () => {
  it("renders the profile picture, first name, level text and a mini XP bar — no crest (the level is already text)", () => {
    renderStrip();
    const strip = screen.getByTestId("hq-identity-strip");
    // Owner direction (2026-11-23): in the sticky bar the face replaces
    // the crest, because the level is spelled out in text right beside it.
    expect(strip.querySelector("[data-entry-avatar]")).not.toBeNull();
    expect(strip.querySelector(".game-level-crest")).toBeNull();
    expect(within(strip).getByText("Sam")).toBeInTheDocument();
    expect(within(strip).getByText("Level 4 · Keeper")).toBeInTheDocument();
    expect(strip.querySelector("progress")).not.toBeNull();
  });

  it("stays hidden while the hero is on screen (no IntersectionObserver in jsdom)", () => {
    renderStrip();
    const strip = screen.getByTestId("hq-identity-strip");
    expect(strip).not.toHaveClass("is-visible");
    expect(strip).toHaveAttribute("aria-hidden", "true");
  });

  it("appears only once the hero is fully off-screen, lends its height to scroll-padding, and restores both", () => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const { container } = renderStrip();
    const strip = screen.getByTestId("hq-identity-strip");
    const hero = container.querySelector(".training-hq-hero")!;
    const observer = MockIntersectionObserver.instances[0];
    expect(observer).toBeDefined();

    act(() => observer.report({ isIntersecting: true, target: hero }));
    expect(strip).not.toHaveClass("is-visible");

    act(() => observer.report({ isIntersecting: false, target: hero }));
    expect(strip).toHaveClass("is-visible");
    expect(strip).toHaveAttribute("aria-hidden", "false");
    // jsdom measures no layout (offsetHeight 0), but the compensation is wired.
    expect(document.documentElement.style.scrollPaddingTop).toBe("0px");

    act(() => observer.report({ isIntersecting: true, target: hero }));
    expect(strip).not.toHaveClass("is-visible");
    expect(document.documentElement.style.scrollPaddingTop).toBe("");
  });
});
