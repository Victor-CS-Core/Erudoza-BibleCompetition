/** Solo PBE run types (mirrors worker/native/pbe/types.ts PbeMode). */
export type PbeMode = "Practice" | "Review" | "Simulation" | "Rescue" | "Checkpoint" | "MockHalf" | "MockFull";

/** Modes that run under the authoritative timed window (frozen answers,
 * deferred feedback, official timing: 20 seconds + 5 per point). */
export const TIMED_PBE_MODES: readonly PbeMode[] = ["Simulation", "Checkpoint", "MockHalf", "MockFull"];

/** MockFull halftime state (card 51): the run pauses after attempt 45;
 * resumedAtMs stays null until the learner continues into question 46. */
export interface PbeBreakState { afterAttempts: number; startedAtMs: number; resumedAtMs: number | null }
/** What `next` returns instead of a card while a MockFull sits at its break. */
export interface PbeNextBreak { sessionId: string; total: number; break: PbeBreakState }
export const isTimedPbeMode = (mode: string): boolean => (TIMED_PBE_MODES as readonly string[]).includes(mode);

export interface PbeQuestionView {
  id: string;
  version: number;
  prompt: string;
  reference: string;
  kind: "ShortAnswer" | "List" | "ExactWords" | "TrueFalse";
  partPoints: number[];
  points: number;
  durationSeconds: number;
}

/** Coach authoring contract; corrected text requires a new pack and source identity. */
export interface PbeIntroductionInput {
  bookKey: string;
  sourceEdition: string;
  title: string;
  citation: string;
  licensingStatus: 'pending' | 'approved' | 'public-domain' | 'creative-commons';
  units: { citation: string; canonicalText: string }[];
}
export interface PbeIntroductionView extends PbeIntroductionInput {
  id: string;
  organizationId: string;
  seasonId: string;
  reviewed: boolean;
  revision: number;
  assignedStudentIds: string[];
  units: { id: string; citation: string; canonicalText: string }[];
}
export interface PbeSourceView {
  id: string;
  contentPackId: string;
  sourceKind: 'Scripture' | 'Commentary';
  bookKey: string;
  chapter: number | null;
  verse: number | null;
  ordinal: number;
  citation: string;
  canonicalText: string;
}

export interface PbeSessionCard { id:string; sessionId:string; format:'Pbe'; sequence:number; total:number; question:PbeQuestionView; assisted:boolean }
export interface PbeAttemptResult { attemptId:string; earnedPoints:number; availablePoints:number; expectedParts:string[]; sourceEvidence:string; citation:string; unaided:boolean; acceptedAtUtc:string; acceptedSequence:number; alreadyProcessed:boolean; /** Server reward snapshot (earned XP + level before/after) for the XP reward animation. */ xpReward?: import('./trainingTypes').XpReward }
export interface PbeTimedReceipt {attemptId:string;acceptedAtUtc:string;acceptedSequence:number;alreadyProcessed:boolean;feedbackDeferred:true;responseLockedAtUtc?:string;questionId?:string}
export interface PbePresentationState {questionId:string;revision:number;delivery:'Audio'|'TextFallback'|'Coach';requiredScribeIds:string[];readyScribeIds:string[];responseStartsAtMs:number|null;responseEndsAtMs:number|null;status:'Presenting'|'Armed'|'Settling'|'Settled'|'NotPresented';serverNow:string;feedbackDeferred:true}
export interface PbeSubmission { clientSubmissionId:string; challengeCardId:string; answers:string[]; hintsUsed:boolean }
export interface PbeInterruption {status:'Interrupted';restartAllowed:true}
export interface PbeInterruptionStatus extends PbeInterruption {session?:import('./types').Session;summary?:import('./types').SessionSummary}
export interface PbeResumedSession { session:import('./types').Session; card:PbeSessionCard|null; attempt:PbeAttemptResult|PbeTimedReceipt|null; summary:import('./types').SessionSummary|null; interruption?:PbeInterruption|null }

export type ChapterCounts = {
  assignedPassages:number; questionCoveredPassages:number; totalTargets:number;
  practicedTargets:number; recalledTargets:number; retainedTargets:number;
  dueTargets:number; missingVariantTargets:number;
};
export type ProgressAction = {mode:'Practice'|'Review';label:string;progressScope:{key:string;scopeVersion:string}};
export type StampSummary = {stampId:string;chapterKey:string;kind:'Chapter'|'Introduction';label:string;scopeLabel:string;scopeVersion:string;ruleVersion:string;earnedAtUtc:string;matchesCurrentScope:boolean|null};
export type ProgressRow = {
  key:string;parentChapterKey:string|null;kind:'Chapter'|'PassageGroup'|'Introduction';label:string;scopeLabel:string;
  contentPackId:string;bookKey:string;chapter:number|null;wholeChapterAssigned:boolean|null;counts:ChapterCounts;
  currentReadiness:'Retained'|'Incomplete'|'Updating';stamp:StampSummary|null;hasHistoricalStamps:boolean;actions:ProgressAction[];
};
export type ChapterWork = {id:string|null;state:'NotStarted'|'Working'|'Complete'|'Blocked';stage:'Indexing'|'Replaying'|'Projecting'|'Cleanup'|null;reason:'PbeDisabled'|'SeasonClosed'|'NoAssignment'|'DataGap'|'ScopeTooLarge'|'InputTooLarge'|null};
export type ChapterPage = {
  seasonId:string;ruleVersion:string;scopeVersion:string|null;snapshotId:string|null;chapterKey:string|null;work:ChapterWork;
  currentAvailable:boolean;historyAvailable:boolean;asOfUtc:string|null;dueRefreshAtUtc:string|null;nextCursor:string|null;
}&({view:'Chapters'|'Groups';items:ProgressRow[]}|{view:'Stamps';items:StampSummary[]});
export type ContinueChaptersRequest = {seasonId:string;workId?:string};
export type ContinueChaptersResponse = {seasonId:string;scopeVersion:string|null;work:ChapterWork;next:'Continue'|'Reload'|'None'};

export type CountRange = { known: number; possible: number };
export type MaterialSummary = {
  assigned: number;
  questionCovered: CountRange;
  practiced: CountRange;
  retained: CountRange;
  due: CountRange;
  equalRetained: {
    lower: number;
    upper: number;
    students: number;
    unknownStudents: number;
    unassignedStudents: number;
  } | null;
};
export type OwnMaterialSummary = {
  assigned: number;
  practiced: CountRange;
  retained: CountRange;
  due: CountRange;
};
export type OwnSummary = {
  scripture: OwnMaterialSummary;
  introduction: OwnMaterialSummary;
  state: 'Known' | 'Unknown' | 'Unassigned';
};
export type CooperationWork = {
  id: string | null;
  next: 'Continue' | 'Reload' | 'None';
};
export type CooperationSnapshot = {
  seasonId: string;
  ruleVersion: string;
  scopeVersion: string | null;
  snapshotId: string | null;
  state: 'NotStarted' | 'Updating' | 'Snapshot' | 'Provisional' | 'Blocked';
  reason: 'PbeDisabled' | 'SeasonClosed' | 'ScopeTooLarge' | 'InputTooLarge' | 'DataGap' | null;
  checkedAtUtc: string | null;
  dueRefreshAtUtc: string | null;
  rosterStudents: number;
  unknownStudents: number;
  scripture: MaterialSummary | null;
  introduction: MaterialSummary | null;
  own: OwnSummary | null;
  work: CooperationWork;
};
export type ContinueCooperationRequest = { seasonId: string; workId?: string };
export type ContinueCooperationResponse = CooperationSnapshot;

export type CooperationStudentSummary = {
  studentId: string;
  displayName: string;
  state: 'Known' | 'Unknown' | 'Unassigned';
  reason: 'NotStarted' | 'Working' | 'Blocked' | 'DataGap' | null;
  scripture: OwnMaterialSummary;
  introduction: OwnMaterialSummary;
};
export type CooperationStudentPage = {
  seasonId: string;
  snapshotId: string;
  nextCursor: string | null;
  items: CooperationStudentSummary[];
};

export type PbeProgressScope = { key: string; scopeVersion: string };
export type PbeSessionSelection =
  | { progressScope: PbeProgressScope; chapter?: never; targetIds?: never }
  | { chapter: { contentPackId: string; chapter: number }; progressScope?: never; targetIds?: string[] }
  | { targetIds: string[]; progressScope?: never; chapter?: never };

/** Card 49: readiness dimensions, composed server-side at read time from
 * stored evidence (pbe-readiness-v1). percent is null when a dimension
 * has no stored evidence yet — an honest pending state, not a zero. */
export type PbeReadinessKey = 'Coverage' | 'Recall' | 'Precision' | 'Reference' | 'Composure' | 'Team';
export interface PbeReadinessDimension { key: PbeReadinessKey; percent: number | null; basis: string }
export interface PbeReadiness { version: 'pbe-readiness-v1'; seasonId: string; dimensions: PbeReadinessDimension[] }
