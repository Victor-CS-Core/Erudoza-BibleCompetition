import { useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useLocation } from "react-router-dom";
import { Button, ExternalLinkButton } from "../../components/ui";
import { COFFEE_WIDGET_SCRIPT_URL, parseCoffeeProfile } from "./coffeeConfig";
import { attachCoffeeWidget } from "./coffeeWidgetAdapter";
import { coffeeMinimized, setCoffeeMinimized, useCoffeeMinimized } from "./coffeePreference";
import "./coffee-widget.css";

const focusSupport = (selector: string) => document.querySelector<HTMLElement>(selector)?.focus();

export function CoffeeWidget({ enabled = true, accountKey = "public" }: { enabled?: boolean; accountKey?: string }) {
  const location = useLocation();
  const minimized = useCoffeeMinimized();
  const focusAfterMinimize = useRef(false);
  const [linkSlot, setLinkSlot] = useState<HTMLElement | null>(null);
  const profile = parseCoffeeProfile(import.meta.env.VITE_BUY_ME_A_COFFEE_URL);
  const creatorId = profile?.creatorId;
  useLayoutEffect(() => {
    if (minimized) {
      // Layout setup runs after the sibling footer has entered the DOM.
      if (focusAfterMinimize.current) focusSupport(".coffee-footer-support");
      focusAfterMinimize.current = false;
      return;
    }
    const script = document.querySelector<HTMLScriptElement>('script[data-name="BMC-Widget"]');
    if (!enabled || !creatorId || script?.dataset.id !== creatorId || script.src !== COFFEE_WIDGET_SCRIPT_URL) return;
    const detach = attachCoffeeWidget(setLinkSlot);
    return () => {
      const focusedPopup = document.querySelector("#erudoza-coffee-overlay")?.contains(document.activeElement);
      focusAfterMinimize.current = Boolean(focusedPopup && coffeeMinimized());
      detach();
    };
  }, [enabled, accountKey, location.key, creatorId, minimized]);
  if (!enabled || !profile || minimized) return null;
  return <>
    <div className="coffee-floating">
    <Button variant="ghost" className="coffee-minimize" aria-label="Minimize support widget" title="Minimize support widget" onClick={() => {
      flushSync(() => setCoffeeMinimized(true));
      focusSupport(".coffee-footer-support");
    }}><span aria-hidden="true">−</span></Button>
    <ExternalLinkButton className="coffee-fallback" href={profile.url} target="_blank" rel="noopener noreferrer" aria-label="Buy me a coffee (opens in a new tab)">Buy me a coffee ↗</ExternalLinkButton>
    </div>
    {linkSlot && createPortal(<ExternalLinkButton href={profile.url} target="_blank" rel="noopener noreferrer" aria-label="Open support page (opens in a new tab)">Open support page ↗</ExternalLinkButton>, linkSlot)}
  </>;
}

export function CoffeeFooter({ enabled = true }: { enabled?: boolean }) {
  const minimized = useCoffeeMinimized();
  const profile = parseCoffeeProfile(import.meta.env.VITE_BUY_ME_A_COFFEE_URL);
  if (!enabled || !profile || !minimized) return null;
  return <div className="coffee-footer">
    <ExternalLinkButton variant="ghost" className="coffee-footer-support" href={profile.url} target="_blank" rel="noopener noreferrer" aria-label="Support Erudoza (opens in a new tab)">Support Erudoza ↗</ExternalLinkButton>
    <Button variant="ghost" onClick={() => {
      flushSync(() => setCoffeeMinimized(false));
      focusSupport(".coffee-minimize");
    }}>Show floating support button</Button>
  </div>;
}
