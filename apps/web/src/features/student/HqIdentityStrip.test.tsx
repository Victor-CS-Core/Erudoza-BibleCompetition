import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HqIdentityStrip } from "./HqIdentityStrip";
import type { PlayerCardXp } from "../../components/game/GameLayer";

const xp: PlayerCardXp = { total: 612, xpIntoLevel: 112, xpForNext: 288, nextLevelName: "Scribe", level: 4, levelName: "Keeper" };

function renderStrip() {
  return render(
    <div className="training-dashboard student-home">
      <section className="training-hq-hero">hero</section>
      <HqIdentityStrip name="Sam Rivera" xp={xp} />
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
  it("renders crest, first name, level and a mini XP bar — never a character avatar", () => {
    renderStrip();
    const strip = screen.getByTestId("hq-identity-strip");
    // The strip starts aria-hidden (hero on screen), so query the crest
    // element directly rather than by role.
    expect(strip.querySelector(".game-level-crest")).toHaveAttribute("aria-label", "Level 4 · Keeper");
    expect(within(strip).getByText("Sam")).toBeInTheDocument();
    expect(within(strip).getByText("Level 4 · Keeper")).toBeInTheDocument();
    expect(strip.querySelector("progress")).not.toBeNull();
    expect(strip.querySelector("[data-entry-avatar], img")).toBeNull();
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
