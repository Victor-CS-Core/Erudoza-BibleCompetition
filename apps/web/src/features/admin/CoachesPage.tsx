import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { onboardingApi, type CoachInvitation } from "../../api/onboarding";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, EmptyState, Input, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { useCoachOptions } from "../auth/useCoachOptions";
import "../../styles/coach-onboarding.css";

export function CoachesPage() {
  const { me, loading, error: authError } = useAuth();
  const allowed = !loading && !authError && me?.kind === "Adult" && (me.role === "Owner" || me.role === "Admin");
  const { options, retry } = useCoachOptions();
  const client = useQueryClient();
  const enabled = !!allowed && !!options?.available;
  const coaches = useQuery({ queryKey: ["coaches", me?.organizationId], queryFn: () => onboardingApi.coaches(me!.organizationId), enabled });
  const invitations = useQuery({ queryKey: ["coach-invitations", me?.organizationId], queryFn: () => onboardingApi.invitations(me!.organizationId), enabled });
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const [revoking, setRevoking] = useState<CoachInvitation | null>(null);
  const forbidden = [coaches.error, invitations.error].some(failure => failure instanceof ApiError && [401, 403].includes(failure.status));
  useEffect(() => { if (error && !pending && !revoking) form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [error, pending, revoking]);

  async function mutate(kind: "invite" | "resend" | "revoke", invitation?: CoachInvitation) {
    if (busy.current || !allowed || !options?.available || forbidden) return;
    busy.current = true; setPending(true); setError(""); setStatus("");
    try {
      if (kind === "invite") {
        const result = await onboardingApi.invite(me!.organizationId, email.trim());
        setStatus(`Invitation sent to ${result.email}.`); setEmail("");
      } else if (kind === "resend" && invitation) {
        const result = await onboardingApi.resend(me!.organizationId, invitation.id);
        setStatus(`New invitation sent to ${result.email}. The previous link no longer works.`);
      } else if (kind === "revoke" && invitation) {
        await onboardingApi.revoke(me!.organizationId, invitation.id);
        setStatus(`Invitation revoked for ${invitation.email}.`); setRevoking(null);
      }
      await Promise.all([client.invalidateQueries({ queryKey: ["coach-invitations", me!.organizationId] }), client.invalidateQueries({ queryKey: ["coaches", me!.organizationId] })]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update this invitation. Try again."); }
    finally { busy.current = false; setPending(false); }
  }
  function invite(event: FormEvent) { event.preventDefault(); void mutate("invite"); }

  if (loading) return <LoadingState label="Checking your account…" />;
  if (!allowed) return <div className="training-page"><PageHeader title="Coaches" /><Notice tone="danger">Only club owners and coaches can manage coach invitations.</Notice><LinkButton to={me?.kind === "Student" ? "/student" : "/login"}>Return to your workspace</LinkButton></div>;
  return <div className="training-page">
    <PageHeader title="Coaches" description={`Manage coach access to ${me!.organizationName}. Invited coaches can manage students, seasons, and club content.`} />
    {!options ? <LoadingState label="Checking coach invitations…" /> : !options.available ? <Panel><Notice>Coach invitations are currently unavailable. Please try again later or contact your academy administrator.</Notice><Button variant="secondary" onClick={retry}>Check availability again</Button></Panel>
      : forbidden ? <Notice tone="danger">You do not have permission to manage coaches for this club. Sign in with an authorized coach account.</Notice>
      : coaches.isError || invitations.isError ? <Panel><Notice tone="danger">Unable to load coaches and invitations. Check your connection and try again.</Notice><Button variant="secondary" onClick={() => { void coaches.refetch(); void invitations.refetch(); }}>Try again</Button></Panel>
      : coaches.isPending || invitations.isPending ? <LoadingState label="Loading coaches and invitations…" /> : <>
        {status && <Notice tone="success">{status}</Notice>}
        {error && !revoking && <Notice id="coach-invite-error" tone="danger">{error}</Notice>}
        <Panel id="coach-directory"><h2>Coach directory</h2>
          {coaches.data.length ? <ul className="coach-directory">{coaches.data.map(coach => <li key={coach.userId}><div className="coach-directory-detail"><strong>{coach.displayName}</strong><p>{coach.email ?? "No email on file"}{coach.userId === me!.userId ? " · You" : ""}</p></div><Badge>{coach.role}</Badge></li>)}</ul> : <EmptyState title="No coaches to show" description="Refresh the directory to check the latest club access." />}
        </Panel>
        <Panel id="invite-coach"><h2>Invite a coach</h2><p>Send an invitation to another adult. They will verify their email and create a password to join this club.</p>
          <form ref={form} className="coach-invite-form" onSubmit={invite} aria-busy={pending}>
            <label htmlFor="coach-invite-email">Coach email address</label><Input id="coach-invite-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} aria-invalid={!!error && !revoking} aria-describedby={error && !revoking ? "coach-invite-error" : "coach-invite-help"} />
            <p id="coach-invite-help">Invitations last seven days. Existing accounts cannot be moved to another club through an invitation.</p>
            <Button type="submit" disabled={pending}>{pending ? "Updating invitation…" : "Send invitation"}</Button>
          </form>
        </Panel>
        <Panel id="coach-invitations"><h2>Invitations</h2>
          {invitations.data.length ? <ul className="coach-directory">{invitations.data.map(invitation => <li key={invitation.id}>
            <div className="coach-directory-detail"><strong>{invitation.email}</strong><p>{invitation.status === "pending" ? "Expires" : "Expiry"} {new Date(invitation.expiresAt).toLocaleDateString()}</p></div>
            <Badge tone={invitation.status === "accepted" ? "success" : invitation.status === "expired" ? "warning" : "neutral"}>{invitation.status[0].toUpperCase() + invitation.status.slice(1)}</Badge>
            {(invitation.status === "pending" || invitation.status === "expired") && <div className="coach-form-actions"><Button variant="secondary" size="compact" disabled={pending} onClick={() => void mutate("resend", invitation)} aria-label={`Resend invitation to ${invitation.email}`}>Resend</Button><Button variant="ghost" size="compact" disabled={pending} onClick={() => { setError(""); setRevoking(invitation); }} aria-label={`Revoke invitation for ${invitation.email}`}>Revoke</Button></div>}
          </li>)}</ul> : <EmptyState title="No invitations yet" description="Invite a coach above to share the work of running your club." />}
        </Panel>
      </>}
    {revoking && <ConfirmationDialog title="Revoke coach invitation?" description={`The invitation for ${revoking.email} will stop working immediately. This does not remove an existing coach account.`} confirmLabel="Revoke invitation" pendingLabel="Revoking…" variant="danger" pending={pending} error={error} onCancel={() => { setRevoking(null); setError(""); }} onConfirm={() => void mutate("revoke", revoking)} />}
  </div>;
}
