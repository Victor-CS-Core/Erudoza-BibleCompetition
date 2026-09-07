import { FieldGuideCover } from "../../components/material/FieldGuideCover";

export function academyCoachChapterLine(input: {
  organizationName?: string | null;
  seasonName?: string | null;
  seasonStatus?: string | null;
}): string {
  const seasonName = input.seasonName?.trim() ?? "";
  const seasonStatus = input.seasonStatus?.trim() ?? "";
  if (seasonName && seasonStatus) {
    return `${seasonName} · ${seasonStatus}`;
  }
  return input.organizationName?.trim() ?? "";
}

export function CoachFieldGuideCover(input: {
  organizationName?: string | null;
  seasonName?: string | null;
  seasonStatus?: string | null;
}) {
  const chapter = academyCoachChapterLine(input);
  return (
    <FieldGuideCover>
      {chapter ? (
        <p className="mt-2 text-[var(--er-muted-ink)]" data-testid="academy-chapter-line">
          {chapter}
        </p>
      ) : null}
    </FieldGuideCover>
  );
}
