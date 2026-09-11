import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { onboardingApi, type CodeReceipt, type InvitationDetails } from "../../api/onboarding";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { PathfinderBackdrop } from "../../components/brand/PathfinderBackdrop";
import { Button, Input, LinkButton, LoadingState, Notice, PageHeader } from "../../components/ui";
import { TurnstileChallenge } from "./TurnstileChallenge";
import { useCoachOptions } from "./useCoachOptions";
import "../../styles/coach-onboarding.css";

type Mode = "signup" | "recovery" | "invitation";
const titles: Record<Mode, string> = { signup: "Create your club", recovery: "Reset your coach password", invitation: "Join as a coach" };
const actions: Record<Mode, "coach_signup" | "coach_recovery" | "coach_invitation"> = { signup: "coach_signup", recovery: "coach_recovery", invitation: "coach_invitation" };
const messages: Record<Mode, string> = {
  signup: "Verify your email, then create a coach account and a new club for your students.",
  recovery: "Use the email address on your coach account. Students should ask their coach to reset their password.",
  invitation: "Verify the email address that received your invitation, then create your coach account.",
};
function fragmentToken(hash: string) {
  const raw = hash.slice(1);
  const value = raw.includes("=") ? new URLSearchParams(raw).get("token") : raw;
  return value && value.length <= 1024 ? value : "";
}

export function CoachOnboardingPage({ mode }: { mode: Mode }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Kept only in this mounted flow; never persisted in storage or a query cache.
  const [invitationToken, setInvitationToken] = useState(() => mode === "invitation" ? fragmentToken(location.hash) : "");
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [invitationError, setInvitationError] = useState("");
  const { options, retry } = useCoachOptions();
  const [email, setEmail] = useState("");
  const [receipt, setReceipt] = useState<(CodeReceipt & { email: string; resendAt: number }) | null>(null);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [retryAt, setRetryAt] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const cooldown = Math.max(0, Math.ceil((Math.max(receipt?.resendAt ?? 0, retryAt) - now) / 1000));
  const expired = !!receipt && Date.parse(receipt.expiresAt) <= now;

  useEffect(() => {
    if (mode === "invitation" && location.hash) void navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: location.state });
  }, [mode, location.hash, location.pathname, location.search, location.state, navigate]);
  useEffect(() => {
    if (mode !== "invitation" || !invitationToken || auth.loading || auth.me || auth.error || !options?.available) return;
    let active = true;
    void onboardingApi.invitationDetails(invitationToken).then(details => { if (active) setInvitation(details); })
      .catch(failure => { if (active) setInvitationError(failure instanceof Error ? failure.message : "This invitation is unavailable. Ask your coach for a new invitation."); });
    return () => { active = false; };
  }, [mode, invitationToken, auth.loading, auth.me, auth.error, options?.available]);
  useEffect(() => {
    if (!receipt && !retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [receipt, retryAt]);
  useEffect(() => { if (receipt) form.current?.querySelector<HTMLInputElement>("#coach-code")?.focus(); }, [receipt]);
  useEffect(() => {
    if (error && !pending) form.current?.querySelector<HTMLInputElement>(receipt ? "#coach-code" : "#coach-email")?.focus();
  }, [error, pending, receipt]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    if (submitting.current || !turnstileToken || cooldown || auth.me || auth.loading || auth.error) return;
    submitting.current = true; setPending(true); setError("");
    const recipient = receipt?.email ?? email.trim();
    try {
      const next = mode === "signup" ? await onboardingApi.signupCode(recipient, turnstileToken)
        : mode === "recovery" ? await onboardingApi.recoveryCode(recipient, turnstileToken)
        : await onboardingApi.invitationCode(invitationToken, recipient, turnstileToken);
      const time = Date.now(); setNow(time);
      setReceipt({ ...next, email: recipient, resendAt: time + next.resendAfterSeconds * 1000 });
      setCode("");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) { const time = Date.now(); setNow(time); setRetryAt(time + (failure.retryAfterSeconds ?? 60) * 1000); }
      setError(failure instanceof Error ? failure.message : "Unable to send a code. Try again later.");
    }
    finally { setTurnstileToken(null); setResetKey(value => value + 1); submitting.current = false; setPending(false); }
  }
  async function finish(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !receipt || expired || auth.me || auth.loading || auth.error) return;
    submitting.current = true; setPending(true); setError("");
    try {
      const body = { challengeId: receipt.challengeId, code, password };
      if (mode === "recovery") { await onboardingApi.recoveryComplete(body); setPassword(""); setCode(""); setReceipt(null); setComplete(true); }
      else {
        const next = mode === "signup" ? await onboardingApi.signupComplete({ ...body, displayName: displayName.trim(), organizationName: organizationName.trim() })
          : await onboardingApi.invitationComplete({ ...body, displayName: displayName.trim() });
        await auth.acceptSession(next); setInvitationToken(""); setPassword(""); setCode("");
        void navigate("/admin", { replace: true });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to verify this code. Try again or request a new code.");
      // Another tab may have signed in while this email-verification flow was open.
      if (failure instanceof ApiError && failure.status === 409) await auth.refresh();
    }
    finally { submitting.current = false; setPending(false); }
  }
  async function signOut() {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError("");
    try { await auth.logout(); setReceipt(null); setPassword(""); setCode(""); setTurnstileToken(null); }
    catch { setError("Could not sign out. Try again before continuing."); }
    finally { submitting.current = false; setPending(false); }
  }
  const invitationUnavailable = mode === "invitation" && (!invitationToken || invitationError);
  const ready = options?.available && options.turnstileSiteKey && !invitationUnavailable && (mode !== "invitation" || invitation);
  return <main className="training-login coach-onboarding">
    <section className="training-login-hero" aria-label="Erudoza">
      <Link className="training-login-brand" to="/" aria-label="Erudoza home"><ErudozaWordmark inverted /></Link>
      <div className="training-login-message"><h2>Give your team<br /><em>a place to grow.</em></h2><p>Choose passages, guide your students, and prepare for competition together.</p></div>
      <img className="training-login-art training-login-coach-art" src="/assets/training/coach-guide-960.webp" width={960} height={640} loading="lazy" alt="" />
      <p className="training-login-motto">Discover · Interpret · Serve</p>
    </section>
    <section className="training-login-main pathfinder-canvas" aria-label={titles[mode]}>
      <PathfinderBackdrop />
      <Link to="/login" className="training-login-back">Back to sign in</Link>
      <div className="training-login-form-wrap">
        <PageHeader title={titles[mode]} description={messages[mode]} />
        {auth.loading ? <LoadingState label="Checking your account…" /> : auth.error ? <><Notice tone="danger">{auth.error}</Notice><Button onClick={() => void auth.refresh()}>Try again</Button></> : auth.me ? <>
          <Notice>You are signed in as {auth.me.displayName}. Sign out before continuing with another coach account.</Notice>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="coach-form-actions"><LinkButton variant="secondary" to={auth.me.kind === "Student" ? "/student" : "/admin"}>Return to your workspace</LinkButton><Button onClick={() => void signOut()} disabled={pending}>{pending ? "Signing out…" : "Sign out to continue"}</Button></div>
        </> : complete ? <><Notice tone="success">Your password has been reset. Sign in with your new password.</Notice><LinkButton to="/login">Sign in</LinkButton></> : !options ? <LoadingState label="Checking coach account services…" /> : !options.available ? <>
          <Notice>Coach account services are currently unavailable. Please try again later or contact your academy administrator.</Notice><Button variant="secondary" onClick={retry}>Check availability again</Button>
        </> : invitationUnavailable ? <Notice tone="danger">{invitationError || "Open the complete invitation link from your email. If it has expired or been revoked, ask your coach for a new invitation."}</Notice> : !ready ? <LoadingState label="Checking your invitation…" /> : <>
          {invitation && <Notice>Join <strong>{invitation.organizationName}</strong>. This invitation was sent to {invitation.emailHint} and expires {new Date(invitation.expiresAt).toLocaleDateString()}.</Notice>}
          {receipt ? <>
            <Notice>{mode === "recovery" ? "If this email belongs to an eligible coach, a code has been sent to " : "Check your email for a code sent to "}<strong>{receipt.email}</strong>. Only the newest code works.</Notice>
            <form ref={form} onSubmit={event => void finish(event)} aria-busy={pending}>
              <label htmlFor="coach-code">Verification code</label>
              <Input id="coach-code" value={code} onChange={event => setCode(event.target.value.replace(/\s/g, ""))} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={pending} aria-invalid={!!error || expired} aria-describedby={`coach-code-help${error ? " coach-error" : ""}`} />
              <p id="coach-code-help">{expired ? "This code has expired. Request a new code below." : `Six digits. Expires at ${new Date(receipt.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}</p>
              {mode !== "recovery" && <><label htmlFor="coach-name">Your name</label><Input id="coach-name" value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" maxLength={100} required disabled={pending} /></>}
              {mode === "signup" && <><label htmlFor="coach-club">Club name</label><Input id="coach-club" value={organizationName} onChange={event => setOrganizationName(event.target.value)} autoComplete="organization" maxLength={100} required disabled={pending} /></>}
              <label htmlFor="coach-password">New password</label>
              <div className="training-login-password"><Input id="coach-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending} aria-describedby="coach-password-help" /><Button variant="ghost" size="compact" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} disabled={pending} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</Button></div>
              <p id="coach-password-help">Use 12–128 characters. A long, unique phrase works well.</p>
              {error && <Notice id="coach-error" tone="danger">{error}</Notice>}
              <Button type="submit" disabled={pending || expired}>{pending ? "Verifying…" : mode === "signup" ? "Create club and coach account" : mode === "recovery" ? "Reset password" : "Join club as a coach"}</Button>
            </form>
            <div className="coach-code-resend"><p>Need another code? Complete the security check again.</p><TurnstileChallenge siteKey={options.turnstileSiteKey!} action={actions[mode]} resetKey={resetKey} onToken={setTurnstileToken} /><div className="coach-form-actions"><Button variant="secondary" disabled={pending || cooldown > 0 || !turnstileToken} onClick={() => void sendCode()}>{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</Button><Button variant="ghost" disabled={pending} onClick={() => { setReceipt(null); setCode(""); setPassword(""); setError(""); setTurnstileToken(null); }}>Change email</Button></div></div>
          </> : <form ref={form} onSubmit={event => void sendCode(event)} aria-busy={pending}>
            <label htmlFor="coach-email">Email address</label><Input id="coach-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} aria-invalid={!!error} aria-describedby={error ? "coach-error" : undefined} />
            {error && <Notice id="coach-error" tone="danger">{error}</Notice>}
            <TurnstileChallenge siteKey={options.turnstileSiteKey!} action={actions[mode]} resetKey={resetKey} onToken={setTurnstileToken} />
            <Button type="submit" disabled={pending || cooldown > 0 || !turnstileToken}>{pending ? "Sending code…" : cooldown > 0 ? `Send code in ${cooldown}s` : "Send verification code"}</Button>
          </form>}
        </>}
        <p className="training-login-help">Students: use the account your coach provided. Ask your coach for help signing in.</p>
      </div>
    </section>
  </main>;
}
