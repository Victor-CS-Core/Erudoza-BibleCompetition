import type {
  AttemptResult,
  ChallengeCard,
  ContentPack,
  Me,
  Organization,
  Progress,
  Season,
  Session,
  Student,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
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
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
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
  contentPacks: (orgId: string) => request<ContentPack[]>(`/api/v1/organizations/${orgId}/content-packs`),
  defineScope: (
    orgId: string,
    seasonId: string,
    body: {
      contentPackId: string;
      includes: { bookKey: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number }[];
      excludes: { bookKey: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number }[];
    },
  ) => request<void>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/scope`, { method: "POST", body: JSON.stringify(body) }),
  assignments: (orgId: string, seasonId: string) =>
    request<import("./types").Assignment[]>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/assignments`),
  assign: (
    orgId: string,
    seasonId: string,
    body: {
      studentUserId: string;
      type: string;
      contentPackId: string;
      range: { bookKey: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number };
    },
  ) => request<import("./types").Assignment>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/assignments`, { method: "POST", body: JSON.stringify(body) }),
  activate: (orgId: string, seasonId: string) =>
    request<{ activated: boolean; blockingProblems: string[] }>(`/api/v1/organizations/${orgId}/seasons/${seasonId}/activate`, { method: "POST" }),
  startSession: (seasonId: string) =>
    request<Session>("/api/v1/study/sessions", { method: "POST", body: JSON.stringify({ seasonId, mode: "Practice" }) }),
  nextCard: (sessionId: string) => request<ChallengeCard>(`/api/v1/study/sessions/${sessionId}/next`),
  submitAttempt: (
    sessionId: string,
    body: { clientSubmissionId: string; challengeCardId: string; submittedAnswer: string; responseTimeMs: number; hintsUsed: boolean },
  ) => request<AttemptResult>(`/api/v1/study/sessions/${sessionId}/attempts`, { method: "POST", body: JSON.stringify(body) }),
  completeSession: (sessionId: string) => request<void>(`/api/v1/study/sessions/${sessionId}/complete`, { method: "POST" }),
  progress: () => request<Progress>("/api/v1/progress/me"),
};
