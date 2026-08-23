type Props = {
  compact?: boolean;
  inverted?: boolean;
};

export function ErudozaWordmark({ compact = false, inverted = false }: Props) {
  const ink = inverted ? "text-[var(--er-card)]" : "text-[var(--er-ink-navy)]";
  const muted = inverted ? "text-[color-mix(in_srgb,var(--er-card)_72%,transparent)]" : "text-[var(--er-muted-ink)]";

  return (
    <div className={`er-wordmark flex items-center gap-3 ${ink}`} data-testid="erudoza-wordmark">
      <img
        src="/brand/erudoza-mark.png"
        alt=""
        width={compact ? 36 : 48}
        height={compact ? 36 : 48}
        className={compact ? "er-wordmark-mark size-9" : "er-wordmark-mark size-12"}
        data-testid="erudoza-mark"
      />
      <div>
        <p className="er-wordmark-name leading-none">Erudoza</p>
        {compact ? null : <p className={`er-wordmark-tagline mt-1 ${muted}`}>Study. Master. Compete.</p>}
      </div>
    </div>
  );
}
