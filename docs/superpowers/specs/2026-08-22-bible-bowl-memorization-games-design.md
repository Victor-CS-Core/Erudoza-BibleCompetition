# Bible bowl memorization games on stored Scripture

Date: 2026-08-22
Status: Draft for review
Product: Erudoza

## Goal

Help a student memorize the season’s assigned verses for Bible bowl / Pathfinder-style play. A coach locks one Bible version. The app deals games from that stored text. There are no lessons, study guides, or AI-written teaching notes.

## Locked decisions

1. The season’s content pack **is** the selected version. Changing translation means a new pack and a new scope, not an in-place rewrite.
2. The product is **games only**. Do not add lesson drafts, devotionals, or generated prose about the passage.
3. Core games stay deterministic and are built from `SourceUnit.CanonicalText`: Missing Words (exact wording), Verse Builder (word order), Reference Match (citation), What Comes Next (sequence), and True/False (wording, capped in simulation). OpenAI does not create those cards.
4. OpenAI may draft **short-answer recall** cards only (who / what / where facts that are in the verse). Evidence text must equal a stored verse. Coach approval is required. The first Practice card stays Missing Words.
5. Simulation uses `PBE_STYLE_V1`: no multiple-choice, True/False at most 10% of the session.
6. Students never call OpenAI. Spark Hosting still cannot run the API.
7. Ship public-domain English packs now (WEB, KJV, ASV, and the other catalog entries). Do not scrape or bundle NIV, ESV, NLT, or NKJV. An Adventist/PBE lock to NKJV is a later licensed import, not a model prompt.
8. “Adventist Bible” here means the coach picks the translation the season will memorize. It does not mean the model writes NKJV or Clear Word from memory.

## Why this shape

Bible bowl scores exact wording and references. Deterministic games from stored verses are repeatable, cheap, and fair. Importing the version once saves tokens: games spend none, and short-answer generation sends only the assigned range.

## Architecture

```
Coach picks translation
        ↓
Catalog or licensed import → ContentPack + SourceUnits
        ↓
Season scope points at that pack
        ↓
StudyEngine deals memorization games from CanonicalText
        ↓
Optional: OpenAI drafts short-answer recall from those units
        ↓
Validator checks evidence → coach approve/reject
        ↓
Approved short-answer may appear after Missing Words
```

Units:

- **Scripture catalog / import** — already on `cursor/openai-bible-7a00`. A public-domain chapter range becomes a versioned pack (`web-dan-1-1`).
- **Season version lock** — Setup already selects a pack. Show translation name and license on that tab so the bowl version is obvious.
- **Deterministic Study Engine** — existing providers only. No lesson entity. No OpenAI activity that replaces Missing Words or Verse Builder.
- **Short-answer generation** — existing `OpenAiGenerativeQuestionService` + `QuestionReviewService`. Prompt stays “copy evidence exactly.” Treat the result as another memorization game, not as a lesson.
- **Validator** — reject missing evidence, out-of-scope units, or evidence text that does not equal the stored verse.

## Data flow

1. Coach imports the season book/chapters in the chosen public-domain version and selects that pack.
2. Students start Practice, Review, or Simulation. Cards are built from stored verses immediately. No generation step is required to play.
3. If the coach wants extra short-answer recall, they click Generate. The job loads resolved scope units only and stores Validated or Rejected candidates.
4. After approve, those cards may appear after the first Missing Words card.

## Error handling

- No API key: all deterministic games and imported packs still work; generation uses the local fallback and the UI says so.
- OpenAI HTTP or parse failure: fall back per candidate; the job still completes.
- Copyrighted translation requested: API returns a domain error. Do not fetch NIV/ESV/NKJV from a generic Bible site.

## Testing

- Catalog import still stores `licensingStatus = public-domain` and rejects non-PD licenses.
- Generation with a key produces `openai-chat-v1` candidates whose evidence equals stored text.
- No lesson routes, tables, or UI.
- Playwright: first card remains Missing Words; simulation still forbids multiple-choice.

## Out of scope

- Lessons, study guides, and AI teaching notes
- Licensing or fetching NKJV / Andrews Study Bible / Clear Word
- Replacing deterministic game providers with model-written stems
- Student-facing chat
- Running generation on Firebase Spark

## First implementation slice

Keep the catalog and OpenAI short-answer work. On season Setup, show the selected pack’s translation and license. Do not add a lesson feature.

## Alternatives considered

- **AI writes lessons plus games.** Rejected: the coach asked for memorization games only.
- **Ask the model for the full Adventist/PBE text.** Rejected: copyright and hallucination.
- **AI builds every game card.** Rejected for this slice: the engine already builds fair, repeatable Bible-bowl cards from stored verses.
- **Wait for an NKJV license before any version picker.** Rejected: public-domain packs let a season run now; NKJV can replace the pack later without changing the games.
