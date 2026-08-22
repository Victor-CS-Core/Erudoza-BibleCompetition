type Props = {
  label: string;
  active?: boolean;
  onClick?: () => void;
};

export function ChapterTab({ label, active = false, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t-lg border px-4 text-sm ${
        active
          ? "border-[var(--er-kraft-dark)] bg-[var(--er-parchment)] font-semibold"
          : "border-transparent bg-transparent text-[var(--er-muted-ink)]"
      }`}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </button>
  );
}
