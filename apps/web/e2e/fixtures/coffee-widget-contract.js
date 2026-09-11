/* global document, window */
// Minimal stand-in for the official widget's documented DOM contract.
// It deliberately owns only provider nodes/handlers; the app adapter supplies
// route visibility, dialog semantics, focus handling, and responsive positioning.
const script = document.querySelector('script[data-name="BMC-Widget"]');
window.addEventListener("DOMContentLoaded", () => {
  const launcher = document.createElement("div");
  launcher.id = "bmc-wbtn";
  launcher.textContent = "☕";
  Object.assign(launcher.style, { display: "flex", alignItems: "center", justifyContent: "center", width: "64px", height: "64px", borderRadius: "32px", position: "fixed", background: script.dataset.color, cursor: "pointer", fontSize: "28px" });
  const overlay = document.createElement("div");
  Object.assign(overlay.style, { position: "fixed", inset: "0", width: "0", height: "0" });
  const close = document.createElement("div");
  close.id = "bmc-close-btn";
  close.textContent = "×";
  Object.assign(close.style, { position: "fixed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", borderRadius: "100px", visibility: "hidden", zIndex: "9999999" });
  const frame = document.createElement("iframe");
  frame.id = "bmc-iframe";
  Object.assign(frame.style, { position: "fixed", opacity: "0", height: "0", border: "0", borderRadius: "10px", background: "white", transform: "scale(0)" });
  overlay.append(close, frame);
  document.body.append(overlay, launcher);
  launcher.onclick = () => {
    if (!frame.src) frame.src = `https://www.buymeacoffee.com/widget/page/${script.dataset.id}?description=${encodeURIComponent(script.dataset.description)}`;
    Object.assign(overlay.style, { width: "100%", height: "100%" });
    Object.assign(frame.style, { opacity: "1", transform: "scale(1)", height: "680px" });
    close.style.visibility = "visible";
  };
  close.onclick = () => {};
  overlay.onclick = () => {
    Object.assign(overlay.style, { width: "0", height: "0" });
    Object.assign(frame.style, { opacity: "0", transform: "scale(0)", height: "0" });
    close.style.visibility = "hidden";
  };
});
