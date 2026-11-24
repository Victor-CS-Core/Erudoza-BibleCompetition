import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { PassageJourneyPage } from "../../api/trainingTypes";
import { trainingApi } from "../../api/training";
import { useAuth } from "../../auth/AuthContext";
import { AppIcon } from "../../components/AppIcon";
import { Badge, Button, HelpTip, LinkButton, LoadingState, Notice, Panel, ProgressMeter } from "../../components/ui";
import { trainingLink } from "./trainingAssets";
import { rankWorthAnotherLook, type MasteryItem } from "./worthAnotherLook";

type JourneyChapter = PassageJourneyPage["chapters"][number];
type JourneyPassage = JourneyChapter["passages"][number];

/** Scored mastery versions: v2 skill-evidence and the current v3
 * partial-credit. Anything else (v1, unknown) predates skill scoring. */
export const isScoredVersion = (version?: string | null) => version === "v2-skill-evidence" || version === "v3-partial-credit";

const JOURNEY_SKILLS = [
  ["Wording", "exactWording"],
  ["Reference", "reference"],
  ["Sequence", "sequence"],
  ["Recognition", "recognition"],
  ["Factual recall", "factualRecall"],
] as const;

function passageLevelTone(level: string): "success" | "warning" | "neutral" {
  if (level === "Mastered" || level === "Strong") return "success";
  if (level === "Review") return "warning";
  return "neutral";
}

/** Book display name from a passage citation ("Daniel 1:1" → "Daniel"); journey chapters carry only book codes. */
function bookNameOf(chapter: JourneyChapter): string {
  const title = chapter.passages[0]?.title ?? "";
  const name = title.replace(/\s+\d+:\d+\s*$/, "").trim();
  return name || chapter.bookKey;
}

function verseOf(passage: JourneyPassage): number | null {
  const match = /:(\d+)\s*$/.exec(passage.title);
  return match ? Number(match[1]) : null;
}

type TileState = { className: string; label: string; mastered: boolean; sliver: number | null };

function tileState(passage: JourneyPassage, masteryItem?: MasteryItem): TileState {
  if (passage.level === "Mastered") return { className: "is-mastered", label: "mastered", mastered: true, sliver: null };
  if (passage.level === "Strong") return { className: "is-strong", label: "strong", mastered: false, sliver: null };
  if (passage.level === "Unseen" || passage.level === "Unknown") return { className: "is-unseen", label: "not started", mastered: false, sliver: null };
  // In progress: the sliver is the passage's v2 skill average, or the mastery
  // wording score for legacy-scored passages.
  const score = isScoredVersion(passage.algorithmVersion)
    ? Math.round(JOURNEY_SKILLS.reduce((sum, [, key]) => sum + passage.skills[key], 0) / JOURNEY_SKILLS.length)
    : masteryItem?.exactWordingScore ?? null;
  return { className: "is-progress", label: score !== null ? `in progress, ${score} percent` : "in progress", mastered: false, sliver: score };
}

/**
 * The detailed per-passage view that used to be the journey list's cards:
 * chapter totals, per-passage skill breakdowns, due dates and legacy-scoring
 * notes. It lives inside the picker's collapsed details, scoped to the
 * chapter the student is currently looking at.
 */
function PassageDetailCard({ passage, seasonId }: { passage: JourneyPassage; seasonId: string }) {
  const isV2 = isScoredVersion(passage.algorithmVersion);
  const unseen = (passage.level === "Unseen" || passage.level === "Unknown") && !isV2;
  const average = isV2 ? Math.round(JOURNEY_SKILLS.reduce((sum, [, key]) => sum + passage.skills[key], 0) / JOURNEY_SKILLS.length) : null;
  const tone = passageLevelTone(passage.level);
  return <li id={`passage-${passage.knowledgeUnitId}`} className={`journey-passage-card journey-tone-${tone}${passage.dueAtUtc ? " is-due" : ""}`}>
    <div className="journey-passage-head"><strong>{passage.title}</strong><Badge tone={tone}>{passage.level}</Badge></div>
    {average !== null
      ? <ProgressMeter label={`${passage.title} average skill score`} value={average} max={100} />
      : <p className="journey-passage-hint">{unseen ? "Not practiced yet." : "No scores yet for this one."}</p>}
    {isV2 && <details className="journey-skill-details"><summary>Skill breakdown</summary>
      <div className="training-skill-list">{JOURNEY_SKILLS.map(([label, key]) => <div key={key}><span>{label}</span><ProgressMeter label={`${passage.title}: ${label}`} value={passage.skills[key]} max={100} /></div>)}</div>
    </details>}
    {passage.dueAtUtc && <p className="journey-due">Review due <time dateTime={passage.dueAtUtc}>{new Date(passage.dueAtUtc).toLocaleDateString()}</time></p>}
    <Link className="journey-practice-link" to={trainingLink(`/student/study?mode=${passage.dueAtUtc ? "Review&format=Memory" : "Practice"}&knowledgeUnitId=${encodeURIComponent(passage.knowledgeUnitId)}`, seasonId)}>{passage.dueAtUtc ? "Review" : "Practice"}<AppIcon name="arrow" /></Link>
  </li>;
}

function ChapterDetails({ chapter, seasonId }: { chapter: JourneyChapter; seasonId: string }) {
  const dueCount = chapter.passages.filter(passage => passage.dueAtUtc).length;
  const hasLegacy = chapter.passages.some(passage => !isScoredVersion(passage.algorithmVersion) && passage.algorithmVersion !== "unknown");
  return <>
    <p className="passage-picker-details-scope"><Badge>{chapter.scopeLabel}</Badge></p>
    <div className="journey-chapter-stats">
      <div><strong>{chapter.seenCount}<span>/{chapter.eligibleCount}</span></strong><span>practiced</span></div>
      <div><strong>{chapter.strongCount}</strong><span>strong / mastered</span></div>
      {dueCount > 0 && <div className="is-due"><strong>{dueCount}</strong><span>due for review</span></div>}
    </div>
    <ProgressMeter label={`${chapter.bookKey} ${chapter.chapter} assigned passages practiced`} value={chapter.seenCount} max={chapter.eligibleCount} />
    {chapter.eligibleCount === 0 && <p>No eligible assigned passages in this chapter.</p>}
    {hasLegacy && <Notice className="journey-legacy-note">Earlier scoring — detailed skill scores aren't available for these passages.</Notice>}
    <ul className="journey-passage-grid">
      {chapter.passages.map(passage => <PassageDetailCard key={passage.knowledgeUnitId} passage={passage} seasonId={seasonId} />)}
    </ul>
  </>;
}

type BookGroup = { key: string; name: string; chapters: JourneyChapter[]; seen: number; eligible: number };

/**
 * Training HQ's single passage surface ("Up next + two-step tiles"), replacing
 * the journey card list, the passage browser panel and "Worth another look".
 * Book chips → chapter strip → verse tiles; tapping a tile starts a session
 * scoped to that verse (Practice, or Review when the verse is due) — the
 * server resolves the knowledgeUnitId into the session's card scope.
 */
export function PassagePicker({ seasonId, mastery, difficulty }: { seasonId: string; mastery?: MasteryItem[]; difficulty?: string }) {
  const { me } = useAuth();
  const journey = useInfiniteQuery({ queryKey: ["training-journey", seasonId, me?.organizationId, me?.userId], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => trainingApi.journey(seasonId, pageParam), getNextPageParam: page => page.after ?? undefined });
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = journey;
  const loadedPages = journey.data?.pages.length ?? 0;
  useEffect(() => {
    // The picker renders every assigned book and chapter at once, so the
    // remaining journey pages load automatically — no "Load more" button.
    // Auto-loading stops if a page fails; the error notice below offers retry.
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, loadedPages]);

  const books = useMemo<BookGroup[]>(() => {
    const chapters = (journey.data?.pages.flatMap(page => page.chapters) ?? []).filter(chapter => chapter.eligibleCount > 0);
    const byBook = new Map<string, BookGroup>();
    for (const chapter of chapters) {
      const group = byBook.get(chapter.bookKey) ?? { key: chapter.bookKey, name: bookNameOf(chapter), chapters: [], seen: 0, eligible: 0 };
      // A chapter can straddle a journey page boundary: the server emits it
      // once per page with the FULL chapter counts each time. Merge the
      // fragments into one chapter (passages concatenated) and count the
      // chapter once — otherwise it lists twice, its totals double, and the
      // second fragment's verses have no tile.
      const existing = group.chapters.find(candidate => candidate.chapter === chapter.chapter);
      if (existing) {
        existing.passages = [...existing.passages, ...chapter.passages];
      } else {
        group.chapters.push(chapter);
        group.seen += chapter.seenCount;
        group.eligible += chapter.eligibleCount;
      }
      byBook.set(chapter.bookKey, group);
    }
    return [...byBook.values()];
  }, [journey.data]);

  // Up next reuses the one "worth another look" ranking: due review first,
  // else the weakest unmastered verse.
  const upNext = useMemo(() => rankWorthAnotherLook(mastery, Date.now(), 1)[0], [mastery]);
  const masteryById = useMemo(() => new Map((mastery ?? []).map(item => [item.knowledgeUnitId, item])), [mastery]);

  const [picked, setPicked] = useState<{ bookKey: string; chapter: number } | null>(null);
  const defaultPick = useMemo(() => {
    if (upNext) {
      for (const book of books) {
        const chapter = book.chapters.find(candidate => candidate.passages.some(passage => passage.knowledgeUnitId === upNext.item.knowledgeUnitId));
        if (chapter) return { bookKey: book.key, chapter: chapter.chapter };
      }
    }
    const first = books[0];
    return first?.chapters[0] ? { bookKey: first.key, chapter: first.chapters[0].chapter } : null;
  }, [books, upNext]);
  const selection = picked ?? defaultPick;
  const book = books.find(candidate => candidate.key === selection?.bookKey) ?? books[0];
  const chapter = book?.chapters.find(candidate => candidate.chapter === selection?.chapter) ?? book?.chapters[0];
  const pickBook = (bookKey: string) => {
    const target = books.find(candidate => candidate.key === bookKey);
    if (!target?.chapters[0]) return;
    // Land on the chapter that most needs attention in that book: the Up-next
    // chapter, else one holding a due verse, else the first unfinished one.
    const upChapter = upNext ? target.chapters.find(candidate => candidate.passages.some(passage => passage.knowledgeUnitId === upNext.item.knowledgeUnitId)) : undefined;
    const dueChapter = target.chapters.find(candidate => candidate.passages.some(passage => passage.dueAtUtc));
    const openChapter = target.chapters.find(candidate => candidate.seenCount < candidate.eligibleCount);
    setPicked({ bookKey, chapter: (upChapter ?? dueChapter ?? openChapter ?? target.chapters[0]).chapter });
  };

  const header = <div className="training-panel-title"><div><h2>Choose a passage to practice</h2><p>Pick a verse — practice starts right away.</p></div>
    <HelpTip label="About passage scoring">
      Coach-set difficulty: {difficulty ?? "Not available"}. Foundation wording evidence stops at 40, Standard at 70. Memory warmups stop at 70 within those ceilings; Verse Builder records sequence practice. Advanced mastery challenges require coach-set Advanced difficulty. Your difficulty does not change automatically. Honors also require their listed passage, skill and delayed-recall evidence. PBE questions use their authored answer requirements at every Memory difficulty.
    </HelpTip></div>;

  if (journey.isPending) return <Panel className="passage-picker" data-testid="passage-picker">{header}<LoadingState label="Loading passages…" /></Panel>;
  if (journey.isError && !journey.data) return <Panel className="passage-picker" data-testid="passage-picker">{header}<Notice tone="danger">Passages could not load. <Button variant="secondary" onClick={() => void journey.refetch()}>Retry passages</Button></Notice></Panel>;
  if (!books.length || !book || !chapter) return <Panel className="passage-picker" data-testid="passage-picker">{header}<h3>No eligible passages yet</h3><p>Your coach will add your study assignment here.</p></Panel>;

  return <Panel className="passage-picker" data-testid="passage-picker">
    {header}
    {upNext && <div className="passage-picker-upnext" data-testid="passage-picker-upnext">
      <div className="passage-picker-upnext-copy">
        <small>Up next for you</small>
        <strong>{upNext.item.title}</strong>
        <span>{upNext.due ? "Review due" : "Needs practice"} · Last score {upNext.item.exactWordingScore}</span>
      </div>
      <LinkButton variant="inverse" to={trainingLink(`/student/study?mode=${upNext.due ? "Review&format=Memory" : "Practice"}&knowledgeUnitId=${encodeURIComponent(upNext.item.knowledgeUnitId)}`, seasonId)}>{upNext.due ? "Review this passage" : "Practice this passage"}<AppIcon name="arrow" /></LinkButton>
    </div>}
    {books.length > 1 && <div className="passage-picker-books" role="group" aria-label="Assigned books">
      {books.map(candidate => <button key={candidate.key} type="button" className={`passage-picker-book${candidate.key === book.key ? " is-active" : ""}`} aria-pressed={candidate.key === book.key} aria-label={`${candidate.name}: ${candidate.seen} of ${candidate.eligible} passages practiced`} onClick={() => pickBook(candidate.key)}>{candidate.name}<span>{candidate.seen} of {candidate.eligible}</span></button>)}
    </div>}
    <div className="passage-picker-chapters" role="group" aria-label={`Chapters in ${book.name}`}>
      {book.chapters.map(candidate => {
        const hasDue = candidate.passages.some(passage => passage.dueAtUtc);
        const percent = candidate.eligibleCount ? Math.round((candidate.seenCount / candidate.eligibleCount) * 100) : 0;
        return <button key={candidate.chapter} type="button" className={`passage-picker-chapter${candidate.chapter === chapter.chapter ? " is-active" : ""}`} aria-pressed={candidate.chapter === chapter.chapter} aria-label={`Chapter ${candidate.chapter}: ${candidate.seenCount} of ${candidate.eligibleCount} practiced${hasDue ? ", has a review due" : ""}`} onClick={() => setPicked({ bookKey: book.key, chapter: candidate.chapter })}>
          <span className="passage-picker-chapter-number">{candidate.chapter}</span>
          {hasDue && <span className="passage-picker-due-dot" aria-hidden="true" />}
          <span className="passage-picker-chapter-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
        </button>;
      })}
    </div>
    <ul className="passage-picker-grid" aria-label={`Verses in ${book.name} ${chapter.chapter}`}>
      {chapter.passages.map(passage => {
        const due = !!passage.dueAtUtc;
        const state = tileState(passage, masteryById.get(passage.knowledgeUnitId));
        const verse = verseOf(passage);
        return <li key={passage.knowledgeUnitId}><Link className={`passage-picker-tile ${state.className}${due ? " is-due" : ""}`} aria-label={`${passage.title}: ${state.label}${due ? ", review due" : ""}`} to={trainingLink(`/student/study?mode=${due ? "Review&format=Memory" : "Practice"}&knowledgeUnitId=${encodeURIComponent(passage.knowledgeUnitId)}`, seasonId)}>
          <span className="passage-picker-verse">{verse ?? "•"}</span>
          {state.mastered && <span className="passage-picker-check"><AppIcon name="check" /></span>}
          {due && <span className="passage-picker-due-dot" aria-hidden="true" />}
          {state.sliver !== null && <span className="passage-picker-sliver" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, state.sliver))}%` }} /></span>}
        </Link></li>;
      })}
    </ul>
    <p className="passage-picker-legend">✓ Mastered · ● Due for review · the bar shows how strong · plain means not started</p>
    {isFetchingNextPage && <p className="passage-picker-loading">Loading more passages…</p>}
    {isFetchNextPageError && <Notice tone="danger">The next passages could not load. <Button variant="secondary" onClick={() => void fetchNextPage()}>Load more passages</Button></Notice>}
    <details className="passage-picker-details">
      <summary>Passage details for {book.name} {chapter.chapter}</summary>
      <ChapterDetails chapter={chapter} seasonId={seasonId} />
    </details>
  </Panel>;
}
