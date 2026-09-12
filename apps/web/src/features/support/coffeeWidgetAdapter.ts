type Controls = {
  launcher: HTMLElement;
  close: HTMLElement;
  frame: HTMLIFrameElement;
  overlay: HTMLElement;
};

// DOM contract of the pinned, official 1.0.0 widget. The provider owns all
// payment content and open/close handlers; this adapter only adds app lifecycle
// and accessibility behavior. If that contract changes, keep the widget hidden.
export function attachCoffeeWidget(onLinkSlot?: (slot: HTMLElement | null) => void): () => void {
  const html = document.documentElement;
  let controls: Controls | undefined;
  let opened = false;
  let disposed = false;
  let suspended = false;
  let pageRoot: HTMLElement | null = null;
  let previousInert = false;
  let previousOverflow = "";
  let guards: HTMLElement[] = [];
  let restoreFrame = 0;
  let linkSlot: HTMLElement | undefined;

  const setOpen = (next: boolean, restoreFocus = true) => {
    if (!controls) return;
    const { launcher, close, overlay } = controls;
    launcher.setAttribute("aria-expanded", String(next));
    overlay.hidden = !next;
    overlay.inert = !next;
    overlay.setAttribute("aria-hidden", String(!next));
    if (next === opened) return;
    cancelAnimationFrame(restoreFrame);
    opened = next;
    if (next) {
      html.setAttribute("data-erudoza-coffee-open", "true");
      pageRoot = document.getElementById("root");
      previousInert = Boolean(pageRoot?.inert);
      previousOverflow = document.body.style.overflow;
      if (pageRoot) pageRoot.inert = true;
      document.body.style.overflow = "hidden";
      close.focus();
    } else {
      html.removeAttribute("data-erudoza-coffee-open");
      if (pageRoot) pageRoot.inert = previousInert;
      document.body.style.overflow = previousOverflow;
      if (restoreFocus) {
        // The provider replaces launcher children while hiding the focused
        // popup. Restore after the browser finishes that visibility change.
        restoreFrame = requestAnimationFrame(() => {
          if (!disposed && !suspended && !opened && launcher.isConnected) launcher.focus();
        });
      }
    }
  };
  const closeWidget = (restoreFocus = true) => {
    // Clicking the vendor's backdrop also resets its own transforms/icon state.
    if (controls?.frame.style.opacity === "1") controls.overlay.click();
    setOpen(false, restoreFocus);
  };
  const syncOpen = () => {
    if (disposed || !controls) return;
    if (suspended) closeWidget(false);
    else setOpen(controls.frame.style.opacity === "1");
  };
  const frameObserver = new MutationObserver(syncOpen);

  const keydown = (event: KeyboardEvent) => {
    if (!controls || suspended) return;
    if (opened && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); closeWidget();
    } else if (opened && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      // The command center must not capture a hidden donation control as its opener.
      event.preventDefault(); event.stopPropagation();
    } else if ((event.key === "Enter" || event.key === " ") &&
      (event.target === controls.launcher || event.target === controls.close)) {
      event.preventDefault();
      if (opened) closeWidget();
      else controls.launcher.click();
    } else if (opened && event.key === "Tab" && event.shiftKey && event.target === controls.close) {
      event.preventDefault(); controls.frame.focus();
    }
  };
  const focusin = (event: FocusEvent) => {
    if (opened && controls && event.target instanceof Node && !controls.overlay.contains(event.target)) {
      controls.close.focus();
    }
  };
  const bind = () => {
    const launcher = document.getElementById("bmc-wbtn");
    const close = document.getElementById("bmc-close-btn");
    const frame = document.getElementById("bmc-iframe");
    const overlay = frame?.parentElement;
    if (!launcher || !close || !(frame instanceof HTMLIFrameElement) || !overlay ||
      !overlay.contains(close) || typeof launcher.onclick !== "function" || typeof overlay.onclick !== "function") return;
    controls = { launcher, close, frame, overlay };
    launcher.setAttribute("role", "button");
    launcher.setAttribute("aria-label", "Buy me a coffee");
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-controls", "erudoza-coffee-overlay");
    launcher.tabIndex = 0;
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", "Close donation popup");
    close.tabIndex = 0;
    frame.title = "Support Erudoza on Buy Me a Coffee";
    overlay.id = "erudoza-coffee-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Support Erudoza");
    // Sentinels catch Tab as it leaves the cross-origin frame, without reading
    // or altering the provider's form. Escape inside that frame is provider-owned.
    guards = [document.createElement("span"), document.createElement("span")];
    for (const guard of guards) { guard.tabIndex = 0; guard.setAttribute("data-coffee-focus-guard", ""); }
    guards[0].onfocus = () => frame.focus();
    guards[1].onfocus = () => close.focus();
    overlay.prepend(guards[0]); overlay.append(guards[1]);
    linkSlot = document.createElement("div");
    linkSlot.className = "coffee-popup-link";
    linkSlot.onclick = event => event.stopPropagation();
    overlay.insertBefore(linkSlot, frame);
    onLinkSlot?.(linkSlot);
    frameObserver.observe(frame, { attributes: true, attributeFilter: ["style"] });
    setOpen(false, false);
  };
  const refresh = () => {
    if (disposed) return;
    if (controls && (!controls.launcher.isConnected || !controls.overlay.isConnected)) {
      closeWidget(false); frameObserver.disconnect();
      guards.forEach(guard => guard.remove()); linkSlot?.remove(); onLinkSlot?.(null); controls = undefined;
    }
    if (!controls) bind();
    suspended = Boolean(document.querySelector("dialog[open]"));
    if (controls && !suspended) html.setAttribute("data-erudoza-coffee-ready", "true");
    else { html.removeAttribute("data-erudoza-coffee-ready"); closeWidget(false); }
    syncOpen();
  };
  const bodyObserver = new MutationObserver(refresh);
  bodyObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("focusin", focusin);
  refresh();
  return () => {
    disposed = true;
    cancelAnimationFrame(restoreFrame);
    bodyObserver.disconnect(); frameObserver.disconnect();
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("focusin", focusin);
    closeWidget(false);
    guards.forEach(guard => guard.remove()); linkSlot?.remove(); onLinkSlot?.(null);
    html.removeAttribute("data-erudoza-coffee-ready");
    html.removeAttribute("data-erudoza-coffee-open");
  };
}
