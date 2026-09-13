import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { batchIdentity, profileApi, type MyProfile } from "./profile";
import { ProfilePage } from "./ProfilePage";
import { ProfileAvatar } from "./ProfileAvatar";
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "self", organizationId: "academy", organizationName: "Academy", displayName: "Anna Reed" } }) }));
const catalog: MyProfile = { userId: "self", displayName: "Anna Reed", avatarHonorKey: null, honors: [
  { key: "solo:exact-recall", title: "Exact Recall", category: "Scripture", requirement: "Reach 90 on 12 distinct passages.", ruleVersion: "mastery-v1", earnedAtUtc: "2026-09-11T12:00:00Z" },
  { key: "solo:full-coverage", title: "Full Coverage", category: "Scripture", requirement: "Master all 30 assigned passages.", ruleVersion: "mastery-v1", earnedAtUtc: null },
] };
beforeEach(() => { vi.restoreAllMocks(); });
describe("shared profile identity", () => {
  it("batches visible identities, deduplicates and caps requests at 50", async () => {
    const lookup = vi.spyOn(profileApi, "identities").mockImplementation(async ids => ids.map(userId => ({ userId, avatarHonorKey: null })));
    const client = new QueryClient(), signal = new AbortController().signal;
    await Promise.all(Array.from({ length: 121 }, (_, i) => batchIdentity(client, "academy:self", String(i % 101), signal)));
    expect(lookup.mock.calls.map(call => call[0].length)).toEqual([50, 50, 1]);
  });
  it("isolates viewer batches and never resolves cancelled private requests", async () => {
    const lookup = vi.spyOn(profileApi, "identities").mockResolvedValue([]);
    const client = new QueryClient(), cancelled = new AbortController();
    const old = batchIdentity(client, "old:viewer", "one", cancelled.signal); cancelled.abort();
    const rejection = expect(old).rejects.toMatchObject({ name: "AbortError" });
    await batchIdentity(client, "new:viewer", "two", new AbortController().signal); await rejection;
    expect(lookup).toHaveBeenCalledExactlyOnceWith(["two"]);
  });
  it("keeps unearned options locked and updates every visible identity after selecting and resetting", async () => {
    vi.spyOn(profileApi, "me").mockResolvedValue(structuredClone(catalog));
    vi.spyOn(profileApi, "identities").mockResolvedValue([{ userId: "self", avatarHonorKey: null }]);
    const save = vi.spyOn(profileApi, "avatar").mockImplementation(async avatarHonorKey => ({ ...catalog, avatarHonorKey }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><ProfileAvatar userId="self" displayName="Anna Reed" /><ProfilePage /></QueryClientProvider>);
    expect(await screen.findByRole("button", { name: "Use Full Coverage as profile image" })).toBeDisabled();
    expect(screen.getByText("Master all 30 assigned passages.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Use Exact Recall as profile image" }));
    await waitFor(() => expect(view.container.querySelectorAll('[data-profile-honor="solo:exact-recall"]')).toHaveLength(2));
    expect(save).toHaveBeenCalledWith("solo:exact-recall", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Use initials" }));
    await waitFor(() => expect(view.container.querySelectorAll("[data-profile-honor]")).toHaveLength(0));
    expect(save).toHaveBeenLastCalledWith(null, expect.anything());
  });

  it("does not let an old save overwrite a recreated same-account profile query", async () => {
    vi.spyOn(profileApi, "me").mockResolvedValue(structuredClone(catalog));
    vi.spyOn(profileApi, "identities").mockResolvedValue([]);
    let finish!: (value: MyProfile) => void;
    const save = vi.spyOn(profileApi, "avatar").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><ProfilePage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Use Exact Recall as profile image" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    view.unmount();
    client.clear();
    const key = ["profile", "academy", "self"];
    client.setQueryData(key, { ...catalog, avatarHonorKey: null });
    await act(async () => { finish({ ...catalog, avatarHonorKey: "solo:exact-recall" }); });
    expect(client.getQueryData<MyProfile>(key)?.avatarHonorKey).toBeNull();
  });
  it("refreshes a previously viewed collection when returning after earning an Honor", async () => {
    const me = vi.spyOn(profileApi, "me").mockResolvedValue(structuredClone(catalog));
    vi.spyOn(profileApi, "identities").mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["profile", "academy", "self"], { ...catalog, honors: catalog.honors.map(honor => ({ ...honor, earnedAtUtc: null })) });
    render(<QueryClientProvider client={client}><ProfilePage /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Exact Recall as profile image" })).toBeEnabled());
    expect(me).toHaveBeenCalled();
  });
  it("retains initials and reports a server rejection without pretending the image was saved", async () => {
    vi.spyOn(profileApi, "me").mockResolvedValue(structuredClone(catalog));
    vi.spyOn(profileApi, "identities").mockResolvedValue([]);
    vi.spyOn(profileApi, "avatar").mockRejectedValue(new Error("Earn this Honor before selecting it."));
    const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProfilePage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Use Exact Recall as profile image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Earn this Honor before selecting it.");
    expect(view.container.querySelector("[data-profile-honor]")).toBeNull();
  });
});

describe('profile patch publication refresh',()=>{
 it('refreshes a newly published simulation patch on a bounded page schedule',async()=>{
  vi.useFakeTimers();
  const locked={...catalog,honors:[{key:'simulation:first-rehearsal',title:'First Rehearsal',category:'Simulation' as const,ruleVersion:'simulation-v1' as const,requirement:'Complete one simulation.',earnedAtUtc:null as string|null}]};
  const read=vi.spyOn(profileApi,'me').mockResolvedValueOnce(locked).mockResolvedValue({...locked,honors:[{...locked.honors[0],earnedAtUtc:'2026-09-13T00:00:00Z'}]});
  vi.spyOn(profileApi,'identities').mockResolvedValue([{userId:'self',avatarHonorKey:null}]);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=render(<QueryClientProvider client={client}><ProfilePage/></QueryClientProvider>);
  try{
   await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
   expect(screen.getByRole('button',{name:'Use First Rehearsal as profile image'})).toBeDisabled();
   await act(async()=>{await vi.advanceTimersByTimeAsync(2100);});
   expect(screen.getByRole('button',{name:'Use First Rehearsal as profile image'})).toBeEnabled();
   await act(async()=>{await vi.advanceTimersByTimeAsync(21000);});
   const calls=read.mock.calls.length;
   await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
   expect(read).toHaveBeenCalledTimes(calls);
   fireEvent.click(screen.getByRole('button',{name:'Refresh patches'}));
   await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
   expect(read).toHaveBeenCalledTimes(calls+1);
  }finally{view.unmount();client.clear();vi.useRealTimers();}
 });
});
