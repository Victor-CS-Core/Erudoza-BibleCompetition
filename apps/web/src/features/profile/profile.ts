import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";

export type MasteryHonorOption = { key: string; title: string; requirement: string; category: "Scripture" | "Team Practice" | "Simulation"; ruleVersion: "mastery-v1" | "simulation-v1"; earnedAtUtc: string | null };
export type MyProfile = { userId: string; displayName: string; avatarHonorKey: string | null; honors: MasteryHonorOption[] };
export type ProfileIdentity = { userId: string; avatarHonorKey: string | null };
export const profileApi = {
  me: (signal?: AbortSignal) => request<MyProfile>("/api/v1/profile/me", { signal }),
  avatar: (honorKey: string | null) => request<MyProfile>("/api/v1/profile/me/avatar", { method: "PUT", body: JSON.stringify({ honorKey }) }),
  identities: async (ids: string[]) => request<ProfileIdentity[]>(`/api/v1/profile/identities?${new URLSearchParams(ids.map(id => ["userId", id]))}`),
};
type Pending = { userId: string; signal: AbortSignal; resolve: (identity: ProfileIdentity) => void; reject: (reason: unknown) => void };
const batches = new WeakMap<QueryClient, Map<string, Pending[]>>();
/** Batch visible identities without retaining private results outside the authenticated query cache. */
export function batchIdentity(client: QueryClient, viewer: string, userId: string, signal: AbortSignal): Promise<ProfileIdentity> {
  let groups = batches.get(client);
  if (!groups) { groups = new Map(); batches.set(client, groups); }
  const existing = groups.get(viewer);
  return new Promise((resolve, reject) => {
    const entry = { userId, signal, resolve, reject };
    if (existing) { existing.push(entry); return; }
    const pending = [entry];
    groups.set(viewer, pending);
    queueMicrotask(() => {
      groups.delete(viewer);
      const active = pending.filter(item => {
        if (!item.signal.aborted) return true;
        item.reject(new DOMException("Identity request cancelled", "AbortError")); return false;
      });
      const ids = [...new Set(active.map(item => item.userId))];
      for (let offset = 0; offset < ids.length; offset += 50) {
        const chunk = ids.slice(offset, offset + 50);
        const entries = active.filter(item => chunk.includes(item.userId));
        void profileApi.identities(chunk).then(values => {
          const identities = new Map(values.map(value => [value.userId, value]));
          for (const item of entries) {
            if (item.signal.aborted) item.reject(new DOMException("Identity request cancelled", "AbortError"));
            else item.resolve(identities.get(item.userId) ?? { userId: item.userId, avatarHonorKey: null });
          }
        }, error => { for (const item of entries) item.reject(error); });
      }
    });
  });
}
export function useMyProfile() {
  const { me } = useAuth();
  return useQuery({ queryKey: ["profile", me?.organizationId, me?.userId], queryFn: ({ signal }) => profileApi.me(signal), enabled: !!me, staleTime: 0, refetchOnMount: "always" });
}
export function useProfileIdentity(userId: string) {
  const { me } = useAuth();
  const client = useQueryClient();
  return useQuery({
    queryKey: ["profile-identity", me?.organizationId, me?.userId, userId],
    queryFn: ({ signal }) => batchIdentity(client, `${me!.organizationId}:${me!.userId}`, userId, signal),
    enabled: !!me && !!userId, staleTime: 30_000, refetchInterval: 60_000, retry: false,
  });
}
export function useSetProfileAvatar() {
  const { me } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: profileApi.avatar,
    onMutate: async () => { const query = client.getQueryCache().find({ queryKey: ["profile", me?.organizationId, me?.userId], exact: true }); await Promise.all([client.cancelQueries({ queryKey: ["profile", me?.organizationId, me?.userId] }), client.cancelQueries({ queryKey: ["profile-identity", me?.organizationId, me?.userId, me?.userId] })]); return { query }; },
    onSuccess: (profile, _variables, context) => {
      if (profile.userId !== me?.userId || !context?.query || client.getQueryCache().find({ queryKey: ["profile", me?.organizationId, me?.userId], exact: true }) !== context.query) return;
      client.setQueryData(["profile", me?.organizationId, me?.userId], profile);
      client.setQueryData(["profile-identity", me?.organizationId, me?.userId, profile.userId], { userId: profile.userId, avatarHonorKey: profile.avatarHonorKey });
    },
  });
}
