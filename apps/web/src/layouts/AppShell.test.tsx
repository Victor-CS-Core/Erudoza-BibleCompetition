import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { api } from "../api/client";
const logout = vi.hoisted(() => vi.fn());
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ me: { userId: "user", organizationId: "org", displayName: "Daniel", organizationName: "Academy" }, logout }) }));
vi.mock("../api/client", () => ({ api: { seasons: vi.fn(), students: vi.fn(), assignedSeasons: vi.fn(), season: vi.fn() } }));
function shell(path = "/student", variant: "student" | "admin" = "student") {
 return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AppShell variant={variant} /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
 vi.clearAllMocks(); logout.mockReset(); localStorage.clear(); vi.mocked(api.seasons).mockResolvedValue([]); vi.mocked(api.students).mockResolvedValue([]); vi.mocked(api.assignedSeasons).mockResolvedValue([]);
 HTMLDialogElement.prototype.showModal = function() { this.setAttribute("open", ""); };
 HTMLDialogElement.prototype.close = function() { this.removeAttribute("open"); };
});
it("keeps the selected season when switching student activities", () => {
 shell("/student/study?seasonId=season-two");
 fireEvent.click(screen.getByRole("button", { name: "All sections" }));
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/student/study?mode=Review&seasonId=season-two");
 expect(screen.getByTestId("study-back")).toHaveAttribute("href", "/student?seasonId=season-two");
});
it.each([["/student", "Training HQ"], ["/student/study", "Study"], ["/student/study?mode=Review", "Review"], ["/student/study?mode=Simulation", "Simulation"], ["/student/progress", "Progress"]])("marks only the correct navigation entry active for %s", (path, name) => {
 shell(path); const nav = screen.getByRole("navigation", { name: "Learner" });
 expect(within(nav).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
 expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});
it("offers student navigation during focused study without hiding it in a mobile menu", () => {
 shell("/student/study"); expect(screen.getByTestId("study-back")).toHaveAttribute("href", "/student");
 expect(screen.getByRole("button", { name: "All sections" })).toBeInTheDocument();
 expect(within(screen.getByRole("navigation", { name: "Learner" })).getByRole("link", { name: "Study" })).toHaveAttribute("href", "/student/study");
 fireEvent.click(screen.getByRole("button", { name: "All sections" }));
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Progress" })).toHaveAttribute("href", "/student/progress");
});
it("starts with the approved three student shortcuts and preserves saved pin choices", () => {
 const view = shell();
 const nav = screen.getByRole("navigation", { name: "Learner" });
 expect(within(nav).getAllByRole("link").map(link => link.textContent)).toEqual(["Training HQ", "Study", "Honors"]);
 expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
 view.unmount();
 localStorage.setItem("erudoza:pins:org:user:student", JSON.stringify(["home", "review", "practice"]));
 shell("/student/progress");
 expect(within(screen.getByRole("navigation", { name: "Learner" })).getAllByRole("link").map(link => link.textContent)).toEqual(["Training HQ", "Review", "Team Practice", "Progress"]);
});
it("keeps all coach tools directly navigable", () => {
 shell("/admin/assignments", "admin"); const nav = screen.getByRole("navigation", { name: "Coach" });
 for (const name of ["Overview", "Seasons", "Students", "Assignments", "Scripture library"]) expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
 expect(within(nav).getByRole("link", { name: "Assignments" })).toHaveAttribute("aria-current", "page");
});
it.each([
 ["/admin", ["overview", "seasons", "students"], ["Overview", "Seasons"], 3],
 ["/admin/seasons", ["students", "seasons", "overview"], ["Students", "Seasons"], 3],
 ["/admin/content", ["overview", "seasons", "library"], ["Overview", "Scripture library"], 3],
 ["/admin/practice", ["library", "students"], ["Scripture library", "Team Practice"], 3],
 ["/admin/coaches", [], ["Coaches"], 1],
] as const)("selects complete mobile Coach shortcuts without rewriting saved pins: %s", (path, saved, expected, allCount) => {
 localStorage.setItem("erudoza:pins:org:user:coach", JSON.stringify(saved));
 shell(path, "admin");
 const nav = screen.getByRole("navigation", { name: "Coach" });
 const mobileLinks = [...nav.querySelectorAll('[data-mobile-visible="true"] > a')];
 expect(mobileLinks.map(link => link.textContent)).toEqual(expected);
 expect(mobileLinks.some(link => link.getAttribute("aria-current") === "page")).toBe(true);
 expect(JSON.parse(localStorage.getItem("erudoza:pins:org:user:coach")!)).toEqual(saved);
 expect(within(nav).getAllByRole("link")).toHaveLength(allCount);
});
it("keeps an unpinned Coach destination in the mobile pair while preserving desktop shortcuts", () => {
 shell("/admin", "admin");
 const nav = screen.getByRole("navigation", { name: "Coach" });
 fireEvent.click(screen.getByRole("button", { name: "All sections" }));
 fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unpin Overview" }));
 expect([...nav.querySelectorAll('[data-mobile-visible="true"] > a')].map(link => link.textContent)).toEqual(["Seasons", "Overview"]);
 expect(within(nav).getAllByRole("link")).toHaveLength(7);
 expect(JSON.parse(localStorage.getItem("erudoza:pins:org:user:coach")!)).toEqual(["seasons", "students", "coaches", "assignments", "practice", "library"]);
 expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Pin Overview" })).toBeInTheDocument();
 fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Team Practice" }));
 expect([...nav.querySelectorAll('[data-mobile-visible="true"] > a')].map(link => link.textContent)).toEqual(["Seasons", "Team Practice"]);
 expect(within(nav).getByRole("link", { name: "Team Practice" })).toHaveAttribute("aria-current", "page");
 expect(within(nav).queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
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
it("searches real students and opens their assignments; keyboard navigation moves through results", async () => {
 vi.mocked(api.students).mockResolvedValue([{ userId: "sam", userName: "sam.student", displayName: "Sam Student", email: null }]);
 shell("/admin", "admin"); fireEvent.keyDown(window, { key: "k", ctrlKey: true });
 const dialog = screen.getByRole("dialog", { name: "Command center" }); const input = within(dialog).getByRole("searchbox", { name: "Search navigation" });
 expect(input).toHaveFocus(); fireEvent.change(input, { target: { value: "sam" } });
 const student = await within(dialog).findByRole("link", { name: /Sam Student/ }); expect(student).toHaveAttribute("href", "/admin/assignments?studentId=sam");
 fireEvent.keyDown(input, { key: "ArrowDown" }); expect(student).toHaveFocus();
});
it("keeps expanded groups between visits and persists pins without exposing coach actions to students", async () => {
 const view = shell("/admin", "admin"); fireEvent.click(screen.getByRole("button", { name: "All sections" }));
 fireEvent.click(screen.getByRole("button", { name: "Show Seasons options" })); expect(screen.getByRole("link", { name: "Create season" })).toHaveAttribute("href", "/admin/seasons/new");
 fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unpin Scripture library" }));
 fireEvent.click(screen.getByRole("button", { name: "Close command center" }));
 expect(within(screen.getByRole("navigation", { name: "Coach" })).queryByRole("link", { name: "Scripture library" })).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "All sections" })); expect(screen.getByRole("link", { name: "Create season" })).toBeInTheDocument();
 view.unmount(); shell(); fireEvent.click(screen.getByRole("button", { name: "All sections" }));
 expect(screen.queryByRole("link", { name: "Create season" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Students" })).not.toBeInTheDocument();
 expect(api.students).toHaveBeenCalledTimes(1);
});
it("retains section navigation when live search results fail", async () => {
 vi.mocked(api.seasons).mockRejectedValue(new Error("offline")); shell("/admin", "admin");
 fireEvent.click(screen.getByRole("button", { name: "All sections" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("Sections are still available");
 expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Seasons" })).toHaveAttribute("href", "/admin/seasons");
});
