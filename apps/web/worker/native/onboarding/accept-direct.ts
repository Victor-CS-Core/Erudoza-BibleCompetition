import type { Actor, Env } from "../types";
import { HttpError, json, requiredString } from "../types";
import { COOKIE, authenticate, hashUserPassword, me, sha256, token } from "../auth";
import { findInvitation, ADULT_ROLES } from "./invitations";
import { input, passwordValue, randomSecret } from "./shared";

/**
 * Direct invitation acceptance for deployments without email delivery
 * (e.g. staging). Works ONLY when the email provider is not configured —
 * routes.ts returns 404 otherwise so production always keeps the
 * email-verified flow. The inviter hands the invite URL to the recipient
 * manually; no verification code is involved.
 */
export async function acceptDirectInvitation(request: Request, env: Env): Promise<Response> {
  const data = await input(request);
  if (data.ageConfirmed !== true) throw new HttpError(400, "You must confirm that you are 18 years old or older to create a coach account.");
  const displayName = requiredString(data.displayName, "Name", 100);
  const password = passwordValue(data.password);
  if (token(request)) {
    let signedIn = false;
    try { await authenticate(request, env); signedIn = true; } catch (error) { if (!(error instanceof HttpError && error.status === 401)) throw error; }
    if (signedIn) throw new HttpError(409, "Sign out before joining as a different coach.");
  }
  const invitation = await findInvitation(env, data.token);
  const email = invitation.email;
  const role: Actor["role"] = (ADULT_ROLES as readonly string[]).includes(invitation.role) ? invitation.role as Actor["role"] : "Admin";
  const now = Date.now(), userId = crypto.randomUUID(), credentialVersion = crypto.randomUUID();
  const hash = await hashUserPassword(env, invitation.org_id, userId, password);
  const session = randomSecret(), sessionHash = await sha256(session), expiresAt = now + 8 * 3600_000;
  const results = await env.DB.batch([
    // The conditional insert keeps a concurrent double-accept from creating a
    // second account for the same email; the row count below detects the race.
    env.DB.prepare(`INSERT INTO Users(id,org_id,user_name,email,display_name,kind,role,password_hash,credential_version)
      SELECT ?,?,?,?,?, 'Adult',?,?,? WHERE NOT EXISTS(SELECT 1 FROM Users WHERE email=? OR user_name=?)`)
      .bind(userId, invitation.org_id, email, email, displayName, role, hash, credentialVersion, email, email),
    env.DB.prepare("INSERT INTO Sessions(token_hash,user_id,credential_version,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM Users WHERE id=?)")
      .bind(sessionHash, userId, credentialVersion, expiresAt, userId),
    env.DB.prepare("UPDATE CoachInvitations SET status='accepted',accepted_user_id=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM Users WHERE id=?)").bind(userId, invitation.id, userId),
  ]);
  if (results[0].meta.changes !== 1 || results[2].meta.changes !== 1) throw new HttpError(400, "This invitation is unavailable. Ask your coach for a new invitation.");
  const row = await env.DB.prepare("SELECT o.name AS organization_name FROM Users u JOIN Organizations o ON o.id=u.org_id WHERE u.id=?").bind(userId).first<{ organization_name: string }>();
  if (!row) throw new HttpError(400, "This invitation is unavailable. Ask your coach for a new invitation.");
  const response = json(me({ userId, organizationId: invitation.org_id, organizationName: row.organization_name, userName: email, displayName, email, kind: "Adult", role, credentialVersion }));
  response.headers.set("Set-Cookie", `${COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
  return response;
}
