import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import type { Me } from "../api/types";
import { AuthProvider, useAuth } from "./AuthContext";
vi.mock("../api/client", async importOriginal => ({ ...await importOriginal<typeof import("../api/client")>(), api: { me: vi.fn(), login: vi.fn(), logout: vi.fn() } }));
const user = (id: string) => ({ userId: id, organizationId: "org", displayName: id } as Me);
function Controls() {
  const auth = useAuth();
  return <><span>{auth.me?.userId ?? "anonymous"}</span><span>{auth.error}</span><button onClick={() => void auth.login("b", "password")}>Login B</button><button onClick={() => void auth.acceptSession(user("c"))}>Accept new session</button><button onClick={() => void auth.logout()}>Logout</button><button onClick={() => void auth.refresh()}>Refresh</button></>;
}
function setup() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 render(<QueryClientProvider client={client}><AuthProvider><Controls /></AuthProvider></QueryClientProvider>);
 return client;
}
beforeEach(() => { vi.resetAllMocks(); sessionStorage.clear(); vi.mocked(api.me).mockResolvedValue(user("a")); vi.mocked(api.login).mockResolvedValue(user("b")); vi.mocked(api.logout).mockResolvedValue(); });
it("clears previous private data before accepting an onboarding session", async () => {
 const client = setup(); await screen.findByText("a");
 client.setQueryData(["coaches", "old-club"], ["Private coach"]);
 sessionStorage.setItem("erudoza:attempt:old", "private answer");
 fireEvent.click(screen.getByText("Accept new session")); await screen.findByText("c");
 expect(client.getQueryCache().getAll()).toHaveLength(0);
 expect(sessionStorage.getItem("erudoza:attempt:old")).toBeNull();
});
it("clears private cache and pending answers on logout and account replacement", async () => {
 const client = setup(); await screen.findByText("a");
 client.setQueryData(["progress"], { seasonName: "Private A" }); sessionStorage.setItem("erudoza:attempt:session-a", "private answer"); sessionStorage.setItem("erudoza:pbe-attempt:session-a", "private PBE answer");
 fireEvent.click(screen.getByText("Logout")); await screen.findByText("anonymous");
 expect(client.getQueryCache().getAll()).toHaveLength(0); expect(sessionStorage.length).toBe(0);
 client.setQueryData(["assigned-seasons"], ["Private A"]);
 fireEvent.click(screen.getByText("Login B")); await screen.findByText("b");
 expect(client.getQueryCache().getAll()).toHaveLength(0);
});
it("cancels old in-flight reads so they cannot repopulate another account's cache", async () => {
 const client = setup(); await screen.findByText("a"); let resolve!: (value: string) => void;
 const pending = client.fetchQuery({ queryKey: ["progress"], queryFn: () => new Promise<string>(done => { resolve = done; }) }).catch(() => undefined);
 fireEvent.click(screen.getByText("Login B")); await screen.findByText("b");
 await act(async () => { resolve("Private A"); await pending; });
 expect(client.getQueryData(["progress"])).toBeUndefined();
});
it("retains identity during an outage and clears it only on an unauthorized response", async () => {
 const client = setup(); await screen.findByText("a");
 vi.mocked(api.me).mockRejectedValueOnce(new ApiError("Unavailable", 503));
 fireEvent.click(screen.getByText("Refresh")); await screen.findByText(/couldn’t reach/); expect(screen.getByText("a")).toBeInTheDocument();
 client.setQueryData(["progress"], "private"); sessionStorage.setItem("erudoza:pbe-attempt:session", "private answer"); vi.mocked(api.me).mockRejectedValueOnce(new ApiError("Unauthorized", 401));
 fireEvent.click(screen.getByText("Refresh")); await screen.findByText("anonymous");
 await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
 expect(sessionStorage.length).toBe(0);
});
it("ignores a late authentication refresh from the previous account", async () => {
 let resolve!: (value: Me) => void;
 vi.mocked(api.me).mockImplementationOnce(() => new Promise<Me>(done => { resolve = done; }));
 setup(); fireEvent.click(screen.getByText("Login B")); await screen.findByText("b");
 await act(async () => { resolve(user("a")); });
 expect(screen.getByText("b")).toBeInTheDocument(); expect(screen.queryByText("a")).not.toBeInTheDocument();
});
it.each([
 { userId: "different-user" }, { organizationId: "different-club" }, { role: "Student" as const }, { kind: "Student" as const },
])("clears private data when refresh changes account permissions: %j", async difference => {
 const client = setup(); await screen.findByText("a");
 client.setQueryData(["practice", "org"], { privateCoachQuestions: ["Coach answer"] });
 sessionStorage.setItem("erudoza:attempt:coach", "private answer");
 sessionStorage.setItem("erudoza:pbe-attempt:coach", "private PBE answer");
 vi.mocked(api.me).mockResolvedValue({ ...user("a"), ...difference });
 fireEvent.click(screen.getByText("Refresh"));
 await waitFor(() => expect(client.getQueryCache().getAll()).toHaveLength(0));
 expect(sessionStorage.getItem("erudoza:attempt:coach")).toBeNull();
 expect(sessionStorage.getItem("erudoza:pbe-attempt:coach")).toBeNull();
});
it("does not let a stale unauthorized refresh clear a newer accepted account", async () => {
 const client = setup(); await screen.findByText("a");
 let release!: () => void;
 const cancel = vi.spyOn(client, "cancelQueries").mockImplementationOnce(() => new Promise<void>(done => { release = done; }));
 vi.mocked(api.me).mockRejectedValueOnce(new ApiError("Unauthorized", 401));
 fireEvent.click(screen.getByText("Refresh")); await waitFor(() => expect(cancel).toHaveBeenCalled());
 fireEvent.click(screen.getByText("Accept new session")); await screen.findByText("c");
 client.setQueryData(["new-account"], "New private data");
 sessionStorage.setItem("erudoza:pbe-attempt:new-account", "New PBE answer");
 await act(async () => release());
 expect(screen.getByText("c")).toBeInTheDocument();
 expect(client.getQueryData(["new-account"])).toBe("New private data");
 expect(sessionStorage.getItem("erudoza:pbe-attempt:new-account")).toBe("New PBE answer");
 expect(sessionStorage.getItem("erudoza:attempt-owner")).toBe(JSON.stringify(["org", "c", null, null]));
});
it('retains pending Memory answers only after fresh authentication matches their recorded owner',async()=>{
 const owner=JSON.stringify([user('a').organizationId,user('a').userId,user('a').kind,user('a').role]);
 sessionStorage.setItem('erudoza:attempt-owner',owner);
 sessionStorage.setItem('erudoza:attempt:pending','saved original answer');
 sessionStorage.setItem('erudoza:pbe-attempt:pending','saved PBE answer');
 sessionStorage.setItem('erudoza:attempt:read:session:card','true');
 setup();await screen.findByText('a');
 expect(sessionStorage.getItem('erudoza:attempt:pending')).toBe('saved original answer');
 expect(sessionStorage.getItem('erudoza:pbe-attempt:pending')).toBe('saved PBE answer');
 expect(sessionStorage.getItem('erudoza:attempt:read:session:card')).toBe('true');
});
it.each([null,'unparseable',JSON.stringify(['org','other',null,null]),JSON.stringify(['other-org','a',null,null]),JSON.stringify(['org','a','Student',null]),JSON.stringify(['org','a',null,'Coach'])])('clears pending Memory answers on initial authentication for an unknown owner %s',async owner=>{
 if(owner!==null)sessionStorage.setItem('erudoza:attempt-owner',owner);
 sessionStorage.setItem('erudoza:attempt:pending','private other answer');
 sessionStorage.setItem('erudoza:pbe-attempt:pending','private PBE answer');
 setup();await screen.findByText('a');
 expect(sessionStorage.getItem('erudoza:attempt:pending')).toBeNull();
 expect(sessionStorage.getItem('erudoza:pbe-attempt:pending')).toBeNull();
});
