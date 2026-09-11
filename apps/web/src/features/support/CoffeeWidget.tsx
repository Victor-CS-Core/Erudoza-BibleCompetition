import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { COFFEE_WIDGET_SCRIPT_URL, parseCoffeeProfile } from "./coffeeConfig";
import { attachCoffeeWidget } from "./coffeeWidgetAdapter";
import "./coffee-widget.css";

export function CoffeeWidget({ enabled = true, accountKey = "public" }: { enabled?: boolean; accountKey?: string }) {
  const location = useLocation();
  useEffect(() => {
    const profile = parseCoffeeProfile(import.meta.env.VITE_BUY_ME_A_COFFEE_URL);
    const script = document.querySelector<HTMLScriptElement>('script[data-name="BMC-Widget"]');
    if (!enabled || !profile || script?.dataset.id !== profile.creatorId || script.src !== COFFEE_WIDGET_SCRIPT_URL) return;
    return attachCoffeeWidget();
  }, [enabled, accountKey, location.key]);
  return null;
}
