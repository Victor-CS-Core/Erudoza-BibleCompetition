import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ErudozaWordmark } from "../components/brand/ErudozaWordmark";
import {
  ACADEMY_TRACKS,
  academyTrackForMode,
  visibleAcademyTracks,
} from "../features/student/academyTracks";

export function AppShell({ variant }: { variant: "admin" | "student" }) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const admin = variant === "admin";
  const requestedMode = new URLSearchParams(location.search).get("mode");
  const studyMode = requestedMode === "Simulation" || requestedMode === "Review" ? requestedMode : "Practice";
  const activeStudyTrack = location.pathname === "/student/study" ? academyTrackForMode(studyMode) : null;
  const progress = useQuery({
    queryKey: ["progress"],
    queryFn: () => api.progress(),
    enabled: !admin,
  });
  const tracks = visibleAcademyTracks(progress.data);
  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className={`er-canvas ${admin ? "" : ""}`}>
      <header className={admin ? "er-ink-panel" : "border-b border-[var(--er-border)] bg-[var(--er-card)]"}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to={admin ? "/admin" : "/student"} aria-label="Erudoza home">
            <ErudozaWordmark compact inverted={admin} />
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-3 text-sm">
            {admin ? (
              <>
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
              </>
            ) : (
              <>
                <NavLink className={navClass(false)} to="/student" end>
                  Home
                </NavLink>
                {tracks.map((id) => (
                  <Link
                    key={id}
                    className={navClass(false)({ isActive: activeStudyTrack === id })}
                    to={ACADEMY_TRACKS[id].href}
                    data-testid={`nav-academy-${id}`}
                    aria-current={activeStudyTrack === id ? "page" : undefined}
                  >
                    {ACADEMY_TRACKS[id].label}
                  </Link>
                ))}
                <NavLink className={navClass(false)} to="/student/progress">
                  Progress
                </NavLink>
              </>
            )}
            <button type="button" data-testid="logout" className={admin ? "text-[var(--er-card)]" : ""} onClick={() => void signOut()}>
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
