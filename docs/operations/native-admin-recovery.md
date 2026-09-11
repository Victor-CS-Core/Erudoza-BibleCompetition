# Native administrator recovery

The native Worker uses opaque, random sessions stored as token hashes in D1. It needs no application signing secret or ASP.NET data-protection keys. Keep the Cloudflare API token outside application bindings.

For staging, provision the schema, approved NKJV library and retained administrator before opening the site. Configure the real D1 database ID, `DB`, `ROOMS`, `REPORTS`, `PASSWORD_CRYPTO`, static assets and the exact HTTPS `PUBLIC_ORIGIN` (no trailing slash). `PASSWORD_CRYPTO` binds the exported `PasswordCrypto` class and requires a new SQLite Durable Object class migration. A successful health request only checks database connectivity; it does not prove accounts or the library were installed.

Login verification and student password creation/reset perform their 100,000-iteration PBKDF2 work through internal Durable Object RPC. Requests are distributed over 64 deterministic shards; these objects never store or log credentials and expose no public HTTP endpoint. Origin checks, login throttling and administrator authorization stay in the front Worker. A missing crypto binding fails closed rather than running PBKDF2 within the Free Worker's CPU allowance. The offline recovery generator below is unaffected.

## Recover an existing administrator

Use the operator's authenticated Cloudflare CLI access. This tool does not create a first coach, enable a disabled account, change privileges, or contact any database.

1. Verify the intended staging database and select the administrator's exact `id`, `org_id`, `user_name`, `kind`, `role`, and `active` fields. The target must already be an active Adult Owner or Admin. Do not select or print password hashes.
2. From `apps/web`, generate a private SQL file. The password is supplied through stdin, never a command-line argument. For PowerShell:

   ```powershell
   $recoverySecret = Read-Host 'New administrator password' -MaskInput
   $recoverySecret | node scripts/native-admin-recovery.mjs --organization ORGANIZATION_UUID --user USER_UUID --out C:/private/admin-recovery.sql
   Remove-Variable recoverySecret
   ```

   Use an existing private directory. The generator refuses to overwrite a file. The file contains a salted password hash, not plaintext; treat it as credential material and do not commit or upload it with application assets.
3. Review the exact organization/user predicate. Apply that file using `wrangler d1 execute` with the explicitly verified database and staging configuration. The update must return exactly one row identifying the intended administrator. Zero rows means no account matched; stop and verify the IDs and eligibility. Do not broaden the predicate.
4. Sign in using the replacement password and verify `/api/v1/me` identifies the intended administrator. The old password and existing sessions must no longer authenticate. Rotation is atomic because every request compares the stored session credential version against the user row. Remove the private recovery SQL file after verification.

## Staging authentication smoke checks

- Health returns the native runtime; anonymous `/api/v1/me` returns 401.
- Valid administrator login returns a `Secure; HttpOnly; SameSite=Lax` host-only cookie. Subsequent `/me` returns the retained organization/admin only.
- Wrong-password login returns 401. A cross-origin login returns 403 without issuing a session.
- Library returns 66 books; Ephesians has six chapters and Jude one. The retained administrator can browse source text.
- Logout invalidates the captured cookie. Re-login succeeds. Confirm the fresh tenant contains no old students, seasons, assignments or attempts.
- Inspect deployed CPU metrics for valid and invalid login, student creation/password reset, and representative study requests. Local Miniflare success and wall-clock timings do not establish deployed CPU compliance. Preserve the existing 100,000-iteration PBKDF2 work factor.

Cloudflare currently documents a 10 ms CPU budget per Free HTTP invocation; excess can cause error 1102. Validate the deployed path before declaring the Free configuration ready: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
