import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { AppIcon } from "../../components/AppIcon";
import { Button, Input, Notice } from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const me = await login(identifier, password);
      navigate(me.kind === "Student" ? "/student" : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="training-login">
      <section className="training-login-hero" aria-label="Field Guide Academy">
        <Link className="training-login-brand" to="/" aria-label="Erudoza home"><ErudozaWordmark inverted /></Link>
        <div className="training-login-message">

          <h2>Know the passage.<br /><em>Own the moment.</em></h2>
          <p>Build your knowledge, strengthen your recall, and prepare for your next competition.</p>
        </div>
        <p className="training-login-motto">Discover · Interpret · Serve</p>
      </section>
      <section className="training-login-main" aria-labelledby="login-heading">
        <Link to="/" className="training-login-back" data-testid="login-join-academy">← Back to home</Link>
        <div className="training-login-form-wrap">

          <h1 id="login-heading">Sign in</h1>
          <p className="training-login-intro">Your next step starts here. Continue to your training space.</p>
          <form onSubmit={(event) => void onSubmit(event)} aria-busy={pending}>
            <label htmlFor="login-identifier">Email or username</label>
            <Input id="login-identifier" data-testid="login-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter your email or username" aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} disabled={pending} required />
            <label htmlFor="login-password">Password</label>
            <div className="training-login-password">
              <Input id="login-password" data-testid="login-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" aria-invalid={!!error} aria-describedby={[error && "login-error", capsLock && "login-caps-lock"].filter(Boolean).join(" ") || undefined} onKeyDown={event => setCapsLock(event.getModifierState("CapsLock"))} onKeyUp={event => setCapsLock(event.getModifierState("CapsLock"))} onBlur={() => setCapsLock(false)} disabled={pending} required />
              <Button variant="ghost" size="compact" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} disabled={pending} onClick={() => setShowPassword((open) => !open)}>{showPassword ? "Hide" : "Show"}</Button>
            </div>
            {capsLock && <p id="login-caps-lock" className="training-login-caps" role="status">Caps Lock is on.</p>}
            {error && <Notice id="login-error" className="training-login-error" tone="danger">{error}</Notice>}
            <Button data-testid="login-submit" className="training-login-submit" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}<AppIcon name="arrow" /></Button>
          </form>
          <p className="training-login-help">Need help signing in?<br />Ask your coach or academy administrator.</p>
        </div>
        <p className="training-login-footer">SCRIPTURE · DISCIPLESHIP · REAL-WORLD FAITH</p>
      </section>
    </main>
  );
}
