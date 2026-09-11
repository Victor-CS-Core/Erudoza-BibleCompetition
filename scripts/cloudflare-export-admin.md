# Fresh deployment with one existing administrator

`cloudflare-export-admin.mjs` reads an EF SQLite database in read-only mode. It exports one explicitly selected active Owner/Admin, their one organization, and their membership as the native user's organization and role. It excludes every other account, content, history, archive, and authentication session.

Use Node 24 or later. Inventory contains identity metadata only:

```powershell
node scripts/cloudflare-export-admin.mjs --source apps/api/src/Erudoza.Api/erudoza.dev.db --list
```

Prepare a private, one-line password file under ignored `.local/deployment/` using a cryptographic random generator. For hosting, replace any known development password in the export with `--new-password-file`. This changes only the exported credential; it never resets the source account. The fresh salt, PBKDF2-SHA256 hash, and credential version are included in the first user INSERT.

```powershell
node scripts/cloudflare-export-admin.mjs --source apps/api/src/Erudoza.Api/erudoza.dev.db --admin-id <selected-guid> --new-password-file .local/deployment/admin-password.txt --output apps/web/test-results/migration/admin-only-deployment
```

The output directory must be new and within ignored `apps/web/test-results/migration/`. `admin.sql` is a private credential artifact; `manifest.json` contains identity, excluded-data categories, counts, source file fingerprints, and verification results, with no password or password hash. The script validates the SQL twice against the native schema in memory before writing it, and verifies source database/WAL bytes did not change during extraction.

Apply in this order: native schema, `admin.sql`, then the built-in NKJV installer. The SQL refuses an existing application containing other users, content, history, sessions, or login limits. An identical artifact can be retried before NKJV is installed, but it cannot overwrite differing identities or credentials. This exporter neither applies SQL to a remote database nor deploys the application. Keep private artifacts out of publication assets and logs.

Without `--new-password-file`, the exporter preserves the existing hash and credential version; use that mode only when preserving an appropriate existing private credential is intended. Do not use it to host a repository default password.

```powershell
node --test scripts/cloudflare-export-admin.test.mjs
```
