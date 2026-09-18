import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { onboardingApi, type AdultRole, type Coach, type CoachInvitation } from "../../api/onboarding";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, EmptyState, Input, LinkButton, LoadingState, Notice, PageHeader, Panel, Select, useToast } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { useCoachOptions } from "../auth/useCoachOptions";
import "../../styles/coach-onboarding.css";

const ROLES: AdultRole[] = ["Owner", "Admin", "Content Manager"];

export function CoachesPage() {
  const { me, loading, error: authError } = useAuth();
  const allowed = !loading && !authError && me?.kind === "Adult" && (me.role === "Owner" || me.role === "Admin");
  const isOwner = !loading && !authError && me?.kind === "Adult" && me.role === "Owner";
  const { options } = useCoachOptions();
  const client = useQueryClient();
  const enabled = !!allowed;
  const coaches = useQuery({ queryKey: ["coaches", me?.organizationId], queryFn: () => onboardingApi.coaches(me!.organizationId), enabled });
  const invitations = useQuery({ queryKey: ["coach-invitations", me?.organizationId], queryFn: () => onboardingApi.invitations(me!.organizationId), enabled: !!isOwner });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdultRole>("Admin");
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const [revoking, setRevoking] = useState<CoachInvitation | null>(null);
  const [removing, setRemoving] = useState<Coach | null>(null);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const emailDelivery = options?.available ?? true;
  const forbidden = [coaches.error, invitations.error].some(failure => failure instanceof ApiError && [401, 403].includes(failure.status));
  useEffect(() => { if (error && !pending && !revoking && !removing) form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [error, pending, revoking, removing]);

  async function mutate(kind: "invite" | "resend" | "revoke", invitation?: CoachInvitation) {
    if (busy.current || !isOwner || forbidden) return;
    busy.current = true; setPending(true); setError(""); setInviteUrl("");
    try {
      if (kind === "invite") {
        const result = await onboardingApi.invite(me!.organizationId, email.trim(), role);
        setEmail("");
        if (result.inviteUrl) { setInviteUrl(result.inviteUrl); toast.success(`Invitation created for ${result.email}. Share this link with them directly — it will not be emailed:`); }
        else toast.success(`Invitation sent to ${result.email}.`);
      } else if (kind === "resend" && invitation) {
        const result = await onboardingApi.resend(me!.organizationId, invitation.id);
        if (result.inviteUrl) { setInviteUrl(result.inviteUrl); toast.success(`New invitation for ${result.email} created. Share this link with them directly — the previous link no longer works:`); }
        else toast.success(`New invitation sent to ${result.email}. The previous link no longer works.`);
      } else if (kind === "revoke" && invitation) {
        await onboardingApi.revoke(me!.organizationId, invitation.id);
        toast.success(`Invitation revoked for ${invitation.email}.`); setRevoking(null);
      }
      await Promise.all([client.invalidateQueries({ queryKey: ["coach-invitations", me!.organizationId] }), client.invalidateQueries({ queryKey: ["coaches", me!.organizationId] })]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update this invitation. Try again."); }
    finally { busy.current = false; setPending(false); }
  }
  function invite(event: FormEvent) { event.preventDefault(); void mutate("invite"); }

  async function changeRole(coach: Coach, next: AdultRole) {
    if (roleBusy || next === coach.role) return;
    setRoleBusy(coach.userId); setError("");
    try {
      await onboardingApi.changeRole(me!.organizationId, coach.userId, next);
      toast.success(`${coach.displayName} is now ${next === "Owner" ? "an Owner" : next === "Admin" ? "an Admin" : "a Content Manager"}.`);
      await client.invalidateQueries({ queryKey: ["coaches", me!.organizationId] });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to change this role. Try again."); }
    finally { setRoleBusy(null); }
  }
  async function removeCoach() {
    if (!removing || roleBusy) return;
    setRoleBusy(removing.userId); setError("");
    try {
      await onboardingApi.removeCoach(me!.organizationId, removing.userId);
      toast.success(`${removing.displayName} has been removed from this club.`); setRemoving(null);
      await client.invalidateQueries({ queryKey: ["coaches", me!.organizationId] });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to remove this coach. Try again."); }
    finally { setRoleBusy(null); }
  }
  async function copyInviteUrl() {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { setCopied(false); }
  }

  if (loading) return <LoadingState label="Checking your account…" />;
  if (!allowed) return <div className="training-page"><PageHeader title="Coaches" /><Notice tone="danger">Only club owners and coaches can manage coach invitations.</Notice><LinkButton to={me?.kind === "Student" ? "/student" : "/login"}>Return to your workspace</LinkButton></div>;
  return <div className="training-page">
    <PageHeader title="Coaches" help={`Manage adult access to ${me!.organizationName}. ${isOwner ? "You can invite owners, coaches, and content managers." : "Only the club Owner can invite coaches or manage invitations."}`} />
    {!options ? <LoadingState label="Checking coach invitations…" />
      : forbidden ? <Notice tone="danger">You do not have permission to manage coaches for this club. Sign in with an authorized coach account.</Notice>
      : coaches.isError || invitations.isError ? <Panel><Notice tone="danger">Unable to load coaches and invitations. Check your connection and try again.</Notice><Button variant="secondary" onClick={() => { void coaches.refetch(); void invitations.refetch(); }}>Try again</Button></Panel>
      : coaches.isLoading || invitations.isLoading ? <LoadingState label="Loading coaches and invitations…" /> : <>
        {error && !revoking && !removing && <Notice id="coach-invite-error" tone="danger">{error}</Notice>}
        <Panel id="coach-directory"><h2>Coach directory</h2>
          {coaches.data?.length ? <ul className="coach-directory">{coaches.data.map(coach => <li key={coach.userId}><ProfileAvatar userId={coach.userId} displayName={coach.displayName} /><div className="coach-directory-detail"><strong>{coach.displayName}</strong><p>{coach.email ?? "No email on file"}{coach.userId === me!.userId ? " · You" : ""}</p></div>
            {isOwner && coach.userId !== me!.userId
              ? <div className="coach-directory-actions">
                  <Select value={coach.role} onChange={event => void changeRole(coach, event.target.value as AdultRole)} disabled={roleBusy === coach.userId} aria-label={`Change role for ${coach.displayName}`}>
                    {ROLES.map(option => <option key={option} value={option}>{option}</option>)}
                  </Select>
                  <Button variant="ghost" size="compact" disabled={roleBusy === coach.userId} onClick={() => { setError(""); setRemoving(coach); }} aria-label={`Remove ${coach.displayName} from this club`}>Remove</Button>
                </div>
              : <Badge>{coach.role}</Badge>}
          </li>)}</ul> : <EmptyState title="No coaches to show" description="Refresh the directory to check the latest club access." />}
        </Panel>
        {isOwner ? <>
          {inviteUrl && <Panel id="coach-invite-link"><h2>Share this invitation link</h2><p>Email delivery is not configured on this site, so the invitation will not be sent automatically. Send this link to them yourself — it expires in seven days.</p>
            <p className="coach-invite-link-row"><code>{inviteUrl}</code><Button variant="secondary" size="compact" onClick={() => void copyInviteUrl()}>{copied ? "Copied" : "Copy link"}</Button></p></Panel>}
          <Panel id="invite-coach"><h2>Invite a coach</h2><p>{emailDelivery ? "Send an invitation to another adult. They will verify their email and create a password to join this club." : "Create an invitation for another adult, then share the link with them yourself. Email delivery is not configured on this site."}</p>
            <form ref={form} className="coach-invite-form" onSubmit={invite} aria-busy={pending}>
              <label htmlFor="coach-invite-email">Coach email address</label><Input id="coach-invite-email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={pending} aria-invalid={!!error && !revoking && !removing} aria-describedby={error && !revoking && !removing ? "coach-invite-error" : "coach-invite-help"} />
              <label htmlFor="coach-invite-role">Role</label><Select id="coach-invite-role" value={role} onChange={event => setRole(event.target.value as AdultRole)} disabled={pending}>
                {ROLES.map(option => <option key={option} value={option}>{option}</option>)}
              </Select>
              <p id="coach-invite-help">Invitations last seven days. Existing accounts cannot be moved to another club through an invitation.</p>
              <Button type="submit" disabled={pending}>{pending ? "Updating invitation…" : emailDelivery ? "Send invitation" : "Create invitation"}</Button>
            </form>
          </Panel>
          <Panel id="coach-invitations"><h2>Invitations</h2>
            {invitations.data?.length ? <ul className="coach-directory">{invitations.data.map(invitation => <li key={invitation.id}>
              <div className="coach-directory-detail"><strong>{invitation.email}</strong><p>{invitation.status === "pending" ? "Expires" : "Expiry"} {new Date(invitation.expiresAt).toLocaleDateString()}</p></div>
              <div className="coach-invitation-meta">
                <Badge>{invitation.role}</Badge>
                <Badge tone={invitation.status === "accepted" ? "success" : invitation.status === "expired" ? "warning" : "neutral"}>{invitation.status[0].toUpperCase() + invitation.status.slice(1)}</Badge>
                {(invitation.status === "pending" || invitation.status === "expired") && <div className="coach-form-actions"><Button variant="secondary" size="compact" disabled={pending} onClick={() => void mutate("resend", invitation)} aria-label={`Resend invitation to ${invitation.email}`}>Resend</Button><Button variant="ghost" size="compact" disabled={pending} onClick={() => { setError(""); setRevoking(invitation); }} aria-label={`Revoke invitation for ${invitation.email}`}>Revoke</Button></div>}
              </div>
            </li>)}</ul> : <EmptyState title="No invitations yet" description="Invite a coach above to share the work of running your club." />}
          </Panel>
        </> : <Panel id="coach-invitations-owner-only"><h2>Invitations</h2><Notice tone="info">Only the club Owner can invite coaches, resend or revoke invitations, or change adult roles.</Notice></Panel>}
      </>}
    {revoking && <ConfirmationDialog title="Revoke coach invitation?" description={`The invitation for ${revoking.email} will stop working immediately. This does not remove an existing coach account.`} confirmLabel="Revoke invitation" pendingLabel="Revoking…" variant="danger" pending={pending} error={error} onCancel={() => { setRevoking(null); setError(""); }} onConfirm={() => void mutate("revoke", revoking)} />}
    {removing && <ConfirmationDialog title={`Remove ${removing.displayName} from this club?`} description="They will lose all coach access immediately. Their student-facing history stays intact. This cannot be undone from this page." confirmLabel="Remove coach" pendingLabel="Removing…" variant="danger" pending={roleBusy === removing.userId} error={error} onCancel={() => { setRemoving(null); setError(""); }} onConfirm={() => void removeCoach()} />}
  </div>;
}
