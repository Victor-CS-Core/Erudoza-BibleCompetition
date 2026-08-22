import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { PaperSurface } from "../../components/material/PaperSurface";
import { useAuth } from "../../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="er-canvas grid min-h-screen place-items-center px-4">
      <PaperSurface className="w-full max-w-md">
        <ErudozaWordmark />
        <h1 className="mt-6 text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--er-muted-ink)]">Study. Master. Compete.</p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <label className="block text-sm font-medium">
            Email or username
            <input
              data-testid="login-identifier"
              className="mt-1 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] px-3"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              data-testid="login-password"
              type="password"
              className="mt-1 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] px-3"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="text-sm text-[var(--er-stamp-red)]">{error}</p> : null}
          <button
            data-testid="login-submit"
            className="w-full rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] text-[var(--er-card)]"
            type="submit"
          >
            Continue
          </button>
        </form>
      </PaperSurface>
    </div>
  );
}
