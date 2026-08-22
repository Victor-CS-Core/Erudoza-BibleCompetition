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

AI is not on the study path. `QuestionLifecycleService` is the only application service that can promote a generated candidate to a playable question.

Competition simulation obeys the season's stored rule-profile version. `PBE_STYLE_V1` forbids multiple-choice in simulation.

## Consequences

Student study continues when OpenAI is disabled or unavailable. The first playable activity never reconstructs Scripture from a model.
