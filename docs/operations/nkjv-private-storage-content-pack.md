# NKJV private storage → content pack runbook

> Historical proposal from September 9, 2026. Preserved as dated evidence. Its hosting, import routes and authorization assumptions are superseded by the current [README](../../README.md), [progress log](../../PROGRESS.md) and [Cloudflare operations](cloudflare-native.md); follow current library workflows.

| Field | Value |
| --- | --- |
| Status | **PLAN / RUNBOOK ONLY** — no upload, no Firebase mutation, no deploy, no secrets in git |
| Owner | Jinbe (platform) |
| Date | 2026-09-09 |
| Evidence baseline | `origin/main` @ `1a370cc87fb9e3037d521758f3f34fce1d87acaa` |
| Related | `docs/operations/firebase-host.md`, `docs/operations/openai-and-scripture.md`, README Notes |

## Standing hard rules

Until a **separate captain yes** for each protected step:

1. Do **not** upload, commit, paste, or redistribute NKJV text or JSON.
2. Do **not** mutate live Firebase (storage, Firestore, Hosting, rules).
3. Do **not** deploy, apply DNS, rotate secrets, or enable paid blob/Firebase resources from this runbook alone.
4. Keep NKJV off public Hosting assets, SPA bundles, and git history.
5. Fail closed: `Blob__Provider=Disabled` stays the default until a reviewed provider is approved.

---

## 1. Where the captain’s NKJV lives today

| Fact | Evidence |
| --- | --- |
| Private local source material | README: “The supplied NKJV dataset is private local source material and is not bundled into the public site or uploaded by the build.” |
| Not a public host path | `docs/operations/firebase-host.md`: must not be placed in public Hosting assets or uploaded to Firebase as part of hosting migration |
| Exact filesystem path | **Held by the captain** — not inventable from the repo; do not document a guessed path here |
| Redistribution | Metadata prohibits redistribution without permission |

Operational reading: NKJV is captain-held offline input. The repo only describes that it exists and must stay private.

---

## 2. Licensing / rights gate (before any move)

NKJV is a **copyrighted** translation. Erudoza already documents the public-domain path and the copyrighted ban:

- Allowed catalog path today: World English Bible, KJV, ASV, and other public-domain English texts via [bible-api.com](https://bible-api.com/) → versioned content pack (`docs/operations/openai-and-scripture.md`, `ScriptureCatalog`).
- Explicitly **do not** import NIV, ESV, NLT, **NKJV**, or other copyrighted translations without a publisher license (for example API.Bible commercial terms). Erudoza will not scrape or bundle them.

**Gate checklist (captain yes required):**

- [ ] Written license / rights clearance covers the intended use (private storage + org-scoped content pack + study games from stored text).
- [ ] License covers AI short-answer **candidates** from already-stored verses (if that use is planned).
- [ ] Retention, redistribution, and termination terms understood.
- [ ] `LicensingStatus` / licensing metadata string chosen for the pack (API already stores `LicensingStatus` on `ContentPack`).

No storage move and no pack import of NKJV until this gate is green.

---

## 3. Private accessible storage options (inventory live adapters first)

### Live / documented today (`1a370cc`)

| Adapter | State | Notes |
| --- | --- | --- |
| `Blob__Provider` | **`Disabled`** in `.env.example` | Only `DisabledBlobStorage` implements `IBlobStorage` (health stub; `ProviderName = "Disabled"`). |
| Azurite + SQL Server | Optional local via `infra/local/compose.yaml` | Connection string commented in `.env.example`; not a production NKJV store. |
| Firebase project alias `erudoza` | Reserved for **future storage** | Hosting retired. Storage rules, collections, import jobs, and production data contract must be designed and reviewed **before** any Firebase data upload/mutation (`firebase-host.md`). |
| Relational content model | **Canonical runtime path** | `ContentPack` / `SourceUnit.CanonicalText` via `ContentImportService.ImportAsync`. Games read stored verses, not live blob/Firebase files. |
| Coach UI `/admin/content` | Paste JSON pack | `contentPackImport.ts` / `parseContentPackImport` → `ImportContentPackRequest`. |
| Public-domain catalog import | bible-api.com | Cap: `MaxChaptersPerImport = 8` (catalog service). Not for NKJV. |

### Options that fit Erudoza (decision table — choose after rights yes)

| Option | Fit | Pros | Cons / gaps | Captain yes needed |
| --- | --- | --- | --- | --- |
| **A. Offline convert → API content pack only** (no blob/Firebase yet) | Best next step | Matches live import path; games already read `CanonicalText`; no new infra | NKJV bytes still must never hit git; import must target a **private** API/DB | Rights + private API/DB confirmation |
| **B. Firebase Storage (reserved)** | Future | Aligns with reserved `erudoza` alias | Rules/collections/import jobs **not designed**; live mutation forbidden until reviewed | Design review + rights + mutation yes |
| **C. Azure Blob / Azurite-backed provider** | Future | Compose already optional for local | Production provider not implemented (`Disabled` only); secrets + billing | Implement provider + rights + secrets/billing yes |
| **D. Public host / SPA assets** | **Forbidden** | None | Violates firebase-host + README | Never |

Recommendation until rights clear: stay on **docs + rights**, then prefer **Option A** into a private API database. Do not enable B or C from this PR.

---

## 4. How to import into the API DB as a content pack

### Contract (coach paste / API)

`ImportContentPackRequest` shape (from `apps/web/src/features/admin/contentPackImport.ts`):

- `packKey` (string)
- `version` (positive int)
- `locale` (default `en`)
- `sourceType` (default `Scripture`)
- `documents[]` with `name` + `units[]`
- each unit: `citation`, `bookKey`, `chapter`, `verse`, `ordinal`, `text`

Server path: `ContentImportService.ImportAsync` creates `ContentPack`, `SourceDocument`, `SourceUnit` (`CanonicalText`), and `KnowledgeUnit` (`ExactVerseText`). Same `(organizationId, packKey, version)` is idempotent if unchanged; conflicting changes fail.

### Season wiring

- A season selects **one** content pack.
- Wording changes require a **new pack version** (README + openai-and-scripture.md).
- Study games read stored `CanonicalText` only.

### NKJV-specific procedure (after rights yes — still no public host)

1. Captain converts private NKJV offline into `ImportContentPackRequest` JSON (outside git).
2. Set honest `LicensingStatus` (not `development-sample`).
3. Import via coach `/admin/content` **or** authenticated API against a **private** environment (local/dev DB or future private production API — not public SPA assets).
4. Point season scope at the new pack.
5. Verify sample citations in `/admin/content` (“stored verses”) without exporting packs to public URLs.
6. Never commit the JSON; delete local temp files after successful import per captain retention rules.

---

## 5. What AI may use

From `docs/operations/openai-and-scripture.md` and README:

| Surface | Behavior |
| --- | --- |
| Study games | **Never** call OpenAI — deterministic from stored verse text |
| Generate candidates | OpenAI only when coach clicks Generate; model must copy evidence from **already-stored** verses; validator rejects invented wording |
| Approve | Only path onto a student deck; first card remains Missing Words |
| NKJV | Same rules **after** licensed pack is in the private DB — AI must not become a redistribution channel |

---

## 6. Explicit no-ops until separate captain yes

| Action | Status |
| --- | --- |
| Upload NKJV to public Hosting / Sites / Cloudflare assets | **No** |
| Upload NKJV to Firebase Storage / Firestore | **No** |
| Commit NKJV JSON/text to git | **No** |
| Enable `Blob__Provider` other than `Disabled` | **No** |
| Live Firebase mutation | **No** |
| Deploy / DNS / secret rotation / paid resources | **No** |
| This docs PR | **Yes** (plan only) |

---

## 7. Rollback and secrets hygiene

- Keep NKJV out of git. If it is ever committed by mistake: stop, notify captain, use a captain-approved scrub process — **no force-push** without explicit captain yes.
- Do not paste NKJV, license keys, Firebase service accounts, or blob connection strings into chat, PRs, or issues.
- `.env` / secrets stay local; `.env.example` keeps `Blob__Provider=Disabled`.
- Fail closed on missing rights or missing private API: do not “temporarily” host files publicly.
- Rollback of an imported pack: leave bad version inactive / point season at prior pack version; do not rewrite history of imported units without a reviewed migration.

---

## Recommended phased path

| Phase | Work | Owner | Captain yes? |
| --- | --- | --- | --- |
| **0 (this PR)** | Docs/runbook only | Jinbe | N/A (docs) |
| **1** | Rights / license clearance recorded | Captain (+ counsel as needed) | **Yes** |
| **2** | Choose store: prefer Option A (private API pack); design B/C only if needed | Jinbe + Franky (impl later) | **Yes** on choice |
| **3** | Offline convert NKJV → import JSON (never commit) | Captain / designated operator | **Yes** |
| **4** | Import into private API DB; season select; Chopper smoke on private env | Operator + Chopper | **Yes** (env + smoke) |
| **5** | Optional later: Firebase Storage or Blob provider design → review → implement | Jinbe design, Franky impl, Chopper QA | **Yes** per step |

---

## Pre-flight checklist for captain approval (before any NKJV bytes move)

- [ ] Rights gate complete (section 2)
- [ ] Storage option chosen (section 3) — default recommendation: Option A
- [ ] Target API/DB is private (not public SPA)
- [ ] Operator named; secrets path agreed (no chat paste)
- [ ] Chopper smoke plan on private env defined
- [ ] Explicit **no** live Firebase mutation unless B is separately approved
- [ ] Explicit **no** NKJV in git / public host
- [ ] Rollback plan acknowledged (section 7)

---

## Appendix — evidence pointers (no NKJV bytes)

- `README.md` — NKJV private; content packs; Sites host
- `docs/operations/firebase-host.md` — Hosting retired; Firebase reserved for storage; NKJV not for Hosting migration
- `docs/operations/openai-and-scripture.md` — games vs Generate; public-domain catalog; copyrighted ban
- `apps/api/src/Erudoza.Infrastructure/Storage/DisabledBlobStorage.cs`
- `apps/api/src/Erudoza.Application/Content/ContentImportService.cs`
- `apps/web/src/features/admin/contentPackImport.ts`
- `.env.example` — `Blob__Provider=Disabled`
