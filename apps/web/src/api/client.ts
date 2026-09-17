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
  StudentDashboard,
} from "./types";
import { apiUrl } from "./url";
import type { StartTrainingContext } from "./trainingTypes";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfterSeconds?: number, public readonly code?: string) { super(message); }
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
    let code: string | undefined;
    try {
      const problem = (await response.json()) as { detail?: string; title?: string; message?: string; code?: unknown };
      detail = problem.detail ?? problem.title ?? problem.message ?? detail;
      code = typeof problem.code === 'string' ? problem.code : /^PBE_[A-Z0-9_]+$/.test(detail) ? detail : undefined;
    } catch {
      // Problem Details may be absent for 401/403 redirects.
    }
    const retryHeader = response.headers.get("Retry-After");
    const retrySeconds = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
    throw new ApiError(detail, response.status, retrySeconds, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  notebook: (orgId: string) => request<import('./types').StudyNotebook>(`/api/v1/organizations/${orgId}/library/notebook`),
  saveNotebookEntry: (orgId: string, id: string, version: number, entry: import('./types').NotebookEntryInput) => request<import('./types').StudyNotebook>(`/api/v1/organizations/${orgId}/library/notebook/entries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ version, entry }) }),
  deleteNotebookEntry: (orgId: string, id: string, version: number) => request<import('./types').StudyNotebook>(`/api/v1/organizations/${orgId}/library/notebook/entries/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' }),
  library: (orgId: string) => request<import("./types").ScriptureLibrary>(`/api/v1/organizations/${orgId}/library`),
  libraryChapter: (orgId: string, contentPackId: string, chapter: number) => request<SourceUnit[]>(`/api/v1/organizations/${orgId}/library/books/${encodeURIComponent(contentPackId)}/chapters/${chapter}`),
  login: (identifier: string, password: string) =>
    request<Me>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  logout: () => request<void>("/api/v1/auth/logout", { method: "POST" }),
  me: () => request<Me>("/api/v1/me"),
  organization: (orgId: string) => request<Organization>(`/api/v1/organizations/${orgId}`),
  seasons: (orgId: string) => request<Season[]>(`/api/v1/organizations/${orgId}/seasons`),
  season: (orgId: string, seasonId: string) => request<Season>(`/api/v1/organizations/${orgId}/seasons/${seasonId}`),
  deleteSeason: (orgId: string, seasonId: string) => request<void>(`/api/v1/organizations/${orgId}/seasons/${seasonId}`, { method: "DELETE" }),
  createSeason: (orgId: string, body: { name: string; yearLabel: string; ruleProfileKey: string }) =>
    request<Season>(`/api/v1/organizations/${orgId}/seasons`, { method: "POST", body: JSON.stringify(body) }),
  students: (orgId: string) => request<Student[]>(`/api/v1/organizations/${orgId}/students`),
  studentDashboard: (orgId: string, studentId: string, signal?: AbortSignal) =>
    request<StudentDashboard>(`/api/v1/organizations/${orgId}/students/${encodeURIComponent(studentId)}/dashboard`, { signal }),
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
  assignments: (orgId: string, seasonId: string, signal?: AbortSignal) =>
    request<import("./types").Assignment[]>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/assignments`, { signal }),
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
    signal?: AbortSignal,
  ) => request<import("./types").Assignment>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/assignments`, { method: "POST", body: JSON.stringify(body), signal }),
  myAssignments: (orgId: string, seasonId: string, signal?: AbortSignal) => request<import("./types").Assignment[]>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/my-assignments`, { signal }),
  notifications: () => request<import("./types").NotificationList>("/api/v1/profile/me/notifications"),
  markNotificationsRead: () => request<{ unreadCount: number }>("/api/v1/profile/me/notifications/read", { method: "POST" }),  assignMyself: (orgId: string, seasonId: string, body: { difficulty?: TrainingDifficulty; type: string; contentPackId: string; range: import("./types").PassageRange }, signal?: AbortSignal) => request<import("./types").Assignment>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/my-assignments`, { method: "POST", body: JSON.stringify(body), signal }),
  removeMyAssignment: (orgId: string, seasonId: string, assignmentId: string) => request<void>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/my-assignments/${assignmentId}`, { method: "DELETE" }),
  activate: (orgId: string, seasonId: string) =>
    request<{ activated: boolean; blockingProblems: string[] }>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/activate`, { method: "POST" }),
  startSession: (seasonId: string, mode: "Practice" | "Simulation" | "Review" = "Practice", training?: StartTrainingContext, format: "Memory" | "Pbe" = "Memory", memoryChallenge?: "Warmup" | "Advanced", selection?: import("./pbeTypes").PbeSessionSelection) =>
    request<Session>("/api/v1/study/sessions", { method: "POST", body: JSON.stringify({ seasonId, mode, format, ...(memoryChallenge ? {memoryChallenge} : {}), ...(training ? { training } : {}), ...selection }) }),
  nextPbeCard: (sessionId:string) => request<import('./pbeTypes').PbeSessionCard>(`/api/v1/study/sessions/${sessionId}/next`),
  submitPbeAttempt: (sessionId:string, body:import('./pbeTypes').PbeSubmission) => request<import('./pbeTypes').PbeAttemptResult>(`/api/v1/study/sessions/${sessionId}/attempts`,{method:'POST',body:JSON.stringify(body)}),
  pbeTimed: (sessionId:string, body:unknown) => request<import('./pbeTypes').PbePresentationState|import('./pbeTypes').PbeTimedReceipt>(`/api/v1/study/sessions/${sessionId}/timed`,{method:'POST',body:JSON.stringify(body)}),
  pbeTimedStatus: (sessionId:string, questionId?:string) => request<import('./pbeTypes').PbePresentationState|import('./pbeTypes').PbeTimedReceipt|import('./pbeTypes').PbeInterruptionStatus>(`/api/v1/study/sessions/${sessionId}/timed${questionId?`?questionId=${encodeURIComponent(questionId)}`:''}`),
  pbeSource: (sessionId:string, challengeCardId:string) => request<{assisted:true;sources:{citation:string;canonicalText:string}[]}>(`/api/v1/study/sessions/${sessionId}/source`,{method:'POST',body:JSON.stringify({challengeCardId})}),
  resumeSession: (sessionId: string) => request<import("./types").ResumedSession>(`/api/v1/study/sessions/${sessionId}`),
  nextCard: (sessionId: string) => request<ChallengeCard>(`/api/v1/study/sessions/${sessionId}/next`),
  submitAttempt: (
    sessionId: string,
    body: import('./types').SubmitAttemptBody,
  ) => request<AttemptResult>(`/api/v1/study/sessions/${sessionId}/attempts`, { method: "POST", body: JSON.stringify(body) }),
  completeSession: (sessionId: string) =>
    request<SessionSummary>(`/api/v1/study/sessions/${sessionId}/complete`, { method: "POST" }),
  setDifficulty: (orgId: string, seasonId: string, studentId: string, difficulty: TrainingDifficulty, signal?: AbortSignal) =>
    request<{ difficulty: TrainingDifficulty }>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/students/${studentId}/difficulty`, { method: "PUT", body: JSON.stringify({ difficulty }), signal }),
  assignedSeasons: () => request<{ id: string; name: string }[]>("/api/v1/progress/me/seasons"),
  progress: (seasonId?: string) => request<Progress>(`/api/v1/progress/me${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ""}`),
  studentProgress: (orgId: string, seasonId: string, studentId: string) =>
    request<Progress>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/students/${studentId}/progress`),
  coverage: (orgId: string, seasonId: string) =>
    request<SeasonCoverage>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/coverage`),
  pbeMaterials: (orgId: string) =>
    request<import("./types").PbeMaterialSummary[]>(`/api/v1/organizations/${orgId}/pbe-materials`),
  pbeMaterialCurrent: (orgId: string, seasonId: string) =>
    request<{ material: import("./types").PbeMaterial | null }>(`/api/v1/organizations/${orgId}/pbe-materials/current?seasonId=${encodeURIComponent(seasonId)}`),
  pbeReleases: (orgId: string) =>
    request<import("./types").PbeMaterialProposalSummary[]>(`/api/v1/organizations/${orgId}/pbe-materials/releases`),
  createPbeRelease: (orgId: string, body: { yearLabel: string; material: import("./types").PbeMaterialDraftPayload }) =>
    request<import("./types").PbeMaterialProposal>(`/api/v1/organizations/${orgId}/pbe-materials/releases`, { method: "POST", body: JSON.stringify(body) }),
  updatePbeRelease: (orgId: string, id: string, body: { yearLabel: string; material: import("./types").PbeMaterialDraftPayload }) =>
    request<import("./types").PbeMaterialProposal>(`/api/v1/organizations/${orgId}/pbe-materials/releases/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  pbeRelease: (orgId: string, id: string) =>
    request<{ proposal: import("./types").PbeMaterialProposal; diff: import("./types").PbeMaterialDiff; live: import("./types").PbeMaterial | null }>(`/api/v1/organizations/${orgId}/pbe-materials/releases/${encodeURIComponent(id)}`),
  reviewPbeRelease: (orgId: string, id: string, body: { decision: "approved" | "rejected"; note?: string }) =>
    request<import("./types").PbeMaterialProposal>(`/api/v1/organizations/${orgId}/pbe-materials/releases/${encodeURIComponent(id)}/review`, { method: "POST", body: JSON.stringify(body) }),
  watchNadMaterials: (orgId: string) =>
    request<import("./types").PbeMaterialWatchResult>(`/api/v1/organizations/${orgId}/pbe-materials/watch`, { method: "POST" }),
  pbeNews: (orgId: string) =>
    request<import("./types").PbeNewsArticleSummary[]>(`/api/v1/organizations/${orgId}/pbe-news`),
  pbeNewsArticle: (orgId: string, id: string) =>
    request<import("./types").PbeNewsArticle>(`/api/v1/organizations/${orgId}/pbe-news/${encodeURIComponent(id)}`),
  pbeNewsArticles: (orgId: string) =>
    request<import("./types").PbeNewsArticle[]>(`/api/v1/organizations/${orgId}/pbe-news/articles`),
  createPbeNewsArticle: (orgId: string, body: import("./types").PbeNewsArticleInput) =>
    request<import("./types").PbeNewsArticle>(`/api/v1/organizations/${orgId}/pbe-news/articles`, { method: "POST", body: JSON.stringify(body) }),
  updatePbeNewsArticle: (orgId: string, id: string, body: import("./types").PbeNewsArticleInput) =>
    request<import("./types").PbeNewsArticle>(`/api/v1/organizations/${orgId}/pbe-news/articles/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  publishPbeNewsArticle: (orgId: string, id: string) =>
    request<import("./types").PbeNewsArticle>(`/api/v1/organizations/${orgId}/pbe-news/articles/${encodeURIComponent(id)}/publish`, { method: "POST" }),
  unpublishPbeNewsArticle: (orgId: string, id: string) =>
    request<import("./types").PbeNewsArticle>(`/api/v1/organizations/${orgId}/pbe-news/articles/${encodeURIComponent(id)}/unpublish`, { method: "POST" }),
};
