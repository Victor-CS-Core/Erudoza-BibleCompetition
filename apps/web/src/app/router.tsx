import { Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../components/ui";
import { Navigate, createBrowserRouter, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { lazy, Suspense, type ReactNode } from "react";
import { LoginPage } from "../features/auth/LoginPage";
import { CoachOnboardingPage } from "../features/auth/CoachOnboardingPage";
import { LandingPage } from "../features/marketing/LandingPage";
import { AppShell } from "../layouts/AppShell";
import { RouteProblemPage } from "./RouteProblemPage";
// Route pages below are lazy-loaded so visitors only download the pages they
// actually open. Landing/login/onboarding stay in the main bundle for first paint.
const AdminHomePage = lazy(() => import("../features/admin/AdminHomePage").then(m => ({ default: m.AdminHomePage })));
const SeasonWizardPage = lazy(() => import("../features/admin/SeasonWizardPage").then(m => ({ default: m.SeasonWizardPage })));
const ContentPage = lazy(() => import("../features/admin/ContentPage").then(m => ({ default: m.ContentPage })));
const AssignmentsPage = lazy(() => import("../features/admin/SimpleAdminPages").then(m => ({ default: m.AssignmentsPage })));
const SeasonsListPage = lazy(() => import("../features/admin/SimpleAdminPages").then(m => ({ default: m.SeasonsListPage })));
const StudentsPage = lazy(() => import("../features/admin/SimpleAdminPages").then(m => ({ default: m.StudentsPage })));
const CoachesPage = lazy(() => import("../features/admin/CoachesPage").then(m => ({ default: m.CoachesPage })));
const MaterialsPage = lazy(() => import("../features/admin/MaterialsPage").then(m => ({ default: m.MaterialsPage })));
const NewsPage = lazy(() => import("../features/news/NewsPage").then(m => ({ default: m.NewsPage })));
const PrivacyPage = lazy(() => import("../features/legal/PrivacyPage").then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import("../features/legal/TermsPage").then(m => ({ default: m.TermsPage })));
const ProgressPage = lazy(() => import("../features/student/ProgressPage").then(m => ({ default: m.ProgressPage })));
const MyAssignmentsPage = lazy(() => import("../features/student/MyAssignmentsPage").then(m => ({ default: m.MyAssignmentsPage })));
const StudentHomePage = lazy(() => import("../features/student/StudentHomePage").then(m => ({ default: m.StudentHomePage })));
const ProfilePage = lazy(() => import("../features/profile/ProfilePage").then(m => ({ default: m.ProfilePage })));
const SessionRecapPage = lazy(() => import("../features/student/SessionRecapPage").then(m => ({ default: m.SessionRecapPage })));
const RoomRecapPage = lazy(() => import("../features/practice/RoomRecapPage").then(m => ({ default: m.RoomRecapPage })));
const StudyPage = lazy(() => import("../features/student/StudyPage").then(m => ({ default: m.StudyPage })));
const DesignSystemPage = lazy(() => import("../components/design-system/DesignSystemPage").then(m => ({ default: m.DesignSystemPage })));
const WikiPage = lazy(() => import("../features/wiki/WikiPage").then(m => ({ default: m.WikiPage })));
/** Suspense boundary for a lazily-loaded route page. */
function LazyPage({ label, children }: { label: string; children: ReactNode }) {
  return <Suspense fallback={<LoadingState label={label} />}>{children}</Suspense>;
}
const DisputeQueue = lazy(() => import("../features/practice/DisputeQueue").then(module=>({default:module.DisputeQueue})));
const PracticePage = lazy(() => import("../features/practice/PracticePage").then(module => ({ default: module.PracticePage })));
function PracticeRoute() {
  return <Suspense fallback={<LoadingState label="Loading Team Practice…" />}><PracticePage /></Suspense>;
}

function Guard({ role, children }: { role: "admin" | "student"; children: ReactNode }) {
  const { me, loading, error, refresh } = useAuth();
  if (loading) {
    return <main className="training-public public-recovery"><LoadingState label="Opening your workspace…" /></main>;
  }
  if (error) return <Panel className="m-6"><Notice tone="danger">{error}</Notice><Button onClick={() => void refresh()}>Try again</Button></Panel>;
  if (!me) {
    return <Navigate to="/login" replace />;
  }
  if (role === "admin" && me.kind === "Student") {
    return <Navigate to="/student" replace />;
  }
  if (role === "student" && me.kind !== "Student" && !(me.kind === "Adult" && (me.role === "Owner" || me.role === "Admin"))) {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

/** Content Managers may open only /admin/materials and /admin/news; every other
 *  /admin/* route renders this explanation instead. Server-side gates enforce it. */
export function ContentManagerGate({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <main className="training-public public-recovery"><LoadingState label="Opening your workspace…" /></main>;
  if (me?.kind === "Adult" && me.role === "Content Manager")
    return <div className="training-page"><PageHeader title="Restricted area" /><Notice tone="info">Your Content Manager role only includes PBE materials and PBE news. Ask your club Owner if you need wider access.</Notice><LinkButton to="/admin/materials">Go to PBE materials</LinkButton></div>;
  return <>{children}</>;
}

function Restricted({ children }: { children: ReactNode }) {
  return <ContentManagerGate>{children}</ContentManagerGate>;
}

/** /admin/materials and /admin/news are Owner + Content Manager only. Regular
 *  Admins render this access-denied state instead; the worker 403 is the real
 *  enforcement, never just the hidden link. */
export function MaterialsNewsGate({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <main className="training-public public-recovery"><LoadingState label="Opening your workspace…" /></main>;
  if (me?.kind === "Adult" && me.role === "Admin")
    return <div className="training-page"><PageHeader title="Restricted area" /><Notice tone="info">PBE materials and PBE news management is limited to the club Owner and Content Managers. Ask your club Owner if you need access.</Notice><LinkButton to="/admin">Back to Overview</LinkButton></div>;
  return <>{children}</>;
}
/** Legacy /student/library now lives as the Library tab inside Study. */
function LibraryRedirect() {
  const [params] = useSearchParams();
  const seasonId = params.get("seasonId");
  return <Navigate to={`/student/study?mode=Library${seasonId ? `&seasonId=${encodeURIComponent(seasonId)}` : ""}`} replace />;
}

/** Legacy /student/honors now lives as a tab inside Progress. */
function HonorsRedirect() {
  const [params] = useSearchParams();
  const seasonId = params.get("seasonId");
  return <Navigate to={`/student/progress?tab=honors${seasonId ? `&seasonId=${encodeURIComponent(seasonId)}` : ""}`} replace />;
}

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage />, errorElement: <RouteProblemPage /> },
  { path: "/login", element: <LoginPage />, errorElement: <RouteProblemPage /> },
  { path: "/signup", element: <CoachOnboardingPage key="signup" mode="signup" />, errorElement: <RouteProblemPage /> },
  { path: "/forgot-password", element: <CoachOnboardingPage key="recovery" mode="recovery" />, errorElement: <RouteProblemPage /> },
  { path: "/join-coach", element: <CoachOnboardingPage key="invitation" mode="invitation" />, errorElement: <RouteProblemPage /> },
  { path: "/wiki", element: <LazyPage label="Loading wiki…"><WikiPage scope="public" /></LazyPage>, errorElement: <RouteProblemPage /> },
  { path: "/help", element: <LazyPage label="Loading help…"><WikiPage scope="app" /></LazyPage>, errorElement: <RouteProblemPage /> },
  { path: "/privacy", element: <LazyPage label="Loading…"><PrivacyPage /></LazyPage>, errorElement: <RouteProblemPage /> },
  { path: "/terms", element: <LazyPage label="Loading…"><TermsPage /></LazyPage>, errorElement: <RouteProblemPage /> },
  { path: "*", element: <RouteProblemPage notFound /> },
  {
    path: "/admin",
    errorElement: <RouteProblemPage />,
    element: (
      <Guard role="admin">
        <AppShell variant="admin" />
      </Guard>
    ),
    children: [
      { index: true, element: <Restricted><LazyPage label="Loading overview…"><AdminHomePage /></LazyPage></Restricted> },
      { path: "seasons", element: <Restricted><LazyPage label="Loading seasons…"><SeasonsListPage /></LazyPage></Restricted> },
      { path: "seasons/new", element: <Restricted><LazyPage label="Loading season…"><SeasonWizardPage /></LazyPage></Restricted> },
      { path: "seasons/:seasonId", element: <Restricted><LazyPage label="Loading season…"><SeasonWizardPage /></LazyPage></Restricted> },
      { path: "students", element: <Restricted><LazyPage label="Loading students…"><StudentsPage /></LazyPage></Restricted> },
      { path: "coaches", element: <Restricted><LazyPage label="Loading coaches…"><CoachesPage /></LazyPage></Restricted> },
      { path: "assignments", element: <Restricted><LazyPage label="Loading assignments…"><AssignmentsPage /></LazyPage></Restricted> },
      { path: "seasons/:seasonId/students/:studentId/progress", element: <Restricted><LazyPage label="Loading progress…"><ProgressPage /></LazyPage></Restricted> },
      { path: "content", element: <Restricted><LazyPage label="Loading content…"><ContentPage /></LazyPage></Restricted> },
      { path: "materials", element: <MaterialsNewsGate><LazyPage label="Loading materials…"><MaterialsPage /></LazyPage></MaterialsNewsGate> },
      { path: "news", element: <MaterialsNewsGate><LazyPage label="Loading news…"><MaterialsPage initialTab="news" /></LazyPage></MaterialsNewsGate> },
      { path: "design-system", element: <Restricted><LazyPage label="Loading design system…"><DesignSystemPage /></LazyPage></Restricted> },
      { path: "profile", element: <Restricted><LazyPage label="Loading profile…"><ProfilePage /></LazyPage></Restricted> },
      { path: "practice/reviews", element: <Restricted><Suspense fallback={<LoadingState label="Loading answer reviews…"/>}><DisputeQueue/></Suspense></Restricted> },
      { path: "practice", element: <Restricted><PracticeRoute /></Restricted> },
      { path: "practice/:roomId", element: <Restricted><PracticeRoute /></Restricted> },
    ],
  },
  {
    path: "/student",
    errorElement: <RouteProblemPage />,
    element: (
      <Guard role="student">
        <AppShell variant="student" />
      </Guard>
    ),
    children: [
      { index: true, element: <LazyPage label="Loading home…"><StudentHomePage /></LazyPage> },
      { path: "assignments", element: <LazyPage label="Loading assignments…"><MyAssignmentsPage /></LazyPage> },
      { path: "news", element: <LazyPage label="Loading news…"><NewsPage base="/student/news" /></LazyPage> },
      { path: "news/:id", element: <LazyPage label="Loading news…"><NewsPage base="/student/news" /></LazyPage> },
      { path: "library", element: <LibraryRedirect /> },
      { path: "study", element: <LazyPage label="Loading study…"><StudyPage /></LazyPage> },
      { path: "sessions/:sessionId/recap", element: <LazyPage label="Loading recap…"><SessionRecapPage /></LazyPage> },
      { path: "honors", element: <HonorsRedirect /> },
      { path: "progress", element: <LazyPage label="Loading progress…"><ProgressPage /></LazyPage> },
      { path: "profile", element: <LazyPage label="Loading profile…"><ProfilePage /></LazyPage> },
      { path: "practice", element: <PracticeRoute /> },
      { path: "practice/:roomId", element: <PracticeRoute /> },
      { path: "practice/rooms/:roomId/recap", element: <LazyPage label="Loading recap…"><RoomRecapPage /></LazyPage> },
    ],
  },
]);
