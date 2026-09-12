import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { ExternalLinkButton } from "../../components/ui";
import { COFFEE_WIDGET_SCRIPT_URL, parseCoffeeProfile } from "./coffeeConfig";
import { attachCoffeeWidget } from "./coffeeWidgetAdapter";
import "./coffee-widget.css";

export function CoffeeWidget({ enabled = true, accountKey = "public" }: { enabled?: boolean; accountKey?: string }) {
  const location = useLocation();
  const [linkSlot, setLinkSlot] = useState<HTMLElement | null>(null);
  const profile = parseCoffeeProfile(import.meta.env.VITE_BUY_ME_A_COFFEE_URL);
  const creatorId = profile?.creatorId;
  useEffect(() => {
    const script = document.querySelector<HTMLScriptElement>('script[data-name="BMC-Widget"]');
    if (!enabled || !creatorId || script?.dataset.id !== creatorId || script.src !== COFFEE_WIDGET_SCRIPT_URL) return;
    return attachCoffeeWidget(setLinkSlot);
  }, [enabled, accountKey, location.key, creatorId]);
  if (!enabled || !profile) return null;
  return <>
    <ExternalLinkButton className="coffee-fallback" href={profile.url} target="_blank" rel="noopener noreferrer" aria-label="Buy me a coffee (opens in a new tab)">Buy me a coffee ↗</ExternalLinkButton>
    {linkSlot && createPortal(<ExternalLinkButton href={profile.url} target="_blank" rel="noopener noreferrer" aria-label="Open support page (opens in a new tab)">Open support page ↗</ExternalLinkButton>, linkSlot)}
  </>;
}
