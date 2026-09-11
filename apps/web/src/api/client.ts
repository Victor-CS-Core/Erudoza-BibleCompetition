import type {
  AttemptResult,
  TrainingDifficulty,
  ChallengeCard,
  ContentPack,
  ImportContentPackRequest,
  Me,
  Organization,
  Progress,
  ScriptureCatalog,
  Season,
  SeasonCoverage,
  Session,
  SessionSummary,
  SourceUnit,
  Student,
} from "./types";
import { apiUrl } from "./url";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSeconds?: number) { super(message); }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const problem = (await response.json()) as { detail?: string; title?: string };
      detail = problem.detail ?? problem.title ?? detail;
    } catch {
      // Problem Details may be absent for 401/403 redirects.
    }
    const retryHeader = response.headers.get("Retry-After");
    const retrySeconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
    throw new ApiError(detail, response.status, retrySeconds);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  library: (orgId: string) => request<import("./types").ScriptureLibrary>(`/api/v1/organizations/${orgId}/library`),
  login: (identifier: string, password: string) =>
    request<Me>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<Me>("/api/v1/me"),
  organization: (orgId: string) => request<Organization>(`/api/v1/organizations/${orgId}`),
  seasons: (orgId: string) => request<Season[]>(`/api/v1/organizations/${orgId}/seasons`),
  season: (orgId: string, seasonId: string) => request<Season>(`/api/v1/organizations/${orgId}/seasons/${seasonId}`),
  createSeason: (orgId: string, body: { name: string; yearLabel: string; ruleProfileKey: string }) =>
    request<Season>(`/api/v1/organizations/${orgId}/seasons`, { method: "POST", body: JSON.stringify(body) }),
  students: (orgId: string) => request<Student[]>(`/api/v1/organizations/${orgId}/students`),
  createStudent: (orgId: string, body: { userName: string; displayName: string; password: string }) =>
    request<Student>(`/api/v1/organizations/${orgId}/students`, { method: "POST", body: JSON.stringify(body) }),
  resetStudentPassword: (orgId: string, studentId: string, password: string) =>
    request<void>(`/api/v1/organizations/${orgId}/students/${studentId}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  deleteContentPack: (orgId: string, packId: string) => request<void>(`/api/v1/organizations/${orgId}/content-packs/${packId}`, { method: "DELETE" }),
  contentPacks: (orgId: string) => request<ContentPack[]>(`/api/v1/organizations/${orgId}/content-packs`),
  sourceUnits: (orgId: string, contentPackId: string) =>
    request<SourceUnit[]>(`/api/v1/organizations/${orgId}/content-packs/${contentPackId}/source-units`),
  importContentPack: (orgId: string, body: ImportContentPackRequest) =>
    request<ContentPack>(`/api/v1/organizations/${orgId}/content-packs/import`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  scriptureCatalog: (orgId: string) => request<ScriptureCatalog>(`/api/v1/organizations/${orgId}/scripture-catalog`),
  scriptureBooks: (orgId: string, translationId: string) => request<{ bookKey: string; name: string }[]>(`/api/v1/organizations/${orgId}/scripture-catalog/books?translationId=${encodeURIComponent(translationId)}`),
  scriptureChapters: (orgId: string, translationId: string, bookKey: string) => request<{ chapters: number[]; maxChaptersPerImport: number }>(`/api/v1/organizations/${orgId}/scripture-catalog/books/${encodeURIComponent(bookKey)}/chapters?translationId=${encodeURIComponent(translationId)}`),
  importFromCatalog: (
    orgId: string,
    body: { translationId: string; bookKey: string; startChapter: number; endChapter: number },
  ) =>
    request<ContentPack>(`/api/v1/organizations/${orgId}/content-packs/import-from-catalog`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  seasonScope: (orgId: string, seasonId: string) => request<import("./types").SeasonScope>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/scope`),
  defineScope: (
    orgId: string,
    seasonId: string,
    body: import("./types").SeasonScope,
  ) => request<void>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/scope`, { method: "POST", body: JSON.stringify(body) }),
  assignments: (orgId: string, seasonId: string) =>
    request<import("./types").Assignment[]>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/assignments`),
  assign: (
    orgId: string,
    seasonId: string,
    body: {
      studentUserId: string;
      difficulty?: TrainingDifficulty;
      type: string;
      contentPackId: string;
      range: { bookKey: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number };
    },
  ) => request<import("./types").Assignment>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/assignments`, { method: "POST", body: JSON.stringify(body) }),
  activate: (orgId: string, seasonId: string) =>
    request<{ activated: boolean; blockingProblems: string[] }>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/activate`, { method: "POST" }),
  startSession: (seasonId: string, mode: "Practice" | "Simulation" | "Review" = "Practice") =>
    request<Session>("/api/v1/study/sessions", { method: "POST", body: JSON.stringify({ seasonId, mode }) }),
  resumeSession: (sessionId: string) => request<import("./types").ResumedSession>(`/api/v1/study/sessions/${sessionId}`),
  nextCard: (sessionId: string) => request<ChallengeCard>(`/api/v1/study/sessions/${sessionId}/next`),
  submitAttempt: (
    sessionId: string,
    body: { clientSubmissionId: string; challengeCardId: string; submittedAnswer: string; responseTimeMs: number; hintsUsed: boolean },
  ) => request<AttemptResult>(`/api/v1/study/sessions/${sessionId}/attempts`, { method: "POST", body: JSON.stringify(body) }),
  completeSession: (sessionId: string) =>
    request<SessionSummary>(`/api/v1/study/sessions/${sessionId}/complete`, { method: "POST" }),
  setDifficulty: (orgId: string, seasonId: string, studentId: string, difficulty: TrainingDifficulty) =>
    request<{ difficulty: TrainingDifficulty }>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/students/${studentId}/difficulty`, { method: "PUT", body: JSON.stringify({ difficulty }) }),
  assignedSeasons: () => request<{ id: string; name: string }[]>("/api/v1/progress/me/seasons"),
  progress: (seasonId?: string) => request<Progress>(`/api/v1/progress/me${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ""}`),
  studentProgress: (orgId: string, seasonId: string, studentId: string) =>
    request<Progress>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/students/${studentId}/progress`),
  coverage: (orgId: string, seasonId: string) =>
    request<SeasonCoverage>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/coverage`),
};
