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
