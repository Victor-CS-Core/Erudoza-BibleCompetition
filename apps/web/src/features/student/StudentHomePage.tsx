import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { ChapterTab } from "../../components/material/ChapterTab";
import { DeckStack } from "../../components/material/DeckStack";
import { FieldGuideCover } from "../../components/material/FieldGuideCover";
import { PaperSurface } from "../../components/material/PaperSurface";
import { Stamp } from "../../components/material/Stamp";
import {
  ACADEMY_TRACKS,
  academyUnavailableCopy,
  canStartAcademyTrack,
  type AcademyTrackId,
  visibleAcademyTracks,
} from "./academyTracks";

export function StudentHomePage() {
  const progress = useQuery({ queryKey: ["progress"], queryFn: () => api.progress() });
  const data = progress.data;
  const assignment = data?.assignments[0];
  const tracks = visibleAcademyTracks(data);
  const [activeTrack, setActiveTrack] = useState<AcademyTrackId>("learner");
  const selected = tracks.includes(activeTrack) ? activeTrack : "learner";
  const track = ACADEMY_TRACKS[selected];

  return (
    <div className="space-y-5">
      <FieldGuideCover stamp={(data?.reviewDueCount ?? 0) > 0 ? <Stamp label="DUE" tone="due" /> : null}>
        <p className="mt-2 text-[var(--er-muted-ink)]" data-testid="current-season">
          {data?.seasonName || "Your study section has not been assigned yet."}
        </p>
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Academy tracks">
          {tracks.map((id) => (
            <ChapterTab
              key={id}
              label={ACADEMY_TRACKS[id].label}
              active={selected === id}
              testId={`academy-track-${id}`}
              onClick={() => setActiveTrack(id)}
            />
          ))}
        </div>
        <p className="mt-4 text-[var(--er-graphite)]">{track.description}</p>
        <div className="mt-5">
          {canStartAcademyTrack(selected, data) ? (
            <Link
              to={track.href}
              data-testid={track.ctaTestId}
              className="inline-flex items-center rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-5 text-[var(--er-card)]"
            >
              {track.ctaLabel}
            </Link>
          ) : progress.isSuccess ? (
            <p className="text-[var(--er-graphite)]" data-testid="academy-track-unavailable">
              {academyUnavailableCopy(selected)}
            </p>
          ) : null}
        </div>
      </FieldGuideCover>
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
