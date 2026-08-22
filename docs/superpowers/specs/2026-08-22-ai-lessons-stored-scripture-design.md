# AI lessons on stored Scripture

Date: 2026-08-22
Status: Draft for review
Product: Erudoza

## Goal

Let a coach lock one Bible version on a season, then let the system build study games from that stored text and let OpenAI draft lessons and extra short-answer items from the same verses. The model never authors Scripture.

## Locked decisions

1. The season’s content pack **is** the selected version. Changing translation means a new pack and a new scope, not an in-place rewrite.
2. Games stay deterministic: Missing Words, Verse Builder, Reference Match, What Comes Next, and True/False are built from `SourceUnit.CanonicalText`. OpenAI does not create those cards.
3. OpenAI may draft **lesson notes** and **short-answer candidates** only. Both must cite stored units. Evidence text must match a stored verse exactly.
4. `QuestionCandidateValidator` plus coach approval remain the only path from a generated short-answer onto a student deck. The first Practice card stays Missing Words.
5. Students never call OpenAI. Spark Hosting still cannot run the API.
6. Ship public-domain English packs now (WEB, KJV, ASV, and the other catalog entries). Do not scrape or bundle NIV, ESV, NLT, or NKJV. An Adventist/PBE lock to NKJV is a later licensed import (API.Bible / publisher terms), not a model prompt.
7. “Adventist Bible” in this product means: the coach picks the translation the season will memorize, and `PBE_STYLE_V1` still governs simulation. It does not mean the model writes NKJV or Clear Word from memory.

## Why this shape

Token use stays low because verse text is imported once and reused. Games do not spend tokens. Generation sends only the assigned range, not a whole Bible. Competition stays fair because every student sees the same stored wording.

## Architecture

```
Coach picks translation
        ↓
Catalog or licensed import → ContentPack + SourceUnits
        ↓
Season scope points at that pack
        ↓
StudyEngine builds games from CanonicalText
        ↓
OpenAI (optional) drafts lesson + short-answer JSON from those units
        ↓
Validator copies/checks evidence → coach approve/reject
        ↓
Approved short-answer may appear after Missing Words
```

Units:

- **Scripture catalog / import** — already on `cursor/openai-bible-7a00`. Public-domain chapter import becomes a versioned pack (`web-dan-1-1`).
- **Season version lock** — Setup already selects a pack. The UI must show translation name and license, and refuse a scope whose pack does not match the intended version.
- **Deterministic Study Engine** — unchanged providers. No new OpenAI activity type in the first plan.
- **Lesson draft** — new persisted object on the season (or on a scope range): title, body, cited `sourceUnitId`s, generator version. Body may paraphrase for teaching but must not present invented quotation as Scripture. Quoted lines must be stored `CanonicalText`.
- **Short-answer generation** — existing `OpenAiGenerativeQuestionService` + `QuestionReviewService`. Prompt stays “copy evidence exactly.”
- **Validator** — reject missing evidence, out-of-scope units, or evidence text that does not equal the stored verse.

## Data flow

1. Coach imports WEB Daniel 1 (or another catalog range) and selects that pack on the season.
2. Coach clicks Generate. The job loads resolved scope units only.
3. For each batch, OpenAI returns JSON: lesson paragraph(s) and/or one short-answer with `sourceUnitId` and `evidenceText`.
4. Server checks every `evidenceText` against `SourceUnit.CanonicalText`. Failures are stored as Rejected with the reason.
5. Coach edits or approves. Students study the stored games immediately; they see approved short-answer only after approval.

## Error handling

- No API key: games and imported packs still work; generation uses the local fallback and the UI says so.
- OpenAI HTTP or parse failure: fall back per candidate; the job still completes.
- Copyrighted translation requested: API returns a domain error. Do not call a generic Bible site for NIV/ESV/NKJV.
- Lesson quotes a verse that is not in scope: reject that lesson draft.

## Testing

- Catalog import still stores `licensingStatus = public-domain` and rejects non-PD licenses.
- Generation with a key produces `openai-chat-v1` candidates whose evidence equals stored text (already verified locally).
- New lesson tests: exact quote required; invented quotation fails validation; students cannot create lessons.
- Existing Playwright path: first card remains Missing Words.

## Out of scope for the first implementation plan

- Licensing or fetching NKJV / Andrews Study Bible / Clear Word
- AI-authored game stems that replace the deterministic providers
- Student-facing chat or “ask the Bible” search
- Auto-publishing lessons without a coach
- Running generation on Firebase Spark

## First implementation slice

Keep the catalog and OpenAI short-answer work. Add coach-visible lesson drafts generated from the same scoped units, with quote checks, and make the season Setup tab show the pack’s translation and license so the version lock is obvious.

## Alternatives considered

- **Ask the model for the full Adventist/PBE text.** Rejected: copyright and hallucination.
- **AI builds every game card.** Rejected for the first slice: the engine already builds fair, repeatable cards from stored verses.
- **Wait for an NKJV license before any version picker.** Rejected: public-domain packs let seasons run now; NKJV can replace the pack later without changing the engine.
