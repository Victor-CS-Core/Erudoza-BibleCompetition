import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErudozaWordmark } from "../components/brand/ErudozaWordmark";
import { FieldGuideChrome } from "../components/material/FieldGuideChrome";

const moreRoutes = ["/admin/content", "/admin/assignments", "/admin/questions"];

export function CoachAppShell() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const seasonsActive = pathname === "/admin" || pathname.startsWith("/admin/seasons");
  const studentsActive = pathname.startsWith("/admin/students");
  const moreActive = moreRoutes.some((route) => pathname.startsWith(route));
  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <div className="er-canvas er-coach-shell" data-testid="coach-app-shell">
      <div className="er-coach-column" data-testid="coach-phone-column">
        <FieldGuideChrome testId="coach-field-guide-chrome" />
        <header className="er-coach-header">
          <Link to="/admin" aria-label="Erudoza home" className="er-coach-wordmark">
            <ErudozaWordmark compact />
          </Link>
        </header>
        <main className="er-coach-main">
          <p className="sr-only">{me?.displayName}</p>
          <Outlet />
        </main>
        {moreOpen ? (
          <div className="er-coach-more" data-testid="coach-more-overflow" id="coach-more-overflow">
            <NavLink className="er-coach-more-link" to="/admin/content">
              Content
            </NavLink>
            <NavLink className="er-coach-more-link" to="/admin/assignments">
              Assignments
            </NavLink>
            <NavLink className="er-coach-more-link" to="/admin/questions">
              Questions
            </NavLink>
            <button type="button" data-testid="logout" className="er-coach-more-link" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : null}
        <nav aria-label="Coach" className="er-coach-tabbar" data-testid="coach-tab-bar">
          <Link
            to="/admin"
            className="er-coach-tab"
            data-testid="coach-tab-seasons"
            aria-current={seasonsActive ? "page" : undefined}
          >
            <LeafIcon />
            Seasons
          </Link>
          <Link
            to="/admin/students"
            className="er-coach-tab"
            data-testid="coach-tab-students"
            aria-current={studentsActive ? "page" : undefined}
          >
            <StudentsIcon />
            Students
          </Link>
          <button
            type="button"
            className="er-coach-tab"
            data-testid="coach-tab-more"
            aria-current={moreActive ? "page" : undefined}
            aria-expanded={moreOpen}
            aria-controls="coach-more-overflow"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreIcon />
            More
          </button>
        </nav>
      </div>
    </div>
  );
}

function LeafIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3c5.2 2.2 8 6.4 8 11.2 0 2.4-.8 4.4-2.2 5.8-1.2-3.6-3.6-6.5-6.8-8.2 2.5 2.4 4.2 5.6 4.6 9.2H11c-3.3 0-6-2.5-6-6.2C5 8.6 8 5 12 3Z"
      />
    </svg>
  );
}

function StudentsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 10a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM8 12c-3 0-6 1.5-6 4v2h8v-2c0-1.2.4-2.2 1.1-3Zm8 0c-.4 0-.8 0-1.2.1A5 5 0 0 1 16 18v2h6v-2c0-2.5-3-4-6-4Z"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="6" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="18" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
