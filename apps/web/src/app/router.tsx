import { Navigate, createBrowserRouter } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { ReactNode } from "react";
import { AdminHomePage } from "../features/admin/AdminHomePage";
import { SeasonWizardPage } from "../features/admin/SeasonWizardPage";
import {
  AssignmentsPage,
  ContentPage,
  QuestionsPage,
  SeasonsListPage,
  StudentsPage,
} from "../features/admin/SimpleAdminPages";
import { LoginPage } from "../features/auth/LoginPage";
import { LandingPage } from "../features/marketing/LandingPage";
import { ProgressPage } from "../features/student/ProgressPage";
import { StudentHomePage } from "../features/student/StudentHomePage";
import { StudyPage } from "../features/student/StudyPage";
import { AppShell } from "../layouts/AppShell";

function Guard({ role, children }: { role: "admin" | "student"; children: ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) {
    return <p className="p-6">Loading…</p>;
  }
  if (!me) {
    return <Navigate to="/login" replace />;
  }
  if (role === "admin" && me.kind === "Student") {
    return <Navigate to="/student" replace />;
  }
  if (role === "student" && me.kind !== "Student") {
    return <Navigate to="/admin" replace />;
  }
  return children;
}

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  {
    path: "/admin",
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
      { path: "assignments", element: <AssignmentsPage /> },
      { path: "seasons/:seasonId/students/:studentId/progress", element: <ProgressPage /> },
      { path: "content", element: <ContentPage /> },
      { path: "questions", element: <QuestionsPage /> },
    ],
  },
  {
    path: "/student",
    element: (
      <Guard role="student">
        <AppShell variant="student" />
      </Guard>
    ),
    children: [
      { index: true, element: <StudentHomePage /> },
      { path: "study", element: <StudyPage /> },
      { path: "progress", element: <ProgressPage /> },
    ],
  },
]);
