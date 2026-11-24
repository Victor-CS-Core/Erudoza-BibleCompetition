import { useAuth } from "../../auth/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { ChallengeCard, AttemptResult, Session } from "../../api/types";
import type { StartTrainingContext } from "../../api/trainingTypes";
import { Badge, Button, Input, LinkButton, Notice, PageHeader, Panel, Textarea } from "../../components/ui";
import { AppIcon } from "../../components/AppIcon";
import {
  academyActivityName,
  academyModeRules,
  academySessionKicker,
  academyTrackForMode,
  academyUnavailableCopy,
  canStartAcademyTrack,
  readerRestrictedActivity,
  resolveStudyFormat,
  studySessionFraming,
} from "./academyTracks";
import "./student.css";
import { diffWords, type DiffToken } from "./wordDiff";
import { MissingWordsInput } from './MissingWordsInput';
import { VerseBuilderInput } from "./VerseBuilderInput";
import { ScriptureReader } from "./ScriptureReader";
import { RecitationPanel } from "./RecitationPanel";
import { useProfileIdentity } from "../profile/profile";
import { usePhoneLayout } from "../../hooks/useMediaQuery";
import { XpRewardOverlay, useXpReward } from "../../components/game/XpReward";
import type { BoardAvatar } from "../../api/types";
import { PbeStudyPage, reviewReturnDetail } from './PbeStudyPage';
import { StudyModeSelect } from './StudyModeSelect';
import { trainingApi } from '../../api/training';
import { LoadingState } from '../../components/ui';
import { ContentPage } from "../admin/ContentPage";
import type { PbeResumedSession } from '../../api/pbeTypes';
import type { ResumedSession } from '../../api/types';

export type StudyMode = "Practice" | "Review" | "Simulation" | "Library";
export function parseStudyMode(value: string | null): StudyMode {
  return value === "Review" || value === "Simulation" || value === "Library" ? value : "Practice";
}

function DiffTokens({ tokens }: { tokens: DiffToken[] }) {
  return <>{tokens.map((token, index) => <span key={index}>{index > 0 ? " " : ""}<span className={`diff-token diff-${token.status}`}>{token.text}</span></span>)}</>;
}

export function StudyPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const modeParam = params.get("mode");
  const sessionMode = modeParam === "Practice" || modeParam === "Review" || modeParam === "Simulation" ? modeParam : null;
  const libraryMode = modeParam === "Library";
  const sessionId = params.get('sessionId'), seasonId = params.get('seasonId') || undefined;
  const formatParam = params.get('format');
  const saved = useQuery({queryKey:['study-resume-format',sessionId,me?.organizationId,me?.userId],queryFn:()=>api.resumeSession(sessionId!),enabled:!!sessionId,retry:false,staleTime:Infinity,gcTime:0});
  const progress = useQuery({queryKey:['progress',seasonId,me?.organizationId,me?.userId],queryFn:()=>api.progress(seasonId),enabled:!!sessionMode&&!sessionId&&formatParam!=='Memory'});
  const format = resolveStudyFormat(formatParam, progress.data?.pbeEnabled);
  const candidate = !!sessionMode && !sessionId && format === 'Pbe';
  const today = useQuery({queryKey:['training-today',seasonId,me?.organizationId,me?.userId],queryFn:()=>trainingApi.today(seasonId),enabled:!!candidate,retry:false});
  let body: ReactNode;
  if (libraryMode) {
    body = <ContentPage />;
  } else if(sessionId){
    if(saved.isPending)body=<LoadingState label="Loading your saved session…"/>;
    else if(saved.isError)body=<Notice tone="danger">We couldn't reopen your saved session. <Button onClick={()=>void saved.refetch()}>Retry saved session</Button><Button variant="secondary" onClick={()=>setParams(seasonId?{seasonId}:{})}>Start a new session</Button></Notice>;
    else body=saved.data.session.format==='Pbe'?<PbeStudyPage key={sessionId} saved={saved.data as unknown as PbeResumedSession} seasonId={saved.data.session.seasonId} seasonName="Saved PBE session"/>:<MemoryStudyPage initialSaved={saved.data}/>;
  }
  else if(sessionMode){
    if(candidate){
      if(today.isPending)body=<LoadingState label="Loading your PBE assignment…"/>;
      else if(today.isError)body=<Notice tone="danger">Your PBE assignment could not load. <Button onClick={()=>void today.refetch()}>Try again</Button><LinkButton to={`/student/study?seasonId=${encodeURIComponent(seasonId??'')}&format=Memory`}>Choose Memory</LinkButton></Notice>;
      else body=<PbeStudyPage key={`${today.data.seasonId}:${sessionMode}:Pbe`} seasonId={today.data.seasonId??seasonId??''} seasonName={today.data.seasonName} unavailable={today.data.mission.status==='Unavailable'?today.data.mission.explanation??'No eligible published questions are available.':undefined}/>;
    }
    else if(formatParam!=='Memory'&&progress.isPending)body=<LoadingState label="Loading your season…"/>;
    else body=<MemoryStudyPage/>;
  }
  else {
    body = <StudyModeSelect />;
  }
  return <>{body}</>;
}
function MemoryStudyPage({initialSaved}:{initialSaved?:ResumedSession}) {
  const { me } = useAuth();
  const phone = usePhoneLayout();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedSessionId = params.get("sessionId");
  const requested = params.get("mode");
  const mode = requested === "Simulation" || requested === "Review" ? requested : "Practice";
  const track = academyTrackForMode(mode);
  const framing = studySessionFraming(mode);
  const queryClient = useQueryClient();
  const selectedSeasonId = params.get("seasonId") || undefined;
  const missionId = params.get("missionId") || undefined;  const missionRevision = params.get("missionRevision");
  // Passage CTAs (quest rows, picker tiles, passage browser) scope the
  // session to one passage: an assignment range or a single verse. The
  // server resolves and enforces the scope; these params only carry it.
  const passageAssignmentId = params.get("assignmentId") || undefined;
  const passageKnowledgeUnitId = params.get("knowledgeUnitId") || undefined;
  const passageScope = passageAssignmentId ? { assignmentId: passageAssignmentId } : passageKnowledgeUnitId ? { knowledgeUnitId: passageKnowledgeUnitId } : undefined;
  const requestedStep = params.get("step");
  const step = requestedStep === "Review" || requestedStep === "Practice" ? requestedStep : undefined;
  const missionReview = step === "Review" && mode === "Review" && !!missionId;
  const startIntent = useRef<{ key: string; context: StartTrainingContext } | null>(null);
  const progress = useQuery({ queryKey: ["progress", selectedSeasonId, me?.organizationId, me?.userId], queryFn: () => api.progress(selectedSeasonId) });
  const game = useQuery({ queryKey: ["training-today", selectedSeasonId, me?.organizationId, me?.userId], queryFn: () => trainingApi.today(selectedSeasonId), retry: false, staleTime: 60_000 });
  // XP reward animation: fired from the submit success path only (never for
  // restored/replayed results), with the student's real profile identity.
  const xpReward = useXpReward();
  const identity = useProfileIdentity(me?.userId ?? "");
  const rewardAvatar: BoardAvatar | null = identity.data ? {
    avatarKind: identity.data.avatarKind ?? (identity.data.avatarHonorKey ? "honor" : "initials"),
    avatarHonorKey: identity.data.avatarHonorKey,
    character: identity.data.character ?? null,
  } : null;
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [purposeChoice,setPurposeChoice]=useState<{seasonId:string;purpose:"Warmup"|"Advanced"}|null>(null);
  const memoryChallenge=purposeChoice?.seasonId===progress.data?.seasonId?purposeChoice?.purpose:undefined;
  // Warmup/Advanced are Practice purposes. Review and Simulation start
  // directly — a due-review entry must land in the review session itself,
  // not in a Practice-purpose chooser.
  const choosePurpose=mode==="Practice"&&!!progress.data?.pbeEnabled&&!requestedSessionId&&!memoryChallenge;
  const trackReady = progress.isSuccess && (canStartAcademyTrack(track, progress.data) || (missionReview && progress.data.seasonStatus === "Active"));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const loadedSession = useRef<string | null>(null);
  const [sessionSnapshot, setSessionSnapshot] = useState<Session | null>(null);
  const [restoredAttempt, setRestoredAttempt] = useState<{ cardId: string; result: AttemptResult } | null>(null);
  const resume = useMutation({ mutationFn: (id: string) => api.resumeSession(id) });
  const [startRetry, setStartRetry] = useState(0);
  const [answer, setAnswer] = useState("");
  const [slotValues, setSlotValues] = useState<Record<number, string>>({});
  // Spelling second chance (Fill in the Blank): fix mode re-opens only the
  // spelling-slip blanks of the graded card; the fix submission id is
  // minted on entry and kept for the card, so a retried fix replays.
  const [fixMode, setFixMode] = useState(false);
  const [fixValues, setFixValues] = useState<Record<number, string>>({});
  const fixSubmission = useRef<{ id: string; cardId: string } | null>(null);
  const [chunks, setChunks] = useState<number[]>([]);
  const [readerOpened, setReaderOpened] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const readerOpenRef = useRef(false);
  const [readerAutoHiddenFor, setReaderAutoHiddenFor] = useState<string | null>(null);
  const [attemptResetFor, setAttemptResetFor] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const pendingAttempt = useRef<Parameters<typeof api.submitAttempt>[1] | null>(null);

  const start = useMutation({
    mutationFn: (sessionMode: "Practice" | "Review" | "Simulation") => {
      const key = JSON.stringify([me?.organizationId, me?.userId, progress.data!.seasonId, sessionMode, missionId, missionRevision, step, memoryChallenge, passageAssignmentId, passageKnowledgeUnitId]);
      if (startIntent.current?.key !== key) {
        startIntent.current = { key, context: {
          clientStartId: params.get("startId") || crypto.randomUUID(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(step ? { step } : {}),
          ...(missionId ? { missionId, missionRevision: missionRevision === null ? undefined : Number(missionRevision) } : {}),
        } };
      }
      const context = startIntent.current.context;
      if (!params.get("startId")) {
        const nextParams = new URLSearchParams(params);
        nextParams.set("startId", context.clientStartId);
        setParams(nextParams, { replace: true });
      }
      // Unscoped starts keep the exact call shape they have always used;
      // only a passage-scoped start passes the scope argument.
      if (passageScope) return api.startSession(progress.data!.seasonId, sessionMode, context, "Memory", memoryChallenge, undefined, passageScope);
      return memoryChallenge ? api.startSession(progress.data!.seasonId, sessionMode, context, "Memory", memoryChallenge) : api.startSession(progress.data!.seasonId, sessionMode, context);
    },
  });

  const card = useQuery({
    queryKey: ["card", sessionId, me?.organizationId, me?.userId],
    queryFn: () => api.nextCard(sessionId!),
    enabled: !!sessionId,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!card.data) {
      return;
    }
    startedAt.current = Date.now();
    pendingAttempt.current = readPendingAttempt(sessionId!, card.data);
    submit.reset();
    spellingFix.reset();
    setFixMode(false);
    setFixValues({});
    fixSubmission.current = null;
    setShuffleNote(false);
    setReblankNote(false);
    setChunks([]);
    setAnswer(pendingAttempt.current?.submittedAnswer ?? "");
    setSlotValues(Object.fromEntries(pendingAttempt.current?.missingWordAnswers?.map(slot => [slot.index, slot.text]) ?? []));
    setReaderOpened(sessionStorage.getItem(`erudoza:attempt:read:${sessionId}:${card.data.id}`) === "true");
    // Assured-answers guard: a from-memory card must never arrive while the
    // Assigned Scripture is open. Hide it automatically and say why. The
    // reader state is not persisted, so resume/deep-link arrivals start
    // closed and are covered by the same check.
    if (readerRestrictedActivity(card.data.activityType) && readerOpenRef.current) {
      readerOpenRef.current = false;
      setReaderOpen(false);
      setReaderAutoHiddenFor(card.data.id);
    } else {
      setReaderAutoHiddenFor(null);
    }
    setAttemptResetFor(null);
    // Reset from the newly drawn card identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.data?.id]);

  const submit = useMutation({
    mutationFn: () => {
      pendingAttempt.current ??= {
        clientSubmissionId: crypto.randomUUID(),
        challengeCardId: card.data!.id,
        ...(card.data!.activityType === 'MissingWords' ? { missingWordAnswers: card.data!.tokens.filter(token => token.hidden).map(token => ({index:token.index,text:slotValues[token.index] ?? ''})) } : { submittedAnswer: answer }),
        responseTimeMs: Date.now() - startedAt.current,
        hintsUsed: sessionStorage.getItem(`erudoza:attempt:read:${sessionId}:${card.data!.id}`) === "true",
      };
      sessionStorage.setItem("erudoza:attempt:" + sessionId, JSON.stringify(pendingAttempt.current));
      return api.submitAttempt(sessionId!, pendingAttempt.current);
    },
    onSuccess: (data) => {
      sessionStorage.removeItem("erudoza:attempt:" + sessionId);
      sessionStorage.removeItem(`erudoza:attempt:read:${sessionId}:${card.data!.id}`);
      // Fresh, correct, first-time results only: replays (alreadyProcessed)
      // and restored attempts render feedback without the reward animation.
      if (data.isCorrect && !data.alreadyProcessed) xpReward.fire(data.xpReward);
    },
  });

  const complete = useMutation({
    mutationFn: () => api.completeSession(sessionId!),
    onSuccess: (summary) => {
      for (const key of ["progress", "training-today", "training-honors", "training-journey"]) void queryClient.invalidateQueries({ queryKey: [key] });
      navigate("/student/sessions/" + encodeURIComponent(summary.sessionId) + "/recap?seasonId=" + encodeURIComponent(sessionSnapshot?.seasonId ?? progress.data!.seasonId));
    },
  });

  const [shuffleNote, setShuffleNote] = useState(false);
  const shuffle = useMutation({
    mutationFn: () => api.shuffleSession(sessionId!),
    onSuccess: () => setShuffleNote(true),
  });

  const [reblankNote, setReblankNote] = useState(false);
  const reblank = useMutation({
    mutationFn: (cardId: string) => api.reblankCard(sessionId!, cardId),
    onSuccess: (nextCard) => {
      // The draft was typed against the old blank pattern: clear it, and any
      // unconfirmed saved attempt (it names the old blank slots), so the new
      // pattern starts fresh. The reader flag is deliberately untouched —
      // shuffling blanks is a practice action, never assistance.
      pendingAttempt.current = null;
      sessionStorage.removeItem("erudoza:attempt:" + sessionId);
      queryClient.setQueryData(["card", sessionId, me?.organizationId, me?.userId], nextCard);
      setSlotValues({});
      submit.reset();
      startedAt.current = Date.now();
      setReblankNote(true);
    },
  });

  useEffect(() => {
    if (requestedSessionId && loadedSession.current === requestedSessionId) return;
    let cancelled = false;
    setSessionId(null);
    setSessionSnapshot(null);
    setRestoredAttempt(null);
    setAnswer("");
    setSlotValues({});
    setChunks([]);
    submit.reset();
    complete.reset();
    if (requestedSessionId) {
      startIntent.current = null;
      void (initialSaved ? Promise.resolve(initialSaved) : resume.mutateAsync(requestedSessionId)).then((saved) => {
        if (cancelled) return;
        if (saved.summary) {
          navigate("/student/sessions/" + encodeURIComponent(saved.session.id) + "/recap?seasonId=" + encodeURIComponent(saved.session.seasonId), { replace: true });
          return;
        }
        loadedSession.current = saved.session.id;
        setSessionSnapshot(saved.session);
        if (saved.card) queryClient.setQueryData(["card", saved.session.id, me?.organizationId, me?.userId], saved.card);
        if (saved.card && saved.attempt) {
          setRestoredAttempt({ cardId: saved.card.id, result: saved.attempt });
          sessionStorage.removeItem("erudoza:attempt:" + saved.session.id);
        }
        setSessionId(saved.session.id);
        setParams({ sessionId: saved.session.id, seasonId: saved.session.seasonId, mode: saved.session.mode }, { replace: true });
      }).catch(() => {});
    } else if (progress.data?.seasonId && trackReady && !choosePurpose) {
      void start.mutateAsync(mode).then((session) => {
        if (cancelled) return;
        queryClient.setQueryData(["study-resume-format",session.id,me?.organizationId,me?.userId],{session,card:null,attempt:null,summary:null});
        loadedSession.current = session.id;
        setSessionSnapshot(session);
        setSessionId(session.id);
        setParams({ sessionId: session.id, seasonId: session.seasonId, mode: session.mode }, { replace: true });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
    // Navigation owns session identity; ignore late replies after switching modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSessionId, progress.data?.seasonId, trackReady, mode, missionId, missionRevision, step, startRetry, choosePurpose, memoryChallenge]);

  const result = submit.data ?? (restoredAttempt?.cardId === card.data?.id ? restoredAttempt?.result : undefined);
  // Spelling second chance derivation. Eligibility comes from the graded
  // result: the server stamps spellingEligible from the same classifier
  // that labels the feedback; the per-blank spelling flags are the fallback
  // for results graded before the stamp existed. Simulation never offers
  // a fix. A used fix (fresh or restored) replaces the eligible blanks'
  // display verdicts; corrected blanks render gold via `corrected`.
  const eligibleIndexes = result && card.data?.activityType === 'MissingWords' && mode !== 'Simulation'
    ? (result.spellingEligible ?? result.missingWordResults?.filter(r => !r.isCorrect && r.spelling).map(r => r.index) ?? [])
    : [];
  const spellingFix = useMutation({
    mutationFn: () => api.fixSpelling(sessionId!, {
      clientSubmissionId: fixSubmission.current!.id,
      challengeCardId: card.data!.id,
      answers: eligibleIndexes.map(index => ({ index, text: fixValues[index] ?? "" })),
    }),
    onSuccess: (data) => {
      setFixMode(false);
      // The reward pop fires only for a fresh fix that actually earned XP;
      // replays render the stored summary without the animation.
      if (!data.alreadyProcessed && data.xpEarned > 0) xpReward.fire(data.xpReward);
    },
  });
  const fixSummary = spellingFix.data ?? result?.spellingFix;
  const canFixSpelling = eligibleIndexes.length > 0 && !fixSummary;
  const gradedSlotValues = result?.missingWordAnswers ? Object.fromEntries(result.missingWordAnswers.map(slot => [slot.index, slot.text])) : slotValues;
  const displaySlotValues = fixSummary
    ? { ...gradedSlotValues, ...Object.fromEntries(fixSummary.answers.map(a => [a.index, a.text])) }
    : fixMode ? { ...gradedSlotValues, ...fixValues } : gradedSlotValues;
  const displayResults = result?.missingWordResults && fixSummary
    ? result.missingWordResults.map(r => { const f = fixSummary.results.find(x => x.index === r.index); return f ? { index: f.index, isCorrect: f.isCorrect, expected: f.expected, spelling: f.spelling, corrected: f.isCorrect } : r; })
    : result?.missingWordResults;
  const enterFixMode = () => {
    fixSubmission.current = { id: crypto.randomUUID(), cardId: card.data!.id };
    setFixValues(Object.fromEntries(eligibleIndexes.map(index => [index, gradedSlotValues[index] ?? ""])));
    setFixMode(true);
  };
  // In-session game feedback (B1): newer results carry the XP the attempt
  // earned and the running session streak; legacy results omit both and
  // simply render no line.
  const accepted = !!result;
  const current = card.data;
  const submittedText = result?.submittedAnswer ?? answer;
  const answerDiff = result && current && !result.isCorrect && (current.activityType === "WhatComesNext" || current.activityType === "VerseBuilder") && submittedText.trim()
    ? diffWords(result.canonicalAnswer, submittedText)
    : null;
  const quest = game.data?.quests?.find((item) => !item.completed);
  const returnDetail = mode === "Review" && current ? reviewReturnDetail(progress.data, current.citation) : null;
  const sessionMeta = game.data?.streak && game.data?.xp ? (
    <div className="study-session-meta" aria-label="Training progress">
      <span className="study-meta-chip"><AppIcon name="flame" />{game.data.streak.current}-day streak</span>
      <span className="study-meta-chip">Level {game.data.xp.level} · {game.data.xp.levelName}</span>
      {quest && <span className="study-meta-chip">Quest: {quest.title} · +{quest.xpReward ?? 25} XP</span>}
    </div>
  ) : null;
  const returnBanner = mode === "Review" && current ? (
    <div className="study-return-banner" data-testid="review-return-banner">
      <AppIcon name="review" />
      <div>
        <strong>Back for another pass</strong>
        <span>{returnDetail ?? "due for review"}</span>
      </div>
    </div>
  ) : null;
  const examBanner = mode === "Simulation" ? (
    <div className="study-exam-banner" data-testid="exam-mode-banner">
      <AppIcon name="flag" />
      <div>
        <strong>Challenge mode</strong>
        <p>Typed answers only — no choices, reader, recitation, or hints. Each answer is checked as you go.</p>
        <ul className="study-rules" aria-label="Challenge rules">
          {academyModeRules("rehearsal", "Memory").map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </div>
    </div>
  ) : null;

  const chooseChunks = (ids: number[]) => {
    setChunks(ids);
    setAnswer(ids.map(id => current?.tokens.find(token => token.index === id)?.display ?? "").join(" "));
  };

  // Session actions, defined once: the secondary practice tools (shuffle
  // blanks / deck) stay in flow; the primary trio (check / next / finish)
  // rides the bottom action dock on phones and sits in the same in-flow row
  // on desktop. Identical elements either way — the dock replaces the
  // in-flow primary row, never duplicates it.
  const shuffleBlanksButton = current?.activityType === "MissingWords" && mode !== "Simulation" && !accepted ? <Button
    data-testid="shuffle-blanks"
    type="button"
    variant="secondary"
    onClick={() => reblank.mutate(current.id)}
    disabled={reblank.isPending || submit.isPending || card.isFetching || !!pendingAttempt.current || (current.blankShuffles ?? 0) >= (current.blankShuffleLimit ?? 3)}
  >
    {reblank.isPending ? "Shuffling blanks…" : "Shuffle blanks"}
  </Button> : null;
  const shuffleDeckButton = mode === "Practice" && current && current.sequence < current.total ? <Button
    data-testid="shuffle-deck"
    type="button"
    variant="secondary"
    aria-label="Shuffle deck"
    onClick={() => shuffle.mutate()}
    disabled={shuffle.isPending || complete.isPending || card.isFetching}
  >
    {shuffle.isPending ? "Shuffling deck…" : "Shuffle deck"}
  </Button> : null;
  const sessionPrimaryActions = <>
    <Button
      data-testid="submit-answer"
      type="button"
      variant={accepted ? "secondary" : "primary"}
      size={accepted ? "compact" : "default"}
      onClick={() => submit.mutate()}
      disabled={!current || submit.isPending || accepted || (current?.activityType !== 'MissingWords' && !answer.trim())}
    >
      {submit.isPending ? "Checking…" : accepted ? "Answer checked" : pendingAttempt.current ? "Retry saved answer" : "Check answer"}
    </Button>
    {accepted && current && current.sequence < current.total && <Button
      data-testid="next-card"
      type="button"
      variant={accepted ? "primary" : "secondary"}
      onClick={() => {
        void card.refetch();
      }}
      disabled={!accepted || complete.isPending || card.isFetching}
    >
      {card.isFetching ? "Loading…" : card.isError ? "Retry next card" : "Next card"}
    </Button>}
    <Button
      data-testid="complete-session"
      type="button"
      variant={accepted && current?.sequence === current?.total ? "primary" : "ghost"}
      onClick={() => complete.mutate()}
      disabled={!accepted || complete.isPending}
    >
      {complete.isPending ? "Finishing…" : "Finish session"}
    </Button>
  </>;

  const cover = (
    <div data-testid="study-page-title">
      <p className="study-eyebrow">{framing.eyebrow}</p>
      <PageHeader title={current ? academyActivityName(current.activityType) : "Study"}
        description={<span className="study-blurb">{framing.blurb}</span>}
        action={<span className="study-cover-actions"><Badge data-testid="academy-session-kicker">{academySessionKicker(mode)}</Badge></span>}>
        {progress.isSuccess && !trackReady && <p data-testid="academy-track-unavailable">{academyUnavailableCopy(track, progress.data)}</p>}
      </PageHeader>
    </div>
  );

  if ([start.error, card.error, submit.error, resume.error, complete.error].some(error => error instanceof ApiError && error.status === 409)) {
    return <div className="er-study-stage">{cover}<Notice tone="info">Your assignment or session changed. Return to Training HQ to continue with your current plan. Accepted answers remain saved.</Notice><LinkButton to={`/student?seasonId=${encodeURIComponent(sessionSnapshot?.seasonId ?? selectedSeasonId ?? progress.data?.seasonId ?? "")}`} onClick={() => {
      for (const key of ["progress", "training-today", "training-honors", "training-journey"]) void queryClient.invalidateQueries({ queryKey: [key] });
    }}>Return to Training HQ</LinkButton></div>;
  }

  if (!requestedSessionId && progress.isSuccess && !trackReady) {
    return (
      <div className="er-study-stage">
        {cover}
      </div>
    );
  }

  if (choosePurpose && trackReady) return <div className="er-study-stage">{cover}<Panel>
    <h2>Choose your Memory practice</h2><p>Warmups use varied gaps and phrase building. Advanced mastery challenges require coach-set Advanced difficulty.</p>
    <div className="student-study-actions">
      <Button onClick={()=>setPurposeChoice({seasonId:progress.data!.seasonId,purpose:'Warmup'})}>Start Memory warmup</Button>
      {progress.data?.assignments.some(a=>a.difficulty==='Advanced') && <Button variant="secondary" onClick={()=>setPurposeChoice({seasonId:progress.data!.seasonId,purpose:'Advanced'})}>Start Advanced mastery challenge</Button>}
    </div>
  </Panel></div>;

  return (
    <div className="er-study-stage" data-session-active="true">
      {cover}
      {returnBanner}
      {examBanner}
      {sessionMeta}
      {readerAutoHiddenFor && current?.id === readerAutoHiddenFor && <Notice tone="info" data-testid="reader-auto-hidden-note">The Assigned Scripture was hidden for this card — this activity is answered from memory. Opening the passage during it marks the attempt as assisted, so it does not establish unaided recall.</Notice>}
      {attemptResetFor && current?.id === attemptResetFor && <Notice tone="info" data-testid="attempt-reset-note">Reading the passage restarted this activity — your draft was cleared because this activity is answered from memory. Your new attempt will be marked as assisted.</Notice>}
      {resume.isError && <Notice tone="danger">We couldn't reopen your saved session. <Button variant="secondary" onClick={() => setStartRetry((value) => value + 1)}>Retry saved session</Button><Button variant="secondary" onClick={() => { loadedSession.current = null; resume.reset(); setParams({ mode, ...(selectedSeasonId ? { seasonId: selectedSeasonId } : {}) }); }}>Start a new session</Button></Notice>}

      {(progress.isError || start.isError || card.isError) && <Notice tone="danger">This study session could not load. <Button variant="secondary" onClick={() => { if (progress.isError) void progress.refetch(); else if (start.isError) setStartRetry((value) => value + 1); else void card.refetch(); }}>Try again</Button></Notice>}
      <Panel className="student-challenge" data-testid="challenge-card">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm study-card-reference">
            {current ? current.citation : "Loading"}
          </p>
          <div className="flex items-center gap-2">
            <p data-testid="card-progress">{current ? `${current.sequence} / ${current.total}` : "…"}</p>
          </div>
        </div>
        {current && <progress className="training-session-progress" value={current.sequence} max={current.total || 1} aria-label="Study session progress" />}
        {current?.activityType !== "MissingWords" && <h2 className="er-scripture mt-6 text-2xl leading-relaxed" data-testid="challenge-prompt">
          {current?.prompt ?? "Loading your next practice question…"}
        </h2>}
        {current ? (
          current.activityType === 'MissingWords' ? <MissingWordsInput
            key={current.id} tokens={current.tokens} values={displaySlotValues}
            onChange={fixMode ? (next) => setFixValues(prev => { const merged = { ...prev }; for (const index of eligibleIndexes) merged[index] = next[index] ?? ""; return merged; }) : setSlotValues}
            disabled={fixMode ? spellingFix.isPending : accepted || submit.isPending || submit.isError || !!pendingAttempt.current}
            results={displayResults}
            editableIndexes={fixMode ? eligibleIndexes : undefined}
            fixResults={fixSummary?.results}
          /> : <ChallengeInput
            card={current}
            answer={answer}
            chunks={chunks}
            onAnswer={setAnswer}
            onChunks={chooseChunks}
            locked={accepted || submit.isPending || submit.isError || !!pendingAttempt.current}
            allowChoices={mode !== "Simulation"}
            feedbackSourceText={result && current.activityType === "VerseBuilder" ? (result.sourceText || result.canonicalAnswer) : undefined}
          />
        ) : null}
        {pendingAttempt.current && !accepted && <Notice className="mt-4" data-testid="pending-answer"><p className="font-medium">Your answer is saved — we just couldn't confirm it yet</p><p className="mt-2 whitespace-pre-wrap">{pendingAttempt.current.submittedAnswer ?? pendingAttempt.current.missingWordAnswers?.map((slot, index) => `Blank ${index + 1}: ${slot.text || '(empty)'}`).join('\n')}</p><p className="mt-2 text-sm">Retrying sends this same answer.</p></Notice>}
        {current?.debugAnswer ? (
          <p className="sr-only" data-testid="debug-answer">
            {current.debugAnswer}
          </p>
        ) : null}
      {result ? (
        <div className="student-feedback" data-testid="challenge-feedback" role="status" aria-live="polite" ref={feedbackRef}>
          {result.isCorrect ? <Badge tone="success">Correct</Badge> : <Badge tone="warning">Not quite yet</Badge>}
          <p className="mt-3 text-lg font-semibold text-[var(--er-ink-navy)]">{result.isCorrect ? "Well remembered" : "Take another look"}</p>
          {result.citation !== current?.citation && <p className="mt-2 text-sm" data-testid="feedback-citation">

            {result.citation}
          </p>}
          {answerDiff ? (
            <div className="student-answer-diff" data-testid="answer-diff">
              <p className="er-scripture mt-2" data-testid="feedback-source">
                <DiffTokens tokens={answerDiff.expected} />
              </p>
              <p className="mt-2 text-sm">
                <span className="font-semibold">Your answer: </span>
                <DiffTokens tokens={answerDiff.submitted} />
              </p>
              <p className="mt-2 text-sm" data-testid="answer-diff-summary">
                {[
                  answerDiff.missed ? `${answerDiff.missed} missed ${answerDiff.missed === 1 ? "word is" : "words are"} underlined in the verse.` : "",
                  answerDiff.extra ? `${answerDiff.extra} extra ${answerDiff.extra === 1 ? "word is" : "words are"} struck through in your answer.` : "",
                  ...answerDiff.spellingPairs.map(pair => `Spelling: you wrote “${pair.submitted}” for “${pair.expected}” — a spelling slip, not a wrong word; in PBE a misspelling can still earn credit.`),
                ].filter(Boolean).join(" ")}
              </p>
            </div>
          ) : (
            <p className="er-scripture mt-2" data-testid="feedback-source">
              {result.sourceText}
            </p>
          )}
          <p className="mt-3 text-sm text-[var(--er-success-ink)]" data-testid="mastery-impact">
            Your {result.skillLabel ?? "wording"} score: {fixSummary?.skillScore ?? result.skillScore ?? result.exactWordingScore} / 100 · Level: {fixSummary?.masteryLevel ?? result.masteryLevel}
          </p>
          {typeof result?.xpEarned === "number" && <p className="mt-2 text-sm" data-testid="session-xp-line">
            +{result.xpEarned} XP{typeof result.sessionStreak === "number" && result.sessionStreak >= 2 ? ` · Session streak ${result.sessionStreak}` : ""}
          </p>}
          {canFixSpelling && !fixMode && <div className="mt-3" data-testid="spelling-fix-offer">
            <p className="text-sm">{eligibleIndexes.length === 1 ? "One blank was a spelling slip." : `${eligibleIndexes.length} blanks were spelling slips.`} Fix the spelling for partial credit — one chance per card.</p>
            <Button type="button" variant="secondary" className="mt-2" data-testid="fix-spelling" onClick={enterFixMode}>Fix your spelling</Button>
          </div>}
          {fixMode && <div className="mt-3" data-testid="spelling-fix-mode">
            <p className="text-sm">Only the spelling blanks are open — everything else stays exactly as checked. Retype them, then check your fixes.</p>
            <Button type="button" className="mt-2" data-testid="submit-spelling-fix" disabled={spellingFix.isPending} onClick={() => spellingFix.mutate()}>{spellingFix.isPending ? "Checking…" : "Check my fixes"}</Button>
          </div>}
          {fixSummary && <p className="mt-2 text-sm" data-testid="spelling-fix-summary">
            {fixSummary.correctedCount > 0
              ? `Spelling fix: ${fixSummary.correctedCount} ${fixSummary.correctedCount === 1 ? "blank" : "blanks"} corrected — partial credit${fixSummary.xpEarned > 0 ? ` · +${fixSummary.xpEarned} XP` : ""}. Your first try stays on record as checked.`
              : "No blanks corrected that time — the verse above shows the right spelling. Your first try stays on record as checked."}
          </p>}
          <p className="mt-2 text-sm" data-testid="assistance-note">
            {readerOpened
              ? "You opened the reader on this one, so it counts as practice — not as remembering it on your own."
              : "You did this one from memory — no reader help."}
          </p>
        </div>
      ) : null}
        {phone ? <>
          {(shuffleBlanksButton || shuffleDeckButton) && <div className="student-study-actions student-study-actions--secondary">{shuffleBlanksButton}{shuffleDeckButton}</div>}
          <div className="student-study-actions mobile-action-dock" role="region" aria-label="Session actions">{sessionPrimaryActions}</div>
        </> : <div className="student-study-actions">
          {shuffleBlanksButton}
          {shuffleDeckButton}
          {sessionPrimaryActions}
        </div>}
        {(submit.isError || complete.isError || shuffle.isError || reblank.isError || spellingFix.isError) && <p role="alert" className="study-action-note">{submit.isError ? "Your answer could not be saved. Please try again." : complete.isError ? "The session could not be finished. Please try again." : spellingFix.isError ? "Your spelling fix could not be saved. Please try again." : reblank.isError ? "The blanks could not be shuffled. Please try again." : "The remaining cards could not be shuffled. Please try again."}</p>}
        {shuffleNote && !shuffle.isPending && <p className="text-sm study-action-note" data-testid="shuffle-note">Deck shuffled — the order of the remaining cards has changed. This card stays as it is.</p>}
        {reblankNote && !reblank.isPending && <p className="text-sm study-action-note" data-testid="reblank-note">Blanks shuffled — same verse, new pattern, and your draft was cleared so this pattern starts fresh. Shuffling blanks is practice, not help: it never marks your attempt as assisted.</p>}
      </Panel>
      {current && mode !== "Simulation" && <section aria-label="Learning aids" className="study-aids">
        <RecitationPanel key={current.id} compareSourceText={result ? (result.sourceText || result.canonicalAnswer) : undefined} />

        {sessionSnapshot && <ScriptureReader
          key={sessionSnapshot.seasonId}
          seasonId={sessionSnapshot.seasonId}
          citation={current.citation}
          focus={current.activityType === "ReferenceMatch" ? undefined : { citation: current.citation, nextVerse: current.activityType === "WhatComesNext" }}
          open={readerOpen}
          onOpenChange={(next) => {
            readerOpenRef.current = next; setReaderOpen(next);
            // Read-passage reset: opening the passage mid-attempt on a
            // from-memory activity clears the in-progress draft, so the
            // student restarts the card clean (and the re-attempt is marked
            // assisted by the existing read flag). A pending, already-sent
            // attempt is never rewritten — its saved payload stays exact.
            if (next && current && readerRestrictedActivity(current.activityType) && !accepted && pendingAttempt.current?.challengeCardId !== current.id
              && (answer.trim() || chunks.length > 0 || Object.values(slotValues).some(value => value.trim()))) {
              setAnswer("");
              setChunks([]);
              setSlotValues({});
              setAttemptResetFor(current.id);
            }
          }}
          onRead={() => {
            setReaderOpened(true);
            if (!accepted && !submit.isPending && pendingAttempt.current?.challengeCardId !== current.id)
              sessionStorage.setItem(`erudoza:attempt:read:${sessionId}:${current.id}`, "true");
          }}
        />}
      </section>}
      <XpRewardOverlay reward={xpReward.reward} name={me?.displayName ?? "You"} avatar={rewardAvatar} getAnchor={() => feedbackRef.current} />
    </div>
  );
}

function ChallengeInput({
  card,
  answer,
  chunks,
  onAnswer,
  onChunks,
  locked,
  allowChoices,
  feedbackSourceText,
}: {
  card: ChallengeCard;
  answer: string;
  chunks: number[];
  onAnswer: (value: string) => void;
  onChunks: (ids: number[]) => void;
  locked: boolean;
  allowChoices: boolean;
  feedbackSourceText?: string;
}) {
  if (card.activityType === "VerseBuilder") {
    return <VerseBuilderInput tokens={card.tokens} selected={chunks} onChange={onChunks} disabled={locked} feedbackSourceText={feedbackSourceText}/>;
  }

  if (card.activityType === "TrueFalse") {
    return (
      <div className="mt-6 flex flex-wrap gap-3" aria-label="True or false">
        {["True", "False"].map((choice) => (
          <Button
            key={choice}
            type="button"
            data-testid={`true-false-${choice.toLowerCase()}`}
            variant={answer === choice ? "primary" : "secondary"}
            aria-pressed={answer === choice}
            onClick={() => onAnswer(choice)}
            disabled={locked}
          >
            {choice}
          </Button>
        ))}
      </div>
    );
  }

  if (allowChoices && card.choices && card.choices.length > 0) {
    return (
      <fieldset className="mt-6">
        <legend className="text-sm font-medium">Choose the reference</legend>
        <div className="mt-3 space-y-2">
          {card.choices.map((choice) => (
            <label key={choice} className="student-answer-choice">
              <Input type="radio" name="reference" value={choice} checked={answer === choice} onChange={() => onAnswer(choice)} disabled={locked} />
              <span>{choice}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <label className="mt-6 block text-sm font-medium">
      {card.activityType === "WhatComesNext"
        ? "Type the next verse"
        : card.activityType === "ReferenceMatch"
          ? "Type the reference"
          : "Type your answer"}
      {card.activityType === "ReferenceMatch" ? <Input
        data-testid="missing-words-answer"
        className="mt-2 w-full"
        value={answer}
        placeholder="Book chapter:verse"
        autoComplete="off"
        onChange={(event) => onAnswer(event.target.value)}
        disabled={locked}
      /> : <Textarea
        data-testid="missing-words-answer"
        className="mt-2 w-full"
        rows={card.activityType === "WhatComesNext" ? 4 : 3}
        value={answer}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onAnswer(event.target.value)}
        disabled={locked}
      />}
    </label>
  );
}

function readPendingAttempt(sessionId: string, card: ChallengeCard): Parameters<typeof api.submitAttempt>[1] | null {
  try {
    const stored = sessionStorage.getItem("erudoza:attempt:" + sessionId);
    if (!stored) return null;
    const value = JSON.parse(stored) as Parameters<typeof api.submitAttempt>[1];
    if (!value || value.challengeCardId !== card.id || typeof value.clientSubmissionId !== 'string' ||
      !Number.isSafeInteger(value.responseTimeMs) || value.responseTimeMs < 0 || typeof value.hintsUsed !== 'boolean') return null;
    if (Object.hasOwn(value, 'submittedAnswer')) return typeof value.submittedAnswer === 'string' && !Object.hasOwn(value, 'missingWordAnswers') ? value : null;
    if (card.activityType !== 'MissingWords' || !Array.isArray(value.missingWordAnswers)) return null;
    const hidden = card.tokens.filter(token => token.hidden);
    const slots = value.missingWordAnswers;
    return slots.length === hidden.length && new Set(slots.map(slot => slot?.index)).size === hidden.length &&
      slots.every(slot => slot && Number.isInteger(slot.index) && typeof slot.text === 'string' && hidden.some(token => token.index === slot.index)) ? value : null;
  } catch { return null; }
}