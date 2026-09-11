# ADR 004 — Study Engine

Status: Accepted
Date: 2026-08-22

## Decision

The Study Engine selects Challenge Cards from assigned knowledge units and versioned activity providers.

First vertical slice:

- Study mode `Practice`
- Deterministic `MissingWords` activity
- Server-side evaluation
- Idempotent attempts via `clientSubmissionId`
- Mastery algorithm `v1-scaffold`

As of September 9, 2026, all new cards come from deterministic Missing Words, Verse Builder, Reference Match, What Comes Next and True/False providers. The generated-question lifecycle and Short Answer provider have been removed. Coach-selected student-season difficulty and versioned rule snapshots govern each session.

Competition simulation obeys the season's stored rule-profile version. `PBE_STYLE_V1` forbids multiple-choice in simulation and caps True/False at 10% of the session. True/False statements use only stored verse wording.

Review mode draws only from knowledge units whose review schedule is due. A missed attempt is due immediately.

## Consequences

Study has no model dependency, generation jobs, model credentials or generation approval workflow. Historical question tables remain archive-only so existing databases and saved attempts can be retained.
