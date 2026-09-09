import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErudozaWordmark } from "../components/brand/ErudozaWordmark";

const learnerTabs = [
  { to: "/student", label: "Home", icon: HomeIcon, end: true, testId: "learner-tab-home" },
  { to: "/student/study", label: "Learner", icon: LearnerIcon, end: false, testId: "nav-academy-learner" },
  { to: "/student/progress", label: "Progress", icon: ProgressIcon, end: false, testId: "learner-tab-progress" },
] as const;

export function LearnerAppShell() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="er-canvas er-learner-shell" data-testid="learner-app-shell">
      <div className="er-learner-column" data-testid="learner-phone-column">
        <header className="er-learner-header">
          <button type="button" className="er-learner-icon-btn" aria-label="Menu">
            <MenuIcon />
          </button>
          <Link to="/student" aria-label="Erudoza home" className="er-learner-wordmark">
            <ErudozaWordmark compact />
          </Link>
          <button type="button" className="er-learner-icon-btn" data-testid="logout" aria-label="Sign out" onClick={() => void signOut()}>
            <ProfileIcon />
          </button>
        </header>
        <main className="er-learner-main">
          <p className="sr-only">{me?.displayName}</p>
          <Outlet />
        </main>
        <nav aria-label="Learner" className="er-learner-tabbar" data-testid="learner-tab-bar">
          {learnerTabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className="er-learner-tab" data-testid={tab.testId}>
              <tab.icon />
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M4 7h16v2H4zm0 4h16v2H4zm0 4h16v2H4z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5Z"
      />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M12 4 3 12h2v8h6v-6h2v6h6v-8h2L12 4Z" />
    </svg>
  );
}

function LearnerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4Zm9 0h7v12h-5a2 2 0 0 0-2 2Z"
      />
    </svg>
  );
}

function ProgressIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d="M5 13h3v7H5zm6-6h3v13h-3zm6-4h3v17h-3z" />
    </svg>
  );
}
