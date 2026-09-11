import type { IconName } from "../AppIcon";
export type Destination = { id: string; label: string; to: string; icon: IconName; testId?: string; children?: Destination[] };
const child = (id: string, label: string, to: string, icon: IconName = "arrow"): Destination => ({ id, label, to, icon });
export function navigation(coach: boolean, selectedSeason?: string | null): Destination[] {
  const student = (path: string) => selectedSeason ? `${path}${path.includes("?") ? "&" : "?"}seasonId=${encodeURIComponent(selectedSeason)}` : path;
  return coach ? [
    { id: "overview", label: "Overview", to: "/admin", icon: "home", testId: "coach-tab-overview" },
    { id: "seasons", label: "Seasons", to: "/admin/seasons", icon: "flag", testId: "coach-tab-seasons", children: [child("all-seasons", "All seasons", "/admin/seasons"), child("create-season", "Create season", "/admin/seasons/new", "plus")] },
    { id: "students", label: "Students", to: "/admin/students", icon: "users", testId: "coach-tab-students", children: [child("directory", "Student directory", "/admin/students#student-directory"), child("add-student", "Add student", "/admin/students#add-student", "plus"), child("student-plans", "Manage assignments", "/admin/assignments")] },
    { id: "assignments", label: "Assignments", to: "/admin/assignments", icon: "book", testId: "nav-assignments" },
    { id: "practice", label: "Team Practice", to: "/admin/practice", icon: "users", testId: "nav-team-practice", children: [child("rooms", "Your rooms", "/admin/practice#rooms"), child("create-room", "Create a room", "/admin/practice#create-room", "plus"), child("invitations", "Invitations", "/admin/practice#invitations"), child("questions", "Question bank", "/admin/practice#question-bank", "book"), child("achievements", "Team achievements", "/admin/practice#achievements", "flag"), child("practice-progress", "Team practice progress", "/admin/practice#practice-progress", "chart")] },
    { id: "library", label: "Scripture library", to: "/admin/content", icon: "book", testId: "nav-content", children: [child("books", "Books of the Bible", "/admin/content#library-books"), child("preview", "Read Scripture", "/admin/content#library-preview", "book")] },
  ] : [
    { id: "home", label: "Training HQ", to: student("/student"), icon: "home", testId: "learner-tab-home" },
    { id: "study", label: "Study", to: student("/student/study"), icon: "book", testId: "nav-academy-learner" },
    { id: "review", label: "Review", to: student("/student/study?mode=Review"), icon: "review", testId: "nav-review" },
    { id: "simulation", label: "Simulation", to: student("/student/study?mode=Simulation"), icon: "flag", testId: "nav-simulation" },
    { id: "practice", label: "Team Practice", to: student("/student/practice"), icon: "users", testId: "nav-team-practice", children: [child("rooms", "Your rooms", student("/student/practice") + "#rooms"), child("invitations", "Invitations", student("/student/practice") + "#invitations"), child("achievements", "Team achievements", student("/student/practice") + "#achievements", "flag"), child("practice-progress", "Team practice progress", student("/student/practice") + "#practice-progress", "chart")] },
    { id: "progress", label: "Progress", to: student("/student/progress"), icon: "chart", testId: "learner-tab-progress" },
  ];
}
export function currentDestination(items: Destination[], pathname: string, search: string) {
  const mode = new URLSearchParams(search).get("mode");
  if (pathname === "/student/study") return items.find(item => item.id === (mode === "Review" ? "review" : mode === "Simulation" ? "simulation" : "study"));
  return [...items].sort((a, b) => b.to.length - a.to.length).find(item => pathname === item.to.split("?")[0] || (item.to.split("?")[0] !== "/admin" && item.to.split("?")[0] !== "/student" && pathname.startsWith(item.to.split("?")[0] + "/")));
}
