import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpinnablePatch } from "./SpinnablePatch";

const front = <img src="front.webp" alt="" data-testid="front" />;
const back = <img src="back.webp" alt="" data-testid="back" />;

/** jsdom has no PointerEvent constructor, so dispatch plain events with pointer fields assigned. */
function dispatchPointer(target: EventTarget, type: string, init: Record<string, unknown> = {}) {
  act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, init);
    target.dispatchEvent(event);
  });
}

function mockMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? reduced : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function mockWidth(el: HTMLElement, width: number) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width, height: width, top: 0, left: 0, right: width, bottom: width, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

const coinTransform = (container: HTMLElement) =>
  (container.querySelector(".ds-spin-patch__coin") as HTMLElement).style.transform;

describe("SpinnablePatch", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("renders front and back faces with a gold edge between them", () => {
    const { container } = render(<SpinnablePatch front={front} back={back} />);
    expect(container.querySelector(".ds-spin-patch__face--front")).not.toBeNull();
    expect(container.querySelector(".ds-spin-patch__face--back")).not.toBeNull();
    expect(container.querySelectorAll(".ds-spin-patch__edge")).toHaveLength(10);
  });

  it("spins while dragging and snaps to the nearest face on release", () => {
    const { container } = render(<SpinnablePatch front={front} back={back} />);
    const root = container.querySelector(".ds-spin-patch") as HTMLElement;
    mockWidth(root, 200);
    dispatchPointer(root, "pointerdown", { clientX: 100, pointerType: "mouse", button: 0 });
    dispatchPointer(window, "pointermove", { clientX: 200, pointerType: "mouse" });
    expect(coinTransform(container)).toBe("rotateY(90deg)");
    dispatchPointer(window, "pointerup", { pointerType: "mouse" });
    expect(coinTransform(container)).toBe("rotateY(180deg)");
  });

  it("swallows the click that follows a drag but keeps plain clicks working", () => {
    const onClick = vi.fn();
    const { container } = render(<button onClick={onClick}><SpinnablePatch front={front} back={back} /></button>);
    const root = container.querySelector(".ds-spin-patch") as HTMLElement;
    mockWidth(root, 200);
    // Drag, then the release click that would otherwise open details.
    dispatchPointer(root, "pointerdown", { clientX: 100, pointerType: "mouse", button: 0 });
    dispatchPointer(window, "pointermove", { clientX: 150, pointerType: "mouse" });
    dispatchPointer(window, "pointerup", { pointerType: "mouse" });
    dispatchPointer(root, "click", { button: 0 });
    expect(onClick).not.toHaveBeenCalled();
    // A plain click still opens details.
    dispatchPointer(root, "pointerdown", { clientX: 100, pointerType: "mouse", button: 0 });
    dispatchPointer(window, "pointerup", { pointerType: "mouse" });
    dispatchPointer(root, "click", { button: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("spins with the arrow keys", () => {
    const { container } = render(<SpinnablePatch front={front} back={back} />);
    const root = container.querySelector(".ds-spin-patch") as HTMLElement;
    act(() => {
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(coinTransform(container)).toBe("rotateY(180deg)");
    act(() => {
      root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(coinTransform(container)).toBe("rotateY(0deg)");
  });

  it("renders the front statically when reduced motion is preferred", () => {
    mockMatchMedia(true);
    const { container } = render(<SpinnablePatch front={front} back={back} />);
    expect(container.querySelector(".ds-spin-patch__coin")).toBeNull();
    expect(container.querySelector("[data-testid='front']")).not.toBeNull();
  });
});
