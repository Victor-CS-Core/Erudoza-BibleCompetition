import { Button, LoadingState, Notice, Panel } from "../components/ui";
import { Navigate, createBrowserRouter } from "react-router-dom";
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
import { LandingPage } from "../features/marketing/LandingPage";
import { PrivacyPage } from "../features/legal/PrivacyPage";
import { TermsPage } from "../features/legal/TermsPage";
import { ProgressPage } from "../features/student/ProgressPage";
import { MyAssignmentsPage } from "../features/student/MyAssignmentsPage";
import { StudentHomePage } from "../features/student/StudentHomePage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { HonorsPage } from "../features/student/HonorsPage";
import { SessionRecapPage } from "../features/student/SessionRecapPage";
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

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage />, errorElement: <RouteProblemPage /> },
  { path: "/login", element: <LoginPage />, errorElement: <RouteProblemPage /> },
  { path: "/signup", element: <CoachOnboardingPage key="signup" mode="signup" />, errorElement: <RouteProblemPage /> },
  { path: "/forgot-password", element: <CoachOnboardingPage key="recovery" mode="recovery" />, errorElement: <RouteProblemPage /> },
  { path: "/join-coach", element: <CoachOnboardingPage key="invitation" mode="invitation" />, errorElement: <RouteProblemPage /> },
  { path: "/wiki", element: <WikiPage />, errorElement: <RouteProblemPage /> },
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
      { index: true, element: <AdminHomePage /> },
      { path: "seasons", element: <SeasonsListPage /> },
      { path: "seasons/new", element: <SeasonWizardPage /> },
      { path: "seasons/:seasonId", element: <SeasonWizardPage /> },
      { path: "students", element: <StudentsPage /> },
      { path: "coaches", element: <CoachesPage /> },
      { path: "assignments", element: <AssignmentsPage /> },
      { path: "seasons/:seasonId/students/:studentId/progress", element: <ProgressPage /> },
      { path: "content", element: <ContentPage /> },
      { path: "design-system", element: <DesignSystemPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "practice/reviews", element: <Suspense fallback={<LoadingState label="Loading answer reviews…"/>}><DisputeQueue/></Suspense> },
      { path: "practice", element: <PracticeRoute /> },
      { path: "practice/:roomId", element: <PracticeRoute /> },
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
      { path: "library", element: <ContentPage /> },
      { path: "study", element: <StudyPage /> },
      { path: "sessions/:sessionId/recap", element: <SessionRecapPage /> },
      { path: "honors", element: <HonorsPage /> },
      { path: "progress", element: <ProgressPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "practice", element: <PracticeRoute /> },
      { path: "practice/:roomId", element: <PracticeRoute /> },
    ],
  },
]);
