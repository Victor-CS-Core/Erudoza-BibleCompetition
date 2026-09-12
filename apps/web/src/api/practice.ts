import { request } from "./client";

export type PracticeCommand = { commandId: string; revision: number; action: string; targetUserId?: string; otherUserId?: string; team?: number; text?: string; answers?: string[]; scheduleId?: string; questionId?: string; points?: number };
export type PracticeQuestion = { id?: string; contentPackId: string; sourceUnitId: string; prompt: string; kind: string; parts: { acceptedAnswers: string[]; points: number }[]; ordered: boolean; evidence: string; reference: string; version: number };
export type PracticeAward = { key: string; title: string; seasonId: string };
export type RoomSummary = { id: string; seasonId: string; teamSize: number; questionCount: number; coached: boolean; status: string; memberCount: number; ownerId: string };
export type PracticeTrend = { seasonId: string; teamSize: number; bookKey: string | null; ruleVersion: string; matches: number; wins: number; draws: number; accuracyHundredths: number; speedHundredths: number; availableHundredths: number; unansweredQuestions: number; averageResponseMs: number; distinctQuestions: number; distinctPassages: number; participatedQuestions: number };
export type PracticeBootstrap = { trends?: PracticeTrend[]; enabled: boolean; seasons: { id: string; name: string }[]; players: { id: string; displayName: string }[]; rooms: RoomSummary[]; invitations: { id: string; roomId: string; team?: number; inviterName: string; expiresAt: string }[]; achievements: PracticeAward[]; questions: { id: string; seasonId: string; published: boolean; question: PracticeQuestion }[] };
export type PracticeRoom = {
  coachId?: string | null;
  id: string; seasonId: string; teamSize: number; questionCount: number; coached: boolean; ownerId: string; revision: number; status: string; phase: string; questionIndex: number; serverNow: string; phaseEndsAt?: string; scheduleId?: string;
  members: { userId: string; displayName: string; team: number; ready: boolean; captain: boolean; scribe: boolean }[];
  question?: { id: string; prompt: string; reference: string; kind: string; partCount: number; points: number; durationSeconds: number };
  draft: string[]; submitted: boolean; messages: { id: string; userId: string; displayName: string; text: string; createdAt: string }[];
  scores: { team: number; accuracyHundredths: number; speedHundredths: number; totalHundredths: number }[];
  results: { questionId: string; prompt: string; reference: string; evidence: string; acceptedAnswers: string[][]; team: number; answers: string[]; accuracyHundredths: number; speedHundredths: number; elapsedMs: number; appealed: boolean; resolved: boolean }[];
  achievements: PracticeAward[]; isCoach: boolean;
  timingAnomalies?: { at: number; reason: string }[];
};
const base = (org: string) => `/api/v1/organizations/${encodeURIComponent(org)}/practice`;
const post = <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });
export const practiceApi = {
  bootstrap: (org: string) => request<PracticeBootstrap>(`${base(org)}/bootstrap`),
  enabled: (org: string, enabled: boolean) => post<void>(`${base(org)}/enabled`, { enabled }),
  create: (org: string, body: { seasonId: string; teamSize: number; questionCount: number; coached: boolean; bookKey?: string }) => post<PracticeRoom>(`${base(org)}/rooms`, body),
  room: (org: string, id: string) => request<PracticeRoom>(`${base(org)}/rooms/${encodeURIComponent(id)}`),
  command: (org: string, id: string, command: PracticeCommand) => post<PracticeRoom>(`${base(org)}/rooms/${encodeURIComponent(id)}/commands`, command),
  accept: (org: string, id: string, team?: number) => post<PracticeRoom>(`${base(org)}/invitations/${encodeURIComponent(id)}/accept`, { team }),
  import: (org: string, seasonId: string, questions: PracticeQuestion[]) => post<void>(`${base(org)}/questions/import`, { seasonId, questions }),
  publish: (org: string, id: string) => post<void>(`${base(org)}/questions/${encodeURIComponent(id)}/publish`, {}),
};
