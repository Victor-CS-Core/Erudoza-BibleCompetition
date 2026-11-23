import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainingDialog } from "./TrainingDialog";
import { lockScroll, scrollLockCount, unlockScroll } from "./scrollLock";

describe("scrollLock", () => {
  afterEach(() => {
    while (scrollLockCount() > 0) unlockScroll();
    document.body.removeAttribute("style");
    document.body.classList.remove("scroll-locked");
    vi.restoreAllMocks();
  });

  it("pins the body at the current offset and restores the exact position on release", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(window, "scrollY", { value: 240, configurable: true });
    lockScroll();
    expect(document.body).toHaveClass("scroll-locked");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-240px");
    expect(document.documentElement.style.overscrollBehavior).toBe("none");
    unlockScroll();
    expect(document.body).not.toHaveClass("scroll-locked");
    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
  });

  it("stays locked until the last stacked overlay releases", () => {
    lockScroll();
    lockScroll();
    expect(scrollLockCount()).toBe(2);
    unlockScroll();
    expect(document.body).toHaveClass("scroll-locked");
    expect(document.body.style.position).toBe("fixed");
    unlockScroll();
    expect(scrollLockCount()).toBe(0);
    expect(document.body).not.toHaveClass("scroll-locked");
  });

  it("engages while a dialog is open and releases when it closes", () => {
    const view = render(<TrainingDialog open title="Weekly goal" onClose={() => {}}><p>Body</p></TrainingDialog>);
    expect(document.body).toHaveClass("scroll-locked");
    view.rerender(<TrainingDialog open={false} title="Weekly goal" onClose={() => {}}><p>Body</p></TrainingDialog>);
    expect(document.body).not.toHaveClass("scroll-locked");
  });

  it("stacked dialogs keep the lock until the last one closes", () => {
    const view = render(<>
      <TrainingDialog open title="First" onClose={() => {}}><p>One</p></TrainingDialog>
      <TrainingDialog open title="Second" onClose={() => {}}><p>Two</p></TrainingDialog>
    </>);
    expect(scrollLockCount()).toBe(2);
    view.rerender(<TrainingDialog open title="First" onClose={() => {}}><p>One</p></TrainingDialog>);
    expect(document.body).toHaveClass("scroll-locked");
    view.unmount();
    expect(document.body).not.toHaveClass("scroll-locked");
  });
});
