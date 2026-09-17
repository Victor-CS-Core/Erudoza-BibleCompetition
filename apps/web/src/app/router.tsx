import { Button, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../components/ui";
import { Navigate, createBrowserRouter, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { lazy, Suspense, type ReactNode } from "react";
import { AdminHomePage } from "../features/admin/AdminHomePage";
import { SeasonWizardPage } from "../features/admin/SeasonWizardPage";
import { ContentPage } from "../features/admin/ContentPage";
import {
  AssignmentsPage,
  SeasonsListPage,
  StudentsPage,
} from "../features/admin/SimpleAdminPages";
import { LoginPage } from "../features/auth/LoginPage";
import { CoachOnboardingPage } from "../features/auth/CoachOnboardingPage";
import { CoachesPage } from "../features/admin/CoachesPage";
import { MaterialsPage } from "../features/admin/MaterialsPage";
import { NewsPage } from "../features/news/NewsPage";
import { LandingPage } from "../features/marketing/LandingPage";
import { PrivacyPage } from "../features/legal/PrivacyPage";
import { TermsPage } from "../features/legal/TermsPage";
import { ProgressPage } from "../features/student/ProgressPage";
import { MyAssignmentsPage } from "../features/student/MyAssignmentsPage";
import { StudentHomePage } from "../features/student/StudentHomePage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SessionRecapPage } from "../features/student/SessionRecapPage";
import { RoomRecapPage } from "../features/practice/RoomRecapPage";
import { StudyPage } from "../features/student/StudyPage";
import { AppShell } from "../layouts/AppShell";
import { RouteProblemPage } from "./RouteProblemPage";
import { DesignSystemPage } from "../components/design-system/DesignSystemPage";
import { WikiPage } from "../features/wiki/WikiPage";
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
  { path: "/wiki", element: <WikiPage scope="public" />, errorElement: <RouteProblemPage /> },
  { path: "/help", element: <WikiPage scope="app" />, errorElement: <RouteProblemPage /> },
  { path: "/privacy", element: <PrivacyPage />, errorElement: <RouteProblemPage /> },
  { path: "/terms", element: <TermsPage />, errorElement: <RouteProblemPage /> },
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
      { index: true, element: <Restricted><AdminHomePage /></Restricted> },
      { path: "seasons", element: <Restricted><SeasonsListPage /></Restricted> },
      { path: "seasons/new", element: <Restricted><SeasonWizardPage /></Restricted> },
      { path: "seasons/:seasonId", element: <Restricted><SeasonWizardPage /></Restricted> },
      { path: "students", element: <Restricted><StudentsPage /></Restricted> },
      { path: "coaches", element: <Restricted><CoachesPage /></Restricted> },
      { path: "assignments", element: <Restricted><AssignmentsPage /></Restricted> },
      { path: "seasons/:seasonId/students/:studentId/progress", element: <Restricted><ProgressPage /></Restricted> },
      { path: "content", element: <Restricted><ContentPage /></Restricted> },
      { path: "materials", element: <MaterialsNewsGate><MaterialsPage /></MaterialsNewsGate> },
      { path: "news", element: <MaterialsNewsGate><MaterialsPage initialTab="news" /></MaterialsNewsGate> },
      { path: "design-system", element: <Restricted><DesignSystemPage /></Restricted> },
      { path: "profile", element: <Restricted><ProfilePage /></Restricted> },
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
      { index: true, element: <StudentHomePage /> },
      { path: "assignments", element: <MyAssignmentsPage /> },
      { path: "news", element: <NewsPage base="/student/news" /> },
      { path: "news/:id", element: <NewsPage base="/student/news" /> },
      { path: "library", element: <LibraryRedirect /> },
      { path: "study", element: <StudyPage /> },
      { path: "sessions/:sessionId/recap", element: <SessionRecapPage /> },
      { path: "honors", element: <HonorsRedirect /> },
      { path: "progress", element: <ProgressPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "practice", element: <PracticeRoute /> },
      { path: "practice/:roomId", element: <PracticeRoute /> },
      { path: "practice/rooms/:roomId/recap", element: <RoomRecapPage /> },
    ],
  },
]);
