import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErudozaWordmark } from "../components/brand/ErudozaWordmark";
import { LearnerAppShell } from "./LearnerAppShell";

export function AppShell({ variant }: { variant: "admin" | "student" }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  if (variant === "student") {
    return <LearnerAppShell />;
  }

  return (
    <div className="er-canvas">
      <header className="er-ink-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/admin" aria-label="Erudoza home">
            <ErudozaWordmark compact inverted />
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-3 text-sm">
            <NavLink className={navClass(true)} to="/admin/seasons">
              Seasons
            </NavLink>
            <NavLink className={navClass(true)} to="/admin/students">
              Students
            </NavLink>
            <NavLink className={navClass(true)} to="/admin/content">
              Content
            </NavLink>
            <NavLink className={navClass(true)} to="/admin/assignments">
              Assignments
            </NavLink>
            <NavLink className={navClass(true)} to="/admin/questions">
              Questions
            </NavLink>
            <button type="button" data-testid="logout" className="text-[var(--er-card)]" onClick={() => void signOut()}>
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <p className="sr-only">{me?.displayName}</p>
        <Outlet />
      </main>
    </div>
  );
}

function navClass(inverted: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 ${inverted ? "text-[var(--er-card)]" : "text-[var(--er-ink-navy)]"} ${
      isActive ? "bg-white/15 font-semibold" : ""
    }`;
}
