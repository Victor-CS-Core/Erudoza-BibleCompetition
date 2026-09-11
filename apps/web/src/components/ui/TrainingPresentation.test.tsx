import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProgressMeter, WeeklyProgressStrip } from "./TrainingProgress";
import { HonorArtwork } from "./HonorArtwork";
import { TrainingDialog } from "./TrainingDialog";

afterEach(() => vi.unstubAllGlobals());

it("exposes actual progress and every saved day without implying a streak", () => {
  render(<><ProgressMeter label="Today's drill" value={3} max={8} /><WeeklyProgressStrip week={{ weekStartLocalDate: "2026-09-07", timeZone: "America/New_York", target: 5, completedDays: 1, days: [
    { localDate: "2026-09-07", credited: true, isToday: false },
    { localDate: "2026-09-08", credited: false, isToday: true },
  ] }} /></>);
  expect(screen.getByRole("progressbar", { name: "Today's drill" })).toHaveAttribute("value", "3");
  expect(screen.getByText("3 of 8")).toBeVisible();
  expect(screen.getByLabelText("Monday, September 7: practiced")).toBeVisible();
  expect(screen.getByLabelText("Tuesday, September 8: today, not yet practiced")).toHaveAttribute("aria-current", "date");
});

it("never animates honor art for reduced motion or coarse pointers", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const frame = vi.fn(); vi.stubGlobal("requestAnimationFrame", frame);
  render(<HonorArtwork src="/honor.webp" alt="Exact Recall" />);
  fireEvent.pointerMove(screen.getByRole("img").parentElement!, { pointerType: "mouse", clientX: 80, clientY: 20 });
  expect(frame).not.toHaveBeenCalled();
  expect(screen.getByRole("img")).not.toHaveAttribute("style");
});

it("tilts only artwork toward the pointer and cancels pending frames on unmount", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: fine"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  let callback: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => { callback = next; return 7; });
  const cancel = vi.fn(); vi.stubGlobal("cancelAnimationFrame", cancel);
  const view = render(<HonorArtwork src="/honor.webp" alt="Exact Recall" />);
  const img = screen.getByRole("img"); const surface = img.parentElement!;
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.pointerMove(surface, { clientX: 100, clientY: 0 });
  act(() => callback?.(100));
  expect(img.style.transform).toMatch(/rotateX\([\d.]+deg\) rotateY\([\d.]+deg\)/);
  expect(surface.style.transform).toBe("");
  view.unmount(); expect(cancel).toHaveBeenCalledWith(7);
});

it("rests on pointer exit and immediately resets when motion preferences change", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  let changed: (() => void) | undefined;
  const reduce = { matches: false, addEventListener: (_: string, callback: () => void) => { changed = callback; }, removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", (query: string) => query.includes("reduced-motion") ? reduce : { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (next: FrameRequestCallback) => { frame = next; return 9; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  render(<HonorArtwork src="/honor.webp" alt="Exact Recall" />);
  const img = screen.getByRole("img"), host = img.parentElement!;
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  fireEvent.pointerMove(host, { clientX: 100, clientY: 0 });
  act(() => frame?.(100));
  expect(img.style.transform).not.toBe("");
  fireEvent.pointerLeave(host);
  act(() => { for (let time = 116; time < 1300; time += 16) frame?.(time); });
  expect(img.style.transform).toBe("");
  fireEvent.pointerMove(host, { clientX: 0, clientY: 100 });
  act(() => frame?.(1400));
  reduce.matches = true;
  act(() => changed?.());
  expect(img.style.transform).toBe("");
  expect(img.style.willChange).toBe("");
});

it("locks Escape during saves and restores the invoking control on close", () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const close = vi.fn();
  const view = render(<button>Change goal</button>);
  const trigger = screen.getByRole("button"); trigger.focus();
  view.rerender(<><button>Change goal</button><TrainingDialog open title="Weekly goal" pending onClose={close}><p>Save in progress</p></TrainingDialog></>);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  view.rerender(<><button>Change goal</button><TrainingDialog open title="Weekly goal" onClose={close}><p>Ready</p></TrainingDialog></>);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  view.rerender(<button>Change goal</button>);
  expect(screen.getByRole("button")).toHaveFocus();
});
