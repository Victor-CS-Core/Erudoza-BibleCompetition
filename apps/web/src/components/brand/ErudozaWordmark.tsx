import { PatchArtwork } from "../ui/PatchArtwork";

type Props = {
  compact?: boolean;
  inverted?: boolean;
};

export function ErudozaWordmark({ compact = false, inverted = false }: Props) {
  const ink = inverted ? "text-[var(--er-card)]" : "text-[var(--er-ink-navy)]";
  const muted = inverted ? "text-[color-mix(in_srgb,var(--er-card)_72%,transparent)]" : "text-[var(--er-muted-ink)]";

  return (
    <div className={`er-wordmark flex items-center gap-3 ${ink}`} data-testid="erudoza-wordmark">
      <PatchArtwork
        src="/brand/erudoza-patch-96.webp"
        srcSet="/brand/erudoza-patch-96.webp 96w, /brand/erudoza-patch-192.webp 192w"
        sizes={compact ? "36px" : "56px"}
        alt=""
        width={compact ? 36 : 48}
        height={compact ? 36 : 48}
        className="er-wordmark-mark"
        loading="eager"
        data-testid="erudoza-mark"
      />
      <div>
        <p className="er-wordmark-name leading-none">Erudoza</p>
        {compact ? null : <p className={`er-wordmark-tagline mt-1 ${muted}`}>Study. Master. Compete.</p>}
      </div>
    </div>
  );
}
