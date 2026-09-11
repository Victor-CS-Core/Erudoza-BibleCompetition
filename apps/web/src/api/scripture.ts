import { request } from "./client";
import type { SourceUnit } from "./types";

export interface AssignedScripture {
  seasonId: string;
  verses: SourceUnit[];
}

export const scriptureApi = {
  assigned: (seasonId: string) => request<AssignedScripture>(`/api/v1/study/seasons/${encodeURIComponent(seasonId)}/scripture`),
};
