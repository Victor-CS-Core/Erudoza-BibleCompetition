import { CoachAppShell } from "./CoachAppShell";
import { LearnerAppShell } from "./LearnerAppShell";

export function AppShell({ variant }: { variant: "admin" | "student" }) {
  if (variant === "student") {
    return <LearnerAppShell />;
  }
  return <CoachAppShell />;
}
