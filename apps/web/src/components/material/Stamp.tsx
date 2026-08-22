type Tone = "new" | "due" | "review" | "mastered" | "simulation";

const tones: Record<Tone, string> = {
  new: "text-[var(--er-action-blue)]",
  due: "text-[var(--er-stamp-red)]",
  review: "text-[var(--er-kraft-dark)]",
  mastered: "text-[var(--er-success-ink)]",
  simulation: "text-[var(--er-card)]",
};

export function Stamp({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={`er-stamp ${tones[tone]}`} aria-label={label}>
      {label}
    </span>
  );
}
