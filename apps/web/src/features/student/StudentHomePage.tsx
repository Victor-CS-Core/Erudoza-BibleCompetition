import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { DeckStack } from "../../components/material/DeckStack";
import { PaperSurface } from "../../components/material/PaperSurface";
import { Stamp } from "../../components/material/Stamp";

export function StudentHomePage() {
  const progress = useQuery({ queryKey: ["progress"], queryFn: () => api.progress() });
  const data = progress.data;
  const assignment = data?.assignments[0];

  return (
    <div className="space-y-5">
      <PaperSurface>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Ready to study?</h1>
            <p className="mt-1 text-[var(--er-muted-ink)]" data-testid="current-season">
              {data?.seasonName || "Your study section has not been assigned yet."}
            </p>
          </div>
          {data?.seasonStatus === "Active" ? <Stamp label="DUE" tone="due" /> : null}
        </div>
        <Link
          to="/student/study"
          data-testid="start-todays-deck"
          className="mt-5 inline-flex items-center rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-5 text-[var(--er-card)]"
        >
          Start today's deck
        </Link>
      </PaperSurface>
      <DeckStack due={data?.reviewDueCount ?? 0} next={data?.assignments.length ?? 0} review={data?.reviewDueCount ?? 0} />
      <PaperSurface data-testid="assignment-packet">
        <h2 className="text-xl font-semibold">Your assignment</h2>
        {assignment ? (
          <p className="mt-2" data-testid="assignment-range">
            {assignment.type}: {assignment.bookKey} {assignment.startChapter}:{assignment.startVerse}–
            {assignment.endChapter}:{assignment.endVerse}
          </p>
        ) : (
          <p className="mt-2 text-[var(--er-graphite)]">Your coach will add it here.</p>
        )}
      </PaperSurface>
    </div>
  );
}
