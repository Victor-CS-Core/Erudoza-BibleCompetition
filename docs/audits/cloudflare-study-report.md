# Native solo study and progress

Implemented `apps/web/worker/native/study/routes.ts`, exporting `handleStudy(context)` plus the persisted `Session`, `Card`, `Attempt`, `Result`, and `Mastery` shapes for migration integration. The parent owns entry-point wiring and the existing application module owns the per-student difficulty update route.

## Behavior

- Start snapshots membership difficulty and the supported PBE_STYLE_V1 rules; Practice targets 8 cards, Simulation 10, and Review the smaller of 8 and the currently eligible due count. Only active seasons with active, licensed, assigned content can start or generate/submit cards.
- Persisted session cards embed immutable generated activity payloads, private answer keys, original prompt/answer sources and timestamps. `next` and resume reuse those cards. Unanswered cards whose prompt or answer source falls outside current scope are rejected. No private answer key is exposed in card DTOs; completed attempt results intentionally include canonical feedback as the existing frontend requires.
- Source selection follows the C# ordering: session exposure, total persisted exposure, due review, primary specialist assignment, oldest exposure, ordinal, knowledge ID. The shared engine supplies all five activity providers and difficulty/mode rules. Exposure is aggregated in D1 rather than loading every historical session.
- One CAS transaction persists the session update, attempt and mastery. Concurrent same-card submissions return the original response snapshot, never grant duplicate mastery, and reject reuse of a submission ID with a different payload. Separate simultaneous sessions use mastery CAS too. Scope, source, pack, season, membership and active-student guards prevent accepting a write after concurrent eligibility changes. Bounded retries reread state after a stale CAS or new-mastery insertion race.
- Mastery uses v2-skill-evidence, answer-source ownership for WhatComesNext, and two-day/correct or immediate/incorrect review schedules. Legacy algorithm states rebuild historical nonduplicate attempt evidence in original order, skipping old sequence evidence without an answer-source identity. Legacy mastery record IDs are retained when found. PVP records never participate.
- Resume includes the latest immutable card, original attempt response and completed summary. Completion requires at least one persisted attempt and is idempotent. Progress filters mastery to current assignment/scope, retains historical attempt counts, returns the frontend DTOs, and only lists active assigned seasons. Historical lists page beyond the Store's 5,000-record per-page limit; exposure uses an uncapped SQL aggregate.

## Verification

The first runtime test run failed with missing-route 404 responses before implementation. After implementation, `npm --workspace apps/web run test -- worker/native/study/routes.test.ts` passes four real Miniflare/D1 tests using synthetic, localhost-only records. They cover immutable resume, concurrent next and duplicate attempts, altered-idempotency payload rejection, invalid response time, original response replay, complete/resume summary, progress, all five activities through a complete eight-card flow, changed source text after generation, legacy mastery rebuild, review eligibility, membership difficulty snapshots, cross-session mastery races, Simulation hint rejection and revoked pack eligibility.

`npm --workspace apps/web run typecheck:native` and targeted ESLint on both study route files passed. Browser interaction and live Cloudflare deployment were not performed by this subtask. Source-generator parity fixtures are maintained separately by the engine subtask; these route tests use the ported engine and real D1, not a C# execution harness.

## Migration boundary

The exported TypeScript interfaces describe the native embedded session representation. Import must map existing immutable cards/attempts into these shapes without regeneration, retain private answer keys, original feedback snapshots and nonduplicate attempts, and preserve source/knowledge identities. No migration exporter, schema, shared Store, .NET implementation or deployment resources were changed here. Only PBE_STYLE_V1 version 1 is currently creatable by management; additional legacy rule profiles require explicit migration validation/mapping.
