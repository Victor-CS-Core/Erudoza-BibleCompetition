import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachCoffeeWidget } from "./coffeeWidgetAdapter";

// Contract fixture for the body-level controls created by the official widget.
// Browser verification also runs the actual vendor script; this is not checkout.
function providerWidget() {
  const launcher = document.createElement("div");
  launcher.id = "bmc-wbtn";
  const overlay = document.createElement("div");
  const close = document.createElement("div");
  close.id = "bmc-close-btn";
  const frame = document.createElement("iframe");
  frame.id = "bmc-iframe";
  frame.style.opacity = "0";
  overlay.append(close, frame);
  launcher.onclick = () => { frame.style.opacity = "1"; };
  overlay.onclick = () => { frame.style.opacity = "0"; };
  document.body.append(overlay, launcher);
  return { launcher, overlay, close, frame };
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.(); stop = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-erudoza-coffee-ready");
  document.documentElement.removeAttribute("data-erudoza-coffee-open");
  document.body.style.overflow = "";
});

describe("official coffee widget adapter", () => {
  it("waits for the provider and fails quietly if the script is blocked", async () => {
    stop = attachCoffeeWidget();
    expect(document.documentElement).not.toHaveAttribute("data-erudoza-coffee-ready");
    expect(document.body.style.overflow).toBe("");
    const { launcher } = providerWidget();
    await waitFor(() => expect(launcher).toHaveAttribute("role", "button"));
    expect(launcher).toHaveAttribute("aria-label", "Buy me a coffee");
    expect(launcher).toHaveAttribute("tabindex", "0");
    expect(document.documentElement).toHaveAttribute("data-erudoza-coffee-ready", "true");
  });

  it("opens by keyboard, closes by Escape, and restores focus and page scrolling", async () => {
    const root = document.createElement("main"); root.id = "root";
    document.body.append(root);
    const { launcher, overlay, close, frame } = providerWidget();
    stop = attachCoffeeWidget();
    launcher.focus();
    fireEvent.keyDown(launcher, { key: "Enter" });
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "true"));
    expect(close).toHaveFocus();
    expect(root.inert).toBe(true);
    expect(overlay).toHaveAttribute("role", "dialog");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "false"));
    expect(frame.style.opacity).toBe("0");
    await waitFor(() => expect(launcher).toHaveFocus());
    expect(root.inert).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("reopens without duplicate controls after StrictMode-style cleanup", async () => {
    const { launcher, close, frame } = providerWidget();
    stop = attachCoffeeWidget(); stop();
    stop = attachCoffeeWidget();
    const providerOpen = vi.spyOn(launcher, "click");
    fireEvent.keyDown(launcher, { key: " " });
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "true"));
    expect(providerOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(close, { key: "Enter" });
    await waitFor(() => expect(frame.style.opacity).toBe("0"));
    fireEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "true"));
    expect(document.querySelectorAll("[data-coffee-focus-guard]")).toHaveLength(2);
  });

  it("closes and hides on route/account teardown, without moving focus back to the old screen", async () => {
    const { launcher, frame } = providerWidget();
    stop = attachCoffeeWidget();
    fireEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "true"));
    const next = document.createElement("button"); document.body.append(next);
    stop(); stop = undefined;
    next.focus();
    expect(frame.style.opacity).toBe("0");
    expect(document.documentElement).not.toHaveAttribute("data-erudoza-coffee-ready");
    expect(document.querySelectorAll("[data-coffee-focus-guard]")).toHaveLength(0);
    expect(next).toHaveFocus();
  });

  it("cancels delayed focus restoration when navigation tears down the widget", async () => {
    const { launcher, close } = providerWidget();
    stop = attachCoffeeWidget();
    fireEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "true"));
    fireEvent.keyDown(close, { key: "Escape" });
    stop(); stop = undefined;
    const destination = document.createElement("button"); document.body.append(destination);
    destination.focus();
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(destination).toHaveFocus();
  });

  it("suspends the widget while an application dialog is open", async () => {
    const { launcher, frame } = providerWidget();
    stop = attachCoffeeWidget();
    fireEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "true"));
    const dialog = document.createElement("dialog"); dialog.setAttribute("open", "");
    document.body.append(dialog);
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute("data-erudoza-coffee-ready"));
    expect(frame.style.opacity).toBe("0");
    dialog.remove();
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-erudoza-coffee-ready", "true"));
    expect(launcher).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the app command shortcut from opening a second overlay", async () => {
    const { launcher, close } = providerWidget();
    stop = attachCoffeeWidget();
    fireEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-expanded", "true"));
    const shortcut = vi.fn(); window.addEventListener("keydown", shortcut);
    try {
      fireEvent.keyDown(close, { key: "k", ctrlKey: true });
      expect(shortcut).not.toHaveBeenCalled();
      expect(launcher).toHaveAttribute("aria-expanded", "true");
    } finally { window.removeEventListener("keydown", shortcut); }
  });
});
