type Props = {
  compact?: boolean;
  inverted?: boolean;
};

export function ErudozaWordmark({ compact = false, inverted = false }: Props) {
  const ink = inverted ? "text-[var(--er-card)]" : "text-[var(--er-ink-navy)]";
  const muted = inverted ? "text-[color-mix(in_srgb,var(--er-card)_72%,transparent)]" : "text-[var(--er-muted-ink)]";

  return (
    <div className={`flex items-center gap-3 ${ink}`} data-testid="erudoza-wordmark">
      <svg aria-hidden="true" width="36" height="36" viewBox="0 0 36 36" className="shrink-0">
        <rect x="3" y="8" width="20" height="22" rx="3" fill="currentColor" opacity="0.12" />
        <path d="M7 10h14v18H10a3 3 0 0 1-3-3V10z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M23 8l8 4v16l-8-4V8z" fill="currentColor" opacity="0.28" />
        <path d="M23 8v16l8 4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      <div>
        <p className="font-semibold tracking-tight text-xl leading-none">Erudoza</p>
        {compact ? null : <p className={`mt-1 text-xs ${muted}`}>Study. Master. Compete.</p>}
      </div>
    </div>
  );
}
