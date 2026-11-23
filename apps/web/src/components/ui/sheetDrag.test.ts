import { describe, expect, it } from "vitest";
import {
  SHEET_DISMISS_OFFSET_PX,
  SHEET_DISMISS_VELOCITY_PX_PER_MS,
  SHEET_FLICK_OFFSET_PX,
  sheetDragOffset,
  sheetDragVelocity,
  shouldDismissSheet,
} from "./sheetDrag";

describe("sheetDragOffset", () => {
  it("measures downward distance and never follows the pointer up", () => {
    expect(sheetDragOffset(200, 260)).toBe(60);
    expect(sheetDragOffset(200, 200)).toBe(0);
    expect(sheetDragOffset(200, 120)).toBe(0);
  });
});

describe("sheetDragVelocity", () => {
  it("is zero without a movement window", () => {
    expect(sheetDragVelocity([])).toBe(0);
    expect(sheetDragVelocity([{ y: 100, t: 0 }])).toBe(0);
    expect(sheetDragVelocity([{ y: 100, t: 0 }, { y: 160, t: 0 }])).toBe(0);
  });

  it("averages over the trailing 100ms, ignoring the slow start of a flick", () => {
    const samples = [
      { y: 0, t: 0 }, { y: 4, t: 200 }, { y: 10, t: 400 },
      { y: 30, t: 450 }, { y: 70, t: 500 },
    ];
    // Trailing window starts at t=400: (70 - 10) / (500 - 400) = 0.6 px/ms.
    expect(sheetDragVelocity(samples)).toBeCloseTo(0.6);
  });

  it("reports upward movement as negative velocity", () => {
    expect(sheetDragVelocity([{ y: 100, t: 0 }, { y: 60, t: 50 }])).toBeLessThan(0);
  });
});

describe("shouldDismissSheet", () => {
  it("dismisses past the distance threshold at any speed", () => {
    expect(shouldDismissSheet(SHEET_DISMISS_OFFSET_PX + 1, 0)).toBe(true);
    expect(shouldDismissSheet(SHEET_DISMISS_OFFSET_PX, 0)).toBe(false);
  });

  it("dismisses a shorter drag that ends in a downward flick", () => {
    expect(shouldDismissSheet(SHEET_FLICK_OFFSET_PX + 20, SHEET_DISMISS_VELOCITY_PX_PER_MS + 0.2)).toBe(true);
  });

  it("snaps back a short, slow drag", () => {
    expect(shouldDismissSheet(SHEET_FLICK_OFFSET_PX + 20, 0.1)).toBe(false);
    expect(shouldDismissSheet(30, 2)).toBe(false);
    expect(shouldDismissSheet(0, 0)).toBe(false);
  });
});
