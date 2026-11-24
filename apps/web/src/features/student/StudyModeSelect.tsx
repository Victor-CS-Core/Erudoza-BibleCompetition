import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { trainingApi } from "../../api/training";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../../components/AppIcon";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import {
  academyModeRules,
  academyUnavailableCopy,
  canStartAcademyTrack,
  resolveStudyFormat,
  STUDY_MODE_CARDS,
  studyModeCardDescription,
  type StudyFormat,
  type StudyModeCard,
} from "./academyTracks";
import "./student.css";

function modeHref(seasonId: string | undefined, format: StudyFormat, card: StudyModeCard) {
  const params = new URLSearchParams();
  params.set("mode", card.mode);
  if (seasonId) params.set("seasonId", seasonId);
  params.set("format", format);
  return `/student/study?${params}`;
}

const CARD_ICONS: Record<StudyModeCard["track"], "book" | "review" | "flag"> = {
  learner: "book",
  review: "review",
  rehearsal: "flag",
};

export function StudyModeSelect() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const seasonId = params.get("seasonId") || undefined;
  const formatParam = params.get("format");
  const progress = useQuery({
    queryKey: ["progress", seasonId, me?.organizationId, me?.userId],
    queryFn: () => api.progress(seasonId),
  });
  const today = useQuery({
    queryKey: ["training-today", seasonId, me?.organizationId, me?.userId],
    queryFn: () => trainingApi.today(seasonId),
    retry: false,
    staleTime: 60_000,
  });

  const format = resolveStudyFormat(formatParam, progress.data?.pbeEnabled);
  const isSeasonDefault = progress.data?.pbeEnabled && formatParam !== "Memory";

  const chooseFormat = (next: StudyFormat) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("format", next);
    setParams(nextParams, { replace: true });
  };

  const quest = today.data?.quests?.find((item) => !item.completed);
  // xpForNext is the XP REMAINING to the next level, so the level's span is
  // into + remaining. Dividing by xpForNext alone overstated progress (39%
  // instead of 28% at 612 XP) and hit 100% halfway through a level.
  const xpPct =
    today.data?.xp && today.data.xp.xpForNext > 0
      ? Math.min(100, Math.round((today.data.xp.xpIntoLevel / (today.data.xp.xpIntoLevel + today.data.xp.xpForNext)) * 100))
      : 100;
  const gameLayer = today.data?.streak && today.data?.xp ? today.data : null;

  const libraryHref = (() => {
    const libraryParams = new URLSearchParams();
    libraryParams.set("mode", "Library");
    if (seasonId) libraryParams.set("seasonId", seasonId);
    libraryParams.set("format", format);
    return `/student/study?${libraryParams}`;
  })();

  if (progress.isPending) return <LoadingState label="Loading your training…" />;
  if (progress.isError)
    return (
      <Notice tone="danger" title="Training could not load">
        Your training plan could not be loaded. <Button onClick={() => void progress.refetch()}>Try again</Button>
      </Notice>
    );

  return (
    <div className="er-study-select space-y-5">
      <PageHeader
        title="Choose your training"
        description="Three ways to train: learn a passage, keep it fresh, or rehearse like the real competition."
      />

      {gameLayer && (
        <div className="study-ticker" aria-label="Your training progress">
          <div className="study-streak" data-testid="study-ticker-streak">
            <AppIcon name="flame" />
            <div>
              <strong>{gameLayer.streak.current}</strong>
              <span>day streak</span>
            </div>
          </div>
          <div className="study-xp" data-testid="study-ticker-xp">
            <div className="study-xp-row">
              <strong>
                Level {gameLayer.xp.level} · {gameLayer.xp.levelName}
              </strong>
              <span>{gameLayer.xp.total} XP</span>
            </div>
            <div className="study-xp-bar" role="progressbar" aria-valuenow={xpPct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to the next level">
              <span style={{ width: `${xpPct}%` }} />
            </div>
            {quest && (
              <p className="study-quest">
                Quest: {quest.title} · +{quest.xpReward ?? 25} XP
              </p>
            )}
          </div>
        </div>
      )}

      <section aria-label="Training format" className="study-format">
        <div>
          <p className="study-format-label">Training format</p>
          <p className="study-format-hint">Your season sets the default — switch anytime.</p>
        </div>
        <div className="study-format-segment" role="group" aria-label="Training format">
          <button
            type="button"
            aria-pressed={format === "Pbe"}
            className={format === "Pbe" ? "is-active" : undefined}
            onClick={() => chooseFormat("Pbe")}
          >
            PBE
            {isSeasonDefault && <span className="study-default-mark">Season default</span>}
          </button>
          <button
            type="button"
            aria-pressed={format === "Memory"}
            className={format === "Memory" ? "is-active" : undefined}
            onClick={() => chooseFormat("Memory")}
          >
            Memory
          </button>
        </div>
      </section>

      <div className="study-mode-cards">
        {STUDY_MODE_CARDS.map((card) => {
          // The Review card follows the selected format end to end: its
          // start opens that format's review, its gate checks that format's
          // due set, and its "N due" badge counts that same population —
          // Memory counts due mastery passages (Progress.reviewDueCount),
          // PBE counts due question targets (today's pbeReviewDueCount).
          // A count must never describe the other system. (Count-driven
          // entries elsewhere — HQ missions, the picker — stay pinned to
          // Memory because their counts are the Memory set.)
          const isReview = card.track === "review";
          const pbeReviewDue = format === "Pbe" && today.data?.format === "Pbe" ? today.data.pbeReviewDueCount : undefined;
          const canStart = isReview && format === "Pbe"
            ? progress.data?.seasonStatus === "Active" && (pbeReviewDue ?? 0) > 0
            : canStartAcademyTrack(card.track, progress.data);
          const blockedReason = !canStart
            ? isReview && format === "Pbe"
              ? progress.data?.seasonStatus !== "Active"
                ? "Review opens once your season starts."
                : "No PBE questions are due for review right now."
              : academyUnavailableCopy(card.track, progress.data)
            : null;
          const cardFormat: StudyFormat = format;
          const rules = academyModeRules(card.track, cardFormat);
          const reviewDueCount = isReview ? (format === "Pbe" ? pbeReviewDue : (progress.data?.reviewDueCount ?? 0)) : null;
          const badge =
            card.track === "review"
              ? reviewDueCount === undefined || reviewDueCount === null
                ? null
                : reviewDueCount > 0
                  ? `${reviewDueCount} due`
                  : "All caught up"
              : card.track === "learner"
                ? "Aids on"
                : "Challenge mode";
          return (
            <Panel key={card.track} className={`study-mode-card study-mode-card--${card.track}`}>
              <div className="study-mode-card-head">
                <span className="study-mode-card-icon">
                  <AppIcon name={CARD_ICONS[card.track]} />
                </span>
                <div>
                  <h2>{card.title}</h2>
                  {badge && <Badge>{badge}</Badge>}
                </div>
              </div>
              <p className="study-mode-card-desc">{studyModeCardDescription(card, format)}</p>
              <ul className="study-rules" aria-label={`${card.title} rules`}>
                {rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              {canStart ? (
                <LinkButton to={modeHref(seasonId, cardFormat, card)} data-testid={card.ctaTestId}>
                  {card.ctaLabel}
                </LinkButton>
              ) : (
                <Button disabled data-testid={card.ctaTestId} title={blockedReason ?? undefined} aria-describedby={blockedReason ? `study-blocked-${card.track}` : undefined}>
                  {card.ctaLabel}
                </Button>
              )}
              {blockedReason && (
                <p className="study-blocked-reason" id={`study-blocked-${card.track}`}>
                  {blockedReason}
                </p>
              )}
            </Panel>
          );
        })}
      </div>

      <p className="study-library-link">
        <Link to={libraryHref}>Browse the Scripture library</Link>
        <span>Just read and explore — no session, no score.</span>
      </p>

      <p className="study-why-more">
        Not sure which to pick? <Link to="/help#wiki-study-and-practice">See how each mode works in the Help Center</Link>
      </p>
    </div>
  );
}
