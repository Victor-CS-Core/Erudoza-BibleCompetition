import { request } from "./client";

export type SimulationConfig = {version:1;scope?:'AllAssigned'|'SelectedChapters';preset:'FullEvent'|'ShortPractice'|'Custom';bookKeys:string[];chapters:{bookKey:string;chapter:number}[];includeScripture:boolean;includeIntroductions:boolean;timeMultiplier:1|1.5|2;halfTime:boolean;discussion:'InPerson'|'Chat';audioPresenterId?:string};
export type SimulationMaterial = {seasonId:string;translation:string;books:{key:string;label:string;chapters:number[]}[];introductionsAvailable:boolean};
export type SimulationAchievement = {key:string;title:string;requirement:string;seasonId:string;current:number;target:number;earnedAtUtc:string|null};
export type PracticeCommand = { simulation?:SimulationConfig;teamSize?:number;questionCount?:number; commandId: string; revision: number; action: string; targetUserId?: string; otherUserId?: string; team?: number; text?: string; answers?: string[]; scheduleId?: string; questionId?: string; points?: number; delivery?: 'Audio' | 'TextFallback' | 'Coach' };
export type PracticeQuestion = { id?: string; contentPackId: string; sourceUnitId: string; prompt: string; kind: string; parts: { acceptedAnswers: string[]; points: number }[]; ordered: boolean; evidence: string; reference: string; version: number };
export type PracticeAward = { key: string; title: string; seasonId: string };
export type RoomSummary = { simulation?:SimulationConfig; format?: 'Arcade' | 'Pbe'; teamCount?: 1 | 2; id: string; seasonId: string; teamSize: number; questionCount: number; coached: boolean; status: string; memberCount: number; ownerId: string };
export type PracticeTrend = { pendingCount?: number; provisional?: boolean; scoringVersion?: string; format?: 'Arcade' | 'Pbe'; teamCount?: 1 | 2; seasonId: string; teamSize: number; bookKey: string | null; ruleVersion: string; matches: number; wins: number; draws: number; accuracyHundredths: number; speedHundredths: number; availableHundredths: number; unansweredQuestions: number; averageResponseMs: number; distinctQuestions: number; distinctPassages: number; participatedQuestions: number };
export type PracticeBootstrap = { simulationAchievements?:SimulationAchievement[]; trends?: PracticeTrend[]; enabled: boolean; seasons: { id: string; name: string; pbeEnabled?: boolean }[]; players: { id: string; displayName: string }[]; rooms: RoomSummary[]; invitations: { id: string; roomId: string; team?: number; teamCount?:1|2; inviterName: string; expiresAt: string }[]; achievements: PracticeAward[]; questions: { id: string; seasonId: string; published: boolean; question: PracticeQuestion }[] };
export type PracticeRoom = {
  simulation?:SimulationConfig;audioReadingComplete?:boolean;
  coachId?: string | null;
  provisional?:boolean;pendingCount?:number;
  materialUnavailable?: boolean; coachReading?:{questionId:string;coachId:string;completedAtMs:number}|null; coachReadyScribeIds?:string[];
  format?: 'Arcade' | 'Pbe'; teamCount?: 1 | 2; interruptionReason?:'ArmedResponsesUntrusted'|'UnarmedReserveUnavailable'; presentationDelivery?: Record<string,'Audio'|'TextFallback'|'Coach'>; responseStartsAt?: string;
  id: string; seasonId: string; teamSize: number; questionCount: number; coached: boolean; ownerId: string; revision: number; status: string; phase: string; questionIndex: number; serverNow: string; phaseEndsAt?: string; scheduleId?: string;
  members: { userId: string; displayName: string; team: number; ready: boolean; captain: boolean; scribe: boolean }[];
  question?: { id: string; prompt: string; reference: string; kind: string; partCount: number; points: number; durationSeconds: number } | null;
  draft: string[]; submitted: boolean; messages: { id: string; userId: string; displayName: string; text: string; createdAt: string }[];
  scores: { team: number; accuracyHundredths: number; speedHundredths: number; totalHundredths: number; availableHundredths?: number }[];
  results: { responseLockedAtMs?:number;responseLockedAtUtc?:string;attemptId?:string;dispute?:PbeResultReview;originalAccuracyHundredths?:number;questionId: string; prompt: string; reference: string; evidence: string; acceptedAnswers: string[][]; team: number; answers: string[]; accuracyHundredths: number; speedHundredths: number; availableHundredths?: number; elapsedMs: number; appealed: boolean; resolved: boolean }[];
  achievements: PracticeAward[]; isCoach: boolean;
  timingAnomalies?: { at: number; reason: string }[];
};
const base = (org: string) => `/api/v1/organizations/${encodeURIComponent(org)}/practice`;
const post = <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });
export const practiceApi = {
  simulationMaterial:(org:string,seasonId:string,roomId?:string)=>request<SimulationMaterial>(`${base(org)}/simulation/material?seasonId=${encodeURIComponent(seasonId)}${roomId?`&roomId=${encodeURIComponent(roomId)}`:""}`),
  simulationAvailability:(org:string,body:{seasonId:string;questionCount:number;teamSize:number;simulation:SimulationConfig;roomId?:string})=>post<{eligibleQuestions:number;requestedQuestions:number;canStart:boolean;reason:string|null}>(`${base(org)}/simulation/availability`,body),
  bootstrap: (org: string) => request<PracticeBootstrap>(`${base(org)}/bootstrap`),
  enabled: (org: string, enabled: boolean) => post<void>(`${base(org)}/enabled`, { enabled }),
  create: (org: string, body: { simulation?:SimulationConfig; format?: 'Arcade' | 'Pbe'; teamCount?: 1 | 2; seasonId: string; teamSize: number; questionCount: number; coached: boolean; bookKey?: string }) => post<PracticeRoom>(`${base(org)}/rooms`, body),
  room: (org: string, id: string) => request<PracticeRoom>(`${base(org)}/rooms/${encodeURIComponent(id)}`),
  command: (org: string, id: string, command: PracticeCommand) => post<PracticeRoom>(`${base(org)}/rooms/${encodeURIComponent(id)}/commands`, command),
  accept: (org: string, id: string, team?: number) => post<PracticeRoom>(`${base(org)}/invitations/${encodeURIComponent(id)}/accept`, { team }),
  import: (org: string, seasonId: string, questions: PracticeQuestion[]) => post<void>(`${base(org)}/questions/import`, { seasonId, questions }),
  publish: (org: string, id: string) => post<void>(`${base(org)}/questions/${encodeURIComponent(id)}/publish`, {}),
};

// Coach-only authoring DTOs. These keys never belong in learner bootstrap data.
export type PbeTargetView = { id:string; label:string; skill:'FactualRecall'|'ExactWords' };
export type PbeTarget = PbeTargetView & {sourceUnitIds:string[]};
export type PbeAuthorQuestion = {schemaVersion:2;id:string;version:number;contentPackId:string;sourceUnitId:string;sourceUnitIds:string[];sourceKind:'Scripture'|'Commentary';reference:string;evidence:string;kind:'ShortAnswer'|'List'|'ExactWords'|'TrueFalse';prompt:string;ordered:boolean;parts:{targetId:string;acceptedAnswers:string[];points:number}[]};
export type PbeSource = {id:string;contentPackId:string;sourceKind:'Scripture'|'Commentary';bookKey:string;chapter:number|null;verse:number|null;citation:string;canonicalText:string};
export type PbeAuthoring = {sources:PbeSource[];selectedBookKeys:string[];pbeEnabled:boolean;members:{id:string;displayName:string}[];membersNextCursor:string|null};
export type PbeBank = {questionCount:number;targetCount:number;sourceUnitCount:number;missingSourceUnitIds:string[];uncoveredTargets:number;singleVariantTargets:number};
export type PbeQuestionRecord = {id:string;seasonId:string;published:boolean;publishedHeadVersion:number|null;question:PbeAuthorQuestion};
export type PbeIntroduction = {id:string;bookKey:string;sourceEdition:string;title:string;citation:string;licensingStatus:string;reviewed:boolean;units:{id:string;citation:string;canonicalText:string}[];revision:number;assignedStudentIds:string[]};
type Page<T> = {items:T[];nextCursor:string|null};
const pbeBase=(org:string,season:string)=>`${base(org)}/pbe/seasons/${encodeURIComponent(season)}`;
export const pbeApi = {
 authoring:(org:string,season:string,after='')=>request<PbeAuthoring>(`${pbeBase(org,season)}/authoring?membersAfter=${encodeURIComponent(after)}`),
 bank:(org:string,season:string)=>request<PbeBank>(`${pbeBase(org,season)}/bank`),
 targets:(org:string,season:string,after='')=>request<Page<PbeTarget>>(`${pbeBase(org,season)}/targets?limit=100&after=${encodeURIComponent(after)}`),
 questions:(org:string,season:string,after='')=>request<Page<PbeQuestionRecord>>(`${pbeBase(org,season)}/questions?limit=100&after=${encodeURIComponent(after)}`),
 declare:(org:string,season:string,targets:PbeTarget[])=>post<void>(`${pbeBase(org,season)}/targets`,{targets}),
 import:(org:string,season:string,questions:PbeAuthorQuestion[],targets:PbeTarget[])=>post<void>(`${pbeBase(org,season)}/questions/import`,{questions,targets}),
 publish:(org:string,season:string,id:string,version:number)=>post<void>(`${pbeBase(org,season)}/questions/${id}/${version}/publish`,{}),
 enabled:(org:string,season:string,enabled:boolean)=>post<void>(`${pbeBase(org,season)}/enabled`,{enabled}),
 introductions:(org:string,season:string)=>request<PbeIntroduction[]>(`${pbeBase(org,season)}/introductions`),
 createIntroduction:(org:string,season:string,input:{bookKey:string;sourceEdition:string;title:string;citation:string;licensingStatus:string;units:{citation:string;canonicalText:string}[]})=>post<PbeIntroduction>(`${pbeBase(org,season)}/introductions`,input),
 reviewIntroduction:(org:string,season:string,id:string,revision:number,reviewed:boolean)=>post<PbeIntroduction>(`${pbeBase(org,season)}/introductions/${id}/review`,{revision,reviewed}),
 assignIntroduction:(org:string,season:string,id:string,revision:number,studentIds:string[])=>post<PbeIntroduction>(`${pbeBase(org,season)}/introductions/${id}/assignments`,{revision,studentIds}),
};

export type PbeResultReview={id:string;status:'Pending'|'Resolved';revision:number;questionId?:string;questionVersion?:number;pointsByPart?:number[]|null};
export type PbeDispute={id:string;organizationId:string;seasonId:string;activity:'Solo'|'Team';sessionId:string;attemptId:string;questionId:string;questionVersion:number;team:number|null;status:'Pending'|'Resolved';reason:string;revision:number;partPoints:number[];sourceEvidence:string;question:PbeAuthorQuestion;answers:string[];originalPointsByPart:number[];acceptedAtUtc:string;resolution:{pointsByPart:number[];reason:string;resolvedBy:string;resolvedAtUtc:string}|null};
const disputeBase='/api/v1/pbe/disputes';
export const pbeDisputeApi={
 flag:(input:{activity:'Solo'|'Team';sessionId:string;attemptId:string;reason:string})=>post<PbeDispute>(disputeBase,input),
 queue:(after='')=>request<Page<PbeDispute>>(`${disputeBase}?after=${encodeURIComponent(after)}`),
 read:(id:string)=>request<PbeDispute>(`${disputeBase}/${encodeURIComponent(id)}`),
 resolve:(id:string,input:{expectedRevision:number;pointsByPart:number[];reason:string})=>post<PbeDispute>(`${disputeBase}/${encodeURIComponent(id)}/resolve`,input),
 replay:(id:string)=>post<{status:'Ready'|'Provisional';stage?:string}>(`${disputeBase}/${encodeURIComponent(id)}/replay`,{}),
};
