import type { IconName } from "../AppIcon";
import type { AdultRole } from "../../api/onboarding";
export type Destination = { id: string; label: string; to: string; icon: IconName; testId?: string; children?: Destination[]; searchOnly?: boolean };
const child = (id: string, label: string, to: string, icon: IconName = "arrow"): Destination => ({ id, label, to, icon });
export function navigation(coach: boolean, selectedSeason?: string | null, personalAssignments = false, adultRole?: AdultRole | null, teamPracticeEnabled = true, masterAdmin = false): Destination[] {
  const student = (path: string) => selectedSeason ? `${path}${path.includes("?") ? "&" : "?"}seasonId=${encodeURIComponent(selectedSeason)}` : path;
  const all: Destination[] = coach ? [
    { id: "overview", label: "Overview", to: "/admin", icon: "home", testId: "coach-tab-overview" },
    { id: "seasons", label: "Seasons", to: "/admin/seasons", icon: "flag", testId: "coach-tab-seasons", children: [child("all-seasons", "All seasons", "/admin/seasons"), child("create-season", "Create season", "/admin/seasons/new", "plus"), ...(selectedSeason ? [child("season-books", "Season & books", `/admin/seasons/${encodeURIComponent(selectedSeason)}?step=details`, "book"), child("season-assignments", "Season assignments", `/admin/seasons/${encodeURIComponent(selectedSeason)}?step=students`, "users")] : [])] },
    { id: "students", label: "Students", to: "/admin/students", icon: "users", testId: "coach-tab-students", children: [child("directory", "Student directory", "/admin/students#student-directory"), child("add-student", "Add student", "/admin/students#add-student", "plus")] },
    { id: "coaches", label: "Coaches", to: "/admin/coaches", icon: "users", testId: "coach-tab-coaches", children: [child("coach-directory", "Coach directory", "/admin/coaches#coach-directory"), child("invite-coach", "Invite a coach", "/admin/coaches#invite-coach", "plus")] },
    { id: "assignments", label: "Assignments", to: "/admin/assignments", icon: "book", testId: "nav-assignments", children: [child("student-assignments", "Student assignments", student("/admin/assignments")), ...(personalAssignments ? [child("coach-assignments", "My assignments", student("/student/assignments"), "book")] : [])] },
    { id: "practice", label: "Team Practice", to: "/admin/practice", icon: "users", testId: "nav-team-practice", children: [child("events", "Your events", "/admin/practice#events"), child("create-event", "Create event", "/admin/practice#create-event", "plus"), child("rooms", "Your rooms", "/admin/practice#rooms"), child("invitations", "Invitations", "/admin/practice#invitations")] },
    { id: "profile", label: "Your profile", to: "/admin/profile", icon: "users" },
    { id: "library", label: "Scripture library", to: student("/admin/content"), icon: "book", testId: "nav-content", children: [child("books", "Books of the Bible", student("/admin/content") + "#library-books"), child("preview", "Read Scripture", student("/admin/content") + "#library-preview", "book")] },
    { id: "materials", label: "PBE materials", to: "/admin/materials", icon: "book", testId: "nav-pbe-materials" },
    { id: "news", label: "PBE news", to: "/admin/news", icon: "bell", testId: "nav-pbe-news" },
  ] : [
    { id: "home", label: "Training HQ", to: student("/student"), icon: "home", testId: "learner-tab-home" },
    { id: "study", label: "Study", to: student("/student/study"), icon: "book", testId: "nav-academy-learner" },
    { id: "news", label: "PBE news", to: student("/student/news"), icon: "bell", testId: "nav-pbe-news" },
    { id: "practice", label: "Team Practice", to: student("/student/practice"), icon: "users", testId: "nav-team-practice", children: [child("events", "Your events", student("/student/practice") + "#events"), child("invitations", "Invitations", student("/student/practice") + "#invitations")] },
    { id: "profile", label: "Your profile", to: student("/student/profile"), icon: "users" },
  ];
  // Team Practice disabled for the org: the hub itself stays reachable (it
  // explains enablement), but its section children (#events, #rooms, …)
  // would land at the top of a disabled hub — drop them until it is on.
  const gated = teamPracticeEnabled ? all : all.map(item => item.id === "practice" ? { ...item, children: undefined } : item);
  /** Content Managers see only PBE materials and PBE news. Regular Admins (and
   *  unknown roles) see every other coach area but never PBE materials/news or the
   *  invitation controls. Owners see everything. */
  if (!coach) return gated;
  // The Control Center entry appears for the master admin account only; the
  // server gate on its endpoints is authoritative.
  const allCoach = masterAdmin ? [...gated, { id: "control-center", label: "Control Center", to: "/admin/control-center", icon: "grid" as IconName }] : gated;
  if (adultRole === "Content Manager") return allCoach.filter(item => item.id === "materials" || item.id === "news");
  if (adultRole !== "Owner") return allCoach
    .filter(item => item.id !== "materials" && item.id !== "news" && item.id !== "control-center")
    .map(item => item.id === "coaches" ? { ...item, children: item.children?.filter(entry => entry.id !== "invite-coach") } : item);
  return allCoach;
}
/** Search-only destinations: reachable via the command dialog but not shown in the nav. */
export function studentSearchExtras(personalAssignments: boolean, selectedSeason?: string | null): Destination[] {
  if (!personalAssignments) return [];
  const to = selectedSeason ? `/student/assignments?seasonId=${encodeURIComponent(selectedSeason)}` : "/student/assignments";
  return [{ id: "my-assignments", label: "My assignments", to, icon: "book", testId: "nav-my-assignments", searchOnly: true }];
}
export function currentDestination(items: Destination[], pathname: string) {  if (/^\/student\/sessions\/[^/]+\/recap$/.test(pathname)) return items.find(item => item.id === "study");
  // Study modes (Practice / Review / Simulation / Library) and the legacy
  // library route all live under the single Study destination now.
  if (pathname === "/student/study" || pathname === "/student/library" || pathname === "/student/assignments") return items.find(item => item.id === "study");
  // Your progress lives on Training HQ now, and Honors is reached from HQ:
  // both routes resolve to the home destination.
  if (pathname === "/student/honors" || pathname === "/student/progress") return items.find(item => item.id === "home");
  return [...items].sort((a, b) => b.to.length - a.to.length).find(item => pathname === item.to.split("?")[0] || (item.to.split("?")[0] !== "/admin" && item.to.split("?")[0] !== "/student" && pathname.startsWith(item.to.split("?")[0] + "/")));
}
