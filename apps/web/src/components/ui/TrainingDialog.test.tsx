import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainingDialog } from "./TrainingDialog";

// CSS imports are stubbed in this test setup, so the sheet pins read the
// real stylesheet from disk (same pattern as GameLayer.test.tsx).
const nodeFs = "node:" + "fs";
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: string, encoding: string): string };
const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ".";
const designSystemCss = readFileSync(`${cwd}/src/styles/design-system.css`, "utf8");

function stubPhone() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 760px)", media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }));
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { vi.unstubAllGlobals(); });

function renderDialog(onClose: () => void, pending = false) {
  const utils = render(<TrainingDialog open title="Weekly goal" onClose={onClose} pending={pending}><p>Sheet body</p></TrainingDialog>);
  const dialog = utils.container.querySelector("dialog")!;
  const header = dialog.querySelector("header")!;
  return { ...utils, dialog, header };
}

// RTL's synthetic pointer events lose clientY/pointerId in this jsdom, so
// the gesture is driven with native events carrying the exact properties
// the hook reads (the hook itself listens natively on the dialog).
function pointer(target: Element, type: string, clientY: number, timeStamp: number) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientY: { value: clientY },
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
    button: { value: 0 },
    timeStamp: { value: timeStamp },
  });
  target.dispatchEvent(event);
}

function drag(dialog: HTMLElement, target: Element, fromY: number, moves: [number, number][]) {
  pointer(target, "pointerdown", fromY, 0);
  for (const [y, t] of moves) pointer(dialog, "pointermove", y, t);
}
function release(dialog: HTMLElement, y: number, t: number) {
  pointer(dialog, "pointerup", y, t);
}

describe("TrainingDialog drag-to-dismiss (phone sheet)", () => {
  it("dismisses through onClose when dragged past the threshold from the header", () => {
    stubPhone();
    const onClose = vi.fn();
    const { dialog, header } = renderDialog(onClose);
    drag(dialog, header.querySelector("h2")!, 300, [[360, 50], [430, 100]]);
    expect(dialog.style.transform).toBe("translateY(130px)");
    release(dialog, 430, 120);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog.style.transform).toBe("");
  });

  it("dismisses a short drag that ends in a downward flick from the handle", () => {
    stubPhone();
    const onClose = vi.fn();
    const { dialog } = renderDialog(onClose);
    drag(dialog, dialog.querySelector(".ds-sheet-handle")!, 300, [[330, 380], [365, 420]]);
    release(dialog, 365, 430);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("snaps back without closing on a short, slow drag", () => {
    stubPhone();
    const onClose = vi.fn();
    const { dialog, header } = renderDialog(onClose);
    drag(dialog, header.querySelector("h2")!, 300, [[330, 300], [345, 600]]);
    expect(dialog.style.transform).toBe("translateY(45px)");
    release(dialog, 345, 700);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.style.transform).toBe("");
  });

  it("never starts a drag from the Close button", () => {
    stubPhone();
    const onClose = vi.fn();
    const { dialog } = renderDialog(onClose);
    const close = screen.getByRole("button", { name: "Close dialog" });
    drag(dialog, close, 300, [[430, 100]]);
    expect(dialog.style.transform).toBe("");
    release(dialog, 430, 120);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not drag when the dialog is pending", () => {
    stubPhone();
    const onClose = vi.fn();
    const { dialog, header } = renderDialog(onClose, true);
    drag(dialog, header.querySelector("h2")!, 300, [[430, 100]]);
    expect(dialog.style.transform).toBe("");
    release(dialog, 430, 120);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not drag at desktop widths", () => {
    // No matchMedia stub: jsdom has none, so the phone layout is off.
    const onClose = vi.fn();
    const { dialog, header } = renderDialog(onClose);
    drag(dialog, header.querySelector("h2")!, 300, [[430, 100]]);
    expect(dialog.style.transform).toBe("");
    release(dialog, 430, 120);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders the grab handle inside the sheet", () => {
    stubPhone();
    const { dialog } = renderDialog(vi.fn());
    expect(dialog.querySelector(".ds-sheet-handle")).not.toBeNull();
  });
});

describe("sheet drag CSS pins", () => {
  it("gives the handle and header touch-action:none so scrolling cannot steal the drag", () => {
    expect(designSystemCss).toContain(".ds-training-dialog > header { touch-action:none; cursor:grab; border-bottom:1px solid var(--er-border); padding-bottom:var(--er-space-3); }");
    expect(designSystemCss).toContain(".ds-sheet-handle { display:block;");
    expect(designSystemCss).toContain(".ds-sheet-handle { display:none; }");
  });
});
