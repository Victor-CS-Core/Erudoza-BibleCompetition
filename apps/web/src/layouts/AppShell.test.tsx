import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { api } from "../api/client";
const account = vi.hoisted(() => ({ kind: "Student", role: "Owner" }));
const logout = vi.hoisted(() => vi.fn());
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ me: { ...account, userId: "user", organizationId: "org", displayName: "Daniel", organizationName: "Academy" }, logout }) }));
vi.mock("../api/client", () => ({ request: vi.fn().mockResolvedValue([]), api: { seasons: vi.fn(), students: vi.fn(), assignedSeasons: vi.fn(), season: vi.fn() } }));
function shell(path = "/student", variant: "student" | "admin" = "student") {
 return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AppShell variant={variant} /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
 account.kind = "Student"; vi.clearAllMocks(); logout.mockReset(); localStorage.clear(); sessionStorage.clear(); vi.mocked(api.seasons).mockResolvedValue([]); vi.mocked(api.students).mockResolvedValue([]); vi.mocked(api.assignedSeasons).mockResolvedValue([]);
 HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
 HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
});
it("keeps the selected season when switching student activities", () => {
 shell("/student/study?seasonId=season-two");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Team Practice" })).toHaveAttribute("href", "/student/practice?seasonId=season-two");
 expect(screen.getByTestId("study-back")).toHaveAttribute("href", "/student?seasonId=season-two");
});
it.each([["/student", "Training HQ"], ["/student/study", "Study"], ["/student/study?mode=Review", "Study"], ["/student/study?mode=Simulation", "Study"], ["/student/study?mode=Library", "Study"], ["/student/library", "Study"], ["/student/progress", "Progress"], ["/student/progress?tab=honors", "Progress"], ["/student/honors", "Progress"]])("marks only the correct navigation entry active for %s", (path, name) => {
 shell(path); const nav = screen.getByRole("navigation", { name: "Learner" });
 expect(within(nav).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
 expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it("offers student navigation during focused study without hiding it in a mobile menu", () => {
 shell("/student/study"); expect(screen.getByTestId("study-back")).toHaveAttribute("href", "/student");
 expect(screen.getByRole("button", { name: /^Search sections or actions$/ })).toBeInTheDocument();
 expect(within(screen.getByRole("navigation", { name: "Learner" })).getByRole("link", { name: "Study" })).toHaveAttribute("href", "/student/study");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Progress" })).toHaveAttribute("href", "/student/progress");
});
it("starts with the approved three student shortcuts and preserves saved pin choices", () => {
 const view = shell();
 const nav = screen.getByRole("navigation", { name: "Learner" });
 expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["Training HQ", "Study", "Progress"]);
 expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
 view.unmount();
 localStorage.setItem("erudoza:pins:org:user:student", JSON.stringify(["home", "practice", "honors"]));
 shell("/student/progress");
 expect(within(screen.getByRole("navigation", { name: "Learner" })).getAllByRole("link").map(link => link.textContent)).toEqual(["Training HQ", "Team Practice", "Progress"]);
});
it("shows five focused coach shortcuts by default with the rest grouped in Search", () => {
 account.kind = "Adult"; account.role = "Owner";
 shell("/admin/assignments", "admin"); const nav = screen.getByRole("navigation", { name: "Coach" });
 expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["Overview", "Seasons", "Students", "Assignments", "Team Practice"]);
 expect(within(nav).getByRole("link", { name: "Assignments" })).toHaveAttribute("aria-current", "page");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 const dialog = screen.getByRole("dialog");
 for (const name of ["Coaches", "Scripture library", "PBE materials", "PBE news", "Your profile"]) expect(within(dialog).getByRole("link", { name })).toBeInTheDocument();
 expect(within(dialog).queryByRole("button", { name: /^(Pin|Unpin) / })).not.toBeInTheDocument();
});
it("hides PBE materials, PBE news, and the invite-coach shortcut from admins in Search", () => {
 account.kind = "Adult"; account.role = "Admin";
 shell("/admin/assignments", "admin");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 const dialog = screen.getByRole("dialog");
 expect(within(dialog).queryByRole("link", { name: "PBE materials" })).not.toBeInTheDocument();
 expect(within(dialog).queryByRole("link", { name: "PBE news" })).not.toBeInTheDocument();
 expect(within(dialog).queryByRole("link", { name: "Invite a coach" })).not.toBeInTheDocument();
 expect(within(dialog).getByRole("link", { name: "Coaches" })).toBeInTheDocument();
});
it.each([
 ["/admin", ["overview", "seasons", "students"], "Overview", 3],
 ["/admin/seasons", ["students", "seasons", "overview"], "Seasons", 3],
 ["/admin/content", ["overview", "seasons", "library"], "More", 3],
 ["/admin/practice", ["library", "students"], "More", 3],
 ["/admin/coaches", [], "More", 1],
] as const)("keeps stable mobile Coach destinations without rewriting desktop pins: %s", (path, saved, expected, allCount) => {
 localStorage.setItem("erudoza:pins:org:user:coach", JSON.stringify(saved));
 shell(path, "admin");
 const nav = screen.getByRole("navigation", { name: "Coach" });
 const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
 expect(within(mobile).getAllByRole("link").map(link => link.textContent)).toEqual(["Overview", "Seasons", "Students"]);
 expect(mobile.querySelector('[aria-current="page"]')).toHaveTextContent(expected);
 expect(mobile.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
 expect(JSON.parse(localStorage.getItem("erudoza:pins:org:user:coach")!)).toEqual(saved);
 expect(within(nav).getAllByRole("link")).toHaveLength(allCount);
});
it("preserves the stable mobile dock when Coach pins change", () => {
 shell("/admin", "admin");
 const nav = screen.getByRole("navigation", { name: "Coach" });
 fireEvent.click(within(nav).getByRole("button", { name: "Unpin Overview" }));
 const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
 expect(within(mobile).getAllByRole("link").map(link => link.textContent)).toEqual(["Overview", "Seasons", "Students"]);
 expect(within(mobile).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
 expect(within(nav).getAllByRole("link")).toHaveLength(5);
 expect(JSON.parse(localStorage.getItem("erudoza:pins:org:user:coach")!)).toEqual(["seasons", "students", "assignments", "practice"]);
 expect(within(nav).getByRole("button", { name: "Pin Overview" })).toBeInTheDocument();
 fireEvent.click(within(nav).getByRole("link", { name: "Team Practice" }));
 expect(within(mobile).getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
 expect(within(nav).getByRole("link", { name: "Team Practice" })).toHaveAttribute("aria-current", "page");
 expect(within(nav).queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
});
it.each([
 ["/student?seasonId=season-two", "HQ"],
 ["/student/study?mode=Review&seasonId=season-two", "Study"],
 ["/student/study?mode=Simulation&seasonId=season-two", "Study"],
 ["/student/sessions/session-one/recap?seasonId=season-two", "Study"],
 ["/student/honors?seasonId=season-two", "Progress"],
 ["/student/practice/room-one?seasonId=season-two", "More"],
] as const)("keeps student mobile navigation and season context at %s", (path, selected) => {
 localStorage.setItem("erudoza:pins:org:user:student", JSON.stringify(["practice", "progress"]));
 shell(path);
 const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
 expect(within(mobile).getAllByRole("link").map(link => link.textContent)).toEqual(["HQ", "Study", "Progress"]);
 for (const link of within(mobile).getAllByRole("link")) expect(link.getAttribute("href")).toContain("seasonId=season-two");
 expect(mobile.querySelector('[aria-current="page"]')).toHaveTextContent(selected);
 expect(mobile.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it("opens all sections from More and restores focus when closed", async () => {
 shell("/student/practice");
 const more = within(screen.getByRole("navigation", { name: "Mobile navigation" })).getByRole("button", { name: "More" });
 fireEvent.click(more);
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Team Practice" })).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "Close command center" }));
 await waitFor(() => expect(more).toHaveFocus());
});
it.each([
 ["/admin/coaches", "admin", "Coach", "Coaches"],
 ["/student/progress", "student", "Learner", "Progress"],
] as const)("reveals the active shortcut after resize without overriding manual scrolling: %s", (path, variant, navName, activeName) => {
 const view = shell(path, variant);
 const nav = screen.getByRole("navigation", { name: navName });
 const current = within(nav).getByRole("link", { name: activeName }).parentElement!;
 // A desktop-visible destination moves outside the strip when the viewport narrows.
 const navBounds = vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({ left: 0, right: 300, width: 300 } as DOMRect);
 vi.spyOn(current, "getBoundingClientRect").mockImplementation(() => ({ left: 540 - nav.scrollLeft, right: 665 - nav.scrollLeft } as DOMRect));
 fireEvent.resize(window);
 expect(nav.scrollLeft).toBe(365);
 expect(current.getBoundingClientRect().right).toBeLessThanOrEqual(nav.getBoundingClientRect().right);
 // Scrolling the strip deliberately must not snap back to the active item.
 nav.scrollLeft = 30;
 fireEvent.scroll(nav);
 fireEvent.click(screen.getByRole("button", { name: "Account" }));
 expect(nav.scrollLeft).toBe(30);
 // Mobile browser chrome may resize height without changing strip width.
 fireEvent.resize(window);
 expect(nav.scrollLeft).toBe(30);
 view.unmount(); navBounds.mockClear(); fireEvent.resize(window);
 expect(navBounds).not.toHaveBeenCalled();
});
it("handles a sign-out failure without losing the current session", async () => {
 logout.mockRejectedValue(new Error("offline")); shell();
 fireEvent.click(screen.getByRole("button", { name: "Account" }));
 fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out");
 await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled());
});
it("keeps the active shortcut visible when unpinning moves it to the end", () => {
 shell();
 const nav = screen.getByRole("navigation", { name: "Learner" });
 const current = within(nav).getByRole("link", { name: "Training HQ" }).parentElement!;
 vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({ left: 0, right: 200, width: 200 } as DOMRect);
 vi.spyOn(current, "getBoundingClientRect").mockImplementation(() => {
  const left = [...nav.children].indexOf(current) * 150 - nav.scrollLeft;
  return { left, right: left + 150, width: 150 } as DOMRect;
 });
 fireEvent.click(within(nav).getByRole("button", { name: "Unpin Training HQ" }));
 expect(nav.scrollLeft).toBe(250);
 expect(within(nav).getByRole("button", { name: "Pin Training HQ" })).toBeInTheDocument();
});
it("searches sections but never lists individual students or seasons; keyboard navigation moves through results", async () => {
 vi.mocked(api.students).mockResolvedValue([{ userId: "sam", userName: "sam.student", displayName: "Sam Student", email: null }]);
 vi.mocked(api.seasons).mockResolvedValue([{ id: "fall", name: "Fall Championship" } as never]);
 shell("/admin", "admin"); fireEvent.keyDown(window, { key: "k", ctrlKey: true });
 const dialog = screen.getByRole("dialog", { name: "Command center" }); const input = within(dialog).getByRole("searchbox", { name: "Search navigation" });
 expect(input).toHaveFocus();
 fireEvent.change(input, { target: { value: "sam" } });
 expect(within(dialog).queryByRole("link", { name: /Sam Student/ })).not.toBeInTheDocument();
 expect(api.students).not.toHaveBeenCalled();
 fireEvent.change(input, { target: { value: "championship" } });
 expect(within(dialog).queryByRole("link", { name: /Fall Championship/ })).not.toBeInTheDocument();
 expect(api.seasons).not.toHaveBeenCalled();
 fireEvent.change(input, { target: { value: "team" } });
 const section = await within(dialog).findByRole("link", { name: "Team Practice" });
 fireEvent.keyDown(input, { key: "ArrowDown" }); expect(section).toHaveFocus();
});
it("keeps expanded groups between visits without exposing coach actions to students", async () => {
 const view = shell("/admin", "admin"); fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 fireEvent.click(screen.getByRole("button", { name: "Show Seasons options" })); expect(screen.getByRole("link", { name: "Create season" })).toHaveAttribute("href", "/admin/seasons/new");
 fireEvent.click(within(screen.getByRole("navigation", { name: "Coach" })).getByRole("button", { name: "Unpin Team Practice" }));
 fireEvent.click(screen.getByRole("button", { name: "Close command center" }));
 expect(within(screen.getByRole("navigation", { name: "Coach" })).queryByRole("link", { name: "Team Practice" })).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ })); expect(screen.getByRole("link", { name: "Create season" })).toBeInTheDocument();
 view.unmount(); shell(); fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 expect(screen.queryByRole("link", { name: "Create season" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Students" })).not.toBeInTheDocument();
 expect(api.students).not.toHaveBeenCalled();
});
it("renders section navigation without depending on the seasons query", async () => {
 vi.mocked(api.seasons).mockRejectedValue(new Error("offline")); shell("/admin", "admin");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Seasons" })).toHaveAttribute("href", "/admin/seasons");
 expect(api.seasons).not.toHaveBeenCalled();
});

it("lets a coach switch workspaces with the same season and learner assignment navigation", () => {
 account.kind = "Adult";
 shell("/student/study?seasonId=season-two");
 fireEvent.click(screen.getByRole("button", { name: "Account" }));
 expect(screen.getByRole("link", { name: "Switch to Coach mode" })).toHaveAttribute("href", "/admin?seasonId=season-two");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "My assignments" })).toHaveAttribute("href", "/student/assignments?seasonId=season-two");
});
it("does not offer student accounts a Coach mode switch or personal assignment management", () => {
 shell(); fireEvent.click(screen.getByRole("button", { name: "Account" }));
 expect(screen.queryByTestId("switch-workspace")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 expect(screen.queryByRole("link", { name: "My assignments" })).not.toBeInTheDocument();
});

it("restores the coach's learner season after navigating Coach tools", () => {
 account.kind = "Adult";
 const learner = shell("/student?seasonId=kept-season"); learner.unmount();
 shell("/admin/students", "admin"); fireEvent.click(screen.getByRole("button", { name: "Account" }));
 expect(screen.getByRole("link", { name: "Switch to Student mode" })).toHaveAttribute("href", "/student?seasonId=kept-season");
});

it("uses the open Coach season when switching to Student mode", () => {
 account.kind = "Adult"; vi.mocked(api.season).mockResolvedValue({ id: "open-season", name: "Open season" } as never); shell("/admin/seasons/open-season", "admin");
 fireEvent.click(screen.getByRole("button", { name: "Account" }));
 expect(screen.getByRole("link", { name: "Switch to Student mode" })).toHaveAttribute("href", "/student?seasonId=open-season");
});

it("keeps season context in planner commands and personal assignment search", async () => {
 account.kind = "Adult";
 shell("/admin/seasons/current?step=students", "admin");
 fireEvent.keyDown(window, { key: "k", ctrlKey: true });
 const dialog = screen.getByRole("dialog", { name: "Command center" });
 const input = within(dialog).getByRole("searchbox", { name: "Search navigation" });
 fireEvent.change(input, { target: { value: "Season & books" } });
 expect(within(dialog).getByRole("link", { name: /Season & books/ })).toHaveAttribute("href", "/admin/seasons/current?step=details");
 fireEvent.change(input, { target: { value: "My assignments" } });
 expect(within(dialog).getByRole("link", { name: /My assignments/ })).toHaveAttribute("href", "/student/assignments?seasonId=current");
});

it("remembers visited sections in a Quick access row instead of pins", () => {
 shell("/admin", "admin");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Team Practice" }));
 expect(JSON.parse(localStorage.getItem("erudoza:recent-sections:org:user:coach")!)).toEqual(["practice"]);
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 const dialog = screen.getByRole("dialog");
 const quick = within(dialog).getByRole("region", { name: "Quick access" });
 expect(within(quick).getByRole("link", { name: "Team Practice" })).toHaveAttribute("href", "/admin/practice");
});

it("groups learner destinations for student mode without coach sections", () => {
 shell("/student");
 fireEvent.click(screen.getByRole("button", { name: /^Search sections or actions$/ }));
 const dialog = screen.getByRole("dialog");
 const train = within(dialog).getByRole("region", { name: "Train" });
 for (const name of ["Training HQ", "Study", "Progress", "Team Practice"]) expect(within(train).getByRole("link", { name })).toBeInTheDocument();
 expect(within(dialog).getByRole("region", { name: "Resources" })).toBeInTheDocument();
 expect(within(dialog).queryByRole("link", { name: "Students" })).not.toBeInTheDocument();
 expect(within(dialog).queryByRole("link", { name: "Assignments" })).not.toBeInTheDocument();
 expect(within(dialog).queryByRole("button", { name: "Students" })).not.toBeInTheDocument();
});
