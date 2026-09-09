export function SeasonStatusBadge({ status }: { status: string }) {
  const active = status === "Active";
  return (
    <span
      className={`er-season-badge ${active ? "er-season-badge-active" : "er-season-badge-draft"}`}
      data-testid="season-status-badge"
    >
      {active ? <CheckIcon /> : <PencilIcon />}
      {status}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M6.4 11.2 3.2 8l1.1-1.1 2.1 2.1 5.3-5.3 1.1 1.2z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.4 2.1a1.4 1.4 0 0 1 2 2l-.4.4-2 2-2-2 .4-.4ZM8.6 5.9l2 2-6.2 6.2H2.4v-2.4z"
      />
    </svg>
  );
}
