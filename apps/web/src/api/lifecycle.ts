import { request } from "./client";
import type { PassageRange } from "./types";

const seasonPath = (orgId: string, seasonId: string) => `/api/v1/organizations/${orgId}/seasons/${seasonId}`;
export const lifecycleApi = {
  removeAssignment: (orgId: string, seasonId: string, assignmentId: string) => request<void>(`${seasonPath(orgId, seasonId)}/assignments/${assignmentId}`, { method: "DELETE" }),
  correctAssignment: (orgId: string, seasonId: string, assignmentId: string, range: PassageRange) => request<void>(`${seasonPath(orgId, seasonId)}/assignments/${assignmentId}/passage`, { method: "PUT", body: JSON.stringify(range) }),
  transitionSeason: (orgId: string, seasonId: string, action: "close" | "archive") => request<void>(`${seasonPath(orgId, seasonId)}/${action}`, { method: "POST" }),
  setStudentActive: (orgId: string, studentId: string, isActive: boolean) => request<void>(`/api/v1/organizations/${orgId}/students/${studentId}/state`, { method: "PUT", body: JSON.stringify({ isActive }) }),
};
