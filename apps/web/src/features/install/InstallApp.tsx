import { createPortal } from "react-dom";
import "./install-app.css";
import { type ComponentProps, useState, useSyncExternalStore } from "react";
import { Button, Notice } from "../../components/ui";
import { TrainingDialog } from "../../components/ui/TrainingDialog";
import { installation, installApp, subscribeInstallation } from "./installation";

export function InstallApp({ variant = "secondary", className }: Pick<ComponentProps<typeof Button>, "variant" | "className"> = {}) {
  const state = useSyncExternalStore(subscribeInstallation, installation);
  const [help, setHelp] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  if (state.installed) return null;
  const requestInstall = async () => {
    if (!state.prompt) { setHelp(true); return; }
    setPending(true);
    try { await installApp(); }
    catch { setFailed(true); setHelp(true); }
    finally { setPending(false); }
  };
  return <>
    <Button variant={variant} className={className} disabled={pending} onClick={() => void requestInstall()}>Install app</Button>
    {createPortal(<TrainingDialog open={help} title="Install Erudoza" onClose={() => { setHelp(false); setFailed(false); }}>
      <div className="install-help"><p>Add Erudoza to your home screen, then tap its icon to open your training. An internet connection is required.</p>
      {failed && <Notice>The browser could not open the installation prompt. You can use its menu instead.</Notice>}
      <section><h3>iPhone or iPad</h3>
      <ol className="install-steps"><li>Open this site in Safari.</li><li>Tap Share (it may be inside the More menu), then Add to Home Screen.</li><li>Turn on Open as Web App if shown, then tap Add.</li></ol></section>
      <section><h3>Android</h3>
      <p>Open your browser’s menu and choose Install app or Add to Home screen. Confirm with Install or Add.</p></section>
      <section><h3>On a computer</h3>
      <p>Use the install option in Chrome or Edge’s address bar or menu. In Safari on Mac, choose File → Add to Dock. If your browser has no install option, bookmark Erudoza or open it in Chrome, Edge, or Safari.</p></section></div>
    </TrainingDialog>, document.body)}
  </>;
}
