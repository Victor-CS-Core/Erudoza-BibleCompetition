type Props = {
  label: string;
  active?: boolean;
  onClick?: () => void;
  testId?: string;
};

export function ChapterTab({ label, active = false, onClick, testId }: Props) {
  return (
    <button
      type="button"
      data-testid={testId}
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
