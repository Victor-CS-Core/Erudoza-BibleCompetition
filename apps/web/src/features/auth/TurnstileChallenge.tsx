import { useEffect, useRef, useState } from "react";
import { Button, Notice } from "../../components/ui";

type WidgetOptions = {
  sitekey: string; action: string; size: "flexible"; theme: "light"; "response-field": false;
  callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void;
};
type Turnstile = { render: (element: HTMLElement, options: WidgetOptions) => string; reset: (id: string) => void; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }
let scriptPromise: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const fail = () => { window.clearTimeout(timeout); script.remove(); scriptPromise = undefined; reject(new Error("Security check unavailable.")); };
    const timeout = window.setTimeout(fail, 15_000);
    script.onerror = fail;
    script.onload = () => { window.clearTimeout(timeout); if (window.turnstile) resolve(window.turnstile); else fail(); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileChallenge({ siteKey, action, resetKey, onToken }: {
  siteKey: string; action: "coach_signup" | "coach_recovery" | "coach_invitation"; resetKey: number; onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    onToken(null);
    setError("");
    void loadTurnstile().then(api => {
      if (!active || !container.current) return;
      const id = api.render(container.current, {
        sitekey: siteKey, action, size: "flexible", theme: "light", "response-field": false,
        callback: token => { if (active) { setError(""); onToken(token); } },
        "expired-callback": () => { if (active) { onToken(null); setError("Security check expired. Complete it again before sending a code."); } },
        "error-callback": () => { if (active) { onToken(null); setError("Security check could not finish. Check your connection and try again."); } },
      });
      widget.current = { api, id };
    }).catch(() => { if (active) setError("Security check is unavailable. Check your connection and try again."); });
    return () => { active = false; if (widget.current) { widget.current.api.reset(widget.current.id); widget.current.api.remove(widget.current.id); widget.current = null; } };
  }, [siteKey, action, attempt, onToken]);
  useEffect(() => {
    if (widget.current) { widget.current.api.reset(widget.current.id); onToken(null); setError(""); }
  }, [resetKey, onToken]);
  return <div className="coach-security-check">
    <div ref={container} aria-label="Security check" />
    {error && <><Notice tone="danger">{error}</Notice><Button variant="secondary" onClick={() => { onToken(null); setAttempt(value => value + 1); }}>Retry security check</Button></>}
  </div>;
}
