import { Badge } from "../../components/ui";
export function SeasonStatusBadge({ status }: { status: string }) {
  const tone = badgeTone(status);
  return (
    <Badge tone={tone === "active" ? "success" : tone === "ready" ? "info" : "neutral"} data-testid="season-status-badge">
      <StatusMark tone={tone} />
      {status === "ContentReady" ? "Passages ready" : status === "AssignmentsReady" ? "Plans ready" : status}
    </Badge>
  );
}

function badgeTone(status: string) {
  if (status === "Active") {
    return "active";
  }
  if (status === "Draft") {
    return "draft";
  }
  if (status === "Completed" || status === "Archived") {
    return "closed";
  }
  return "ready";
}

function StatusMark({ tone }: { tone: ReturnType<typeof badgeTone> }) {
  if (tone === "active") {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path fill="currentColor" d="M6.4 11.2 3.2 8l1.1-1.1 2.1 2.1 5.3-5.3 1.1 1.2z" />
      </svg>
    );
  }
  if (tone === "draft") {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11.4 2.1a1.4 1.4 0 0 1 2 2l-.4.4-2 2-2-2 .4-.4ZM8.6 5.9l2 2-6.2 6.2H2.4v-2.4z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
