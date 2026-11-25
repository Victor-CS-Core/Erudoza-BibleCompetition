// Profile CROSS-BOUNDARY render test (card 15): renders the real
// ProfilePage and NotificationBell from payloads the real worker emitted
// (captured by worker/native/capture-profile.test.ts into
// __fixtures__/profile-payloads.json; the header's "today" payload comes
// from capture-training.test.ts), so a server/client field drift fails HERE
// even if each side's own tests stay green — the Nov 24 Content-tab lesson,
// applied to the profile surface. Only useAuth is mocked (identity, not
// payload shape); the real api client and real components do the rest.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/ui";
import { ProfilePage } from "./ProfilePage";
import { NotificationBell } from "./NotificationBell";
import profileFixture from "./__fixtures__/profile-payloads.json";
import trainingFixture from "../student/__fixtures__/training-payloads.json";

type Captured = { status: number; body: never };
const profile = profileFixture as unknown as Record<string, Captured>;
const training = trainingFixture as unknown as Record<string, Captured>;
const meBody = profile.me.body as unknown as { userId: string; displayName: string; character: { slots: (string | null)[] } };
const filledSlots = meBody.character.slots.filter(Boolean).length;
const unreadSummary = (profile.notifications.body as unknown as { notifications: { summary: string; readAtUtc: string | null }[] }).notifications.find(n => !n.readAtUtc)!.summary;

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ me: { organizationId: "11111111-1111-4111-8111-111111111111", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Coach" } }),
}));

function route(rawUrl: string): { status: number; body: unknown } {
  const url = new URL(rawUrl, "https://erudoza.test");
  if (url.pathname === "/api/v1/profile/me") return profile.me;
  if (url.pathname === "/api/v1/profile/me/notifications") return profile.notifications;
  if (url.pathname === "/api/v1/profile/identities") return profile.identities;
  if (url.pathname === "/api/v1/progress/me/today") return training.today;
  return { status: 404, body: { detail: `unrouted ${url.pathname}` } };
}

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const { status, body } = route(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { cleanup(); });

it("renders the profile page from the real profile payload", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/profile"]}>
          <ProfilePage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  // Server-emitted identity + the earned patch title land on the page, and
  // the sash summary counts the character slots the server actually filled.
  expect((await screen.findAllByText(meBody.displayName)).length).toBeGreaterThan(0);
  expect(document.body.textContent).toContain("Exact Recall");
  expect(document.body.textContent).toContain(`${filledSlots} of 3 Achievement patches selected`);
  expect(document.body.textContent).not.toContain("Unable to load your profile");
}, 30000);

it("renders the notification bell from the real notifications payload", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/student"]}>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Notifications/ }));
  // The server-computed summary (never stored) is what the bell shows.
  expect(await screen.findByText(unreadSummary)).toBeTruthy();
}, 30000);
