import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { FieldGuideChrome } from "../../components/material/FieldGuideChrome";
import { FieldGuideCover } from "../../components/material/FieldGuideCover";
import { PaperSurface } from "../../components/material/PaperSurface";
import { useAuth } from "../../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const me = await login(identifier, password);
      navigate(me.kind === "Student" ? "/student" : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    }
  };

  return (
    <div className="er-canvas er-login">
      <div className="er-login-column" data-testid="login-phone-column">
        <FieldGuideChrome testId="login-field-guide-chrome" />
        <header className="er-kraft-banner" data-testid="login-kraft-banner">
          <span className="er-kraft-grommet" aria-hidden="true" />
          <span className="er-kraft-banner-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M8 26c2-8 4-14 10-22" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 22c-5-1-8-6-6-9 5 1 9 5 6 9Z" fill="currentColor" opacity="0.85" />
              <path d="M14 16c-4-2-5-7-3-9 4 2 6 6 3 9Z" fill="currentColor" opacity="0.7" />
            </svg>
          </span>
          <div className="er-kraft-banner-copy">
            <p>FIELD GUIDE</p>
            <p>• VOL. 7 • FLORA &amp; TERRAIN •</p>
          </div>
          <span className="er-kraft-banner-mark" aria-hidden="true">
            <svg viewBox="0 0 36 24" fill="currentColor">
              <path d="M0 22 10 10 16 16 24 4 36 22Z" />
            </svg>
          </span>
          <span className="er-kraft-grommet" aria-hidden="true" />
        </header>
        <FieldGuideCover>
          <ErudozaWordmark />
          <p className="er-login-motto" data-testid="login-motto">
            Discover · Interpret · Serve
          </p>
        </FieldGuideCover>
        <PaperSurface data-testid="login-signin-sheet" className="er-signin-sheet">
          <h2 className="er-signin-title">Sign in</h2>
          <span className="er-signin-flourish" aria-hidden="true" />
          <form className="er-signin-form" onSubmit={(event) => void onSubmit(event)}>
            <label className="er-login-field">
              <span className="sr-only">Email or username</span>
              <span className="er-login-field-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="6" width="18" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M4 7.5 12 13l8-5.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </span>
              <input
                data-testid="login-identifier"
                className="er-login-input"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                placeholder="Email or username"
                required
              />
            </label>
            <label className="er-login-field">
              <span className="sr-only">Password</span>
              <span className="er-login-field-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="10" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 10V8a4 4 0 0 1 8 0v2" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </span>
              <input
                data-testid="login-password"
                className="er-login-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Password"
                required
              />
              <button
                type="button"
                className="er-login-visibility"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((open) => !open)}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
            </label>
            {error ? <p className="text-sm text-[var(--er-stamp-red)]">{error}</p> : null}
            <button data-testid="login-submit" className="er-denim-action" type="submit">
              Continue
            </button>
          </form>
          <div className="er-login-sheet-links">
            <p className="er-login-forgot">Forgot Password?</p>
            <Link to="/" data-testid="login-join-academy" className="er-login-join">
              New Explorer? Join Academy →
            </Link>
          </div>
        </PaperSurface>
      </div>
    </div>
  );
}
