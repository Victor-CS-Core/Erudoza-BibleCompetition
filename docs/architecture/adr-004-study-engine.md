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

AI is not on the study path until a coach approves a validated candidate. `QuestionLifecycleService` is the only application service that can promote a generated candidate to a playable question. Approved short-answer cards may then appear after the first deterministic Missing Words card.

Competition simulation obeys the season's stored rule-profile version. `PBE_STYLE_V1` forbids multiple-choice in simulation and caps True/False at 10% of the session. True/False statements use only stored verse wording.

Review mode draws only from knowledge units whose review schedule is due. A missed attempt is due immediately.

## Consequences

Student study continues when OpenAI is disabled or unavailable. The first playable activity never reconstructs Scripture from a model.
