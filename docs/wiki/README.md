# Authenticated wiki authoring guide

The product wiki is a version-controlled, authenticated help center at `/wiki`. It is intentionally stored in TypeScript so feature explanations, route links, and search terms change in the same review as the UI they describe.

## Where content lives

- Articles: `apps/web/src/features/wiki/wikiContent.ts`
- Page and search behavior: `apps/web/src/features/wiki/WikiPage.tsx`
- Wiki layout and responsive rules: `apps/web/src/features/wiki/wiki.css`
- Focused coverage and behavior tests: `apps/web/src/features/wiki/*.test.ts*`
- Sanitized visual assets: `apps/web/public/wiki/`

## Article checklist

Every article should answer the questions a student or coach has when they are looking at the product:

1. What is this feature for, and which audience is it for (`Shared`, `Student`, or `Coach`)?
2. What must be true before using it (signed-in role, selected season, assignment, invitation, or enabled setting)?
3. What are the exact steps, control labels, statuses, and success states?
4. What is saved or changed, and what remains historical or read-only?
5. Which permissions apply, including what the other role cannot do?
6. What errors, retries, empty states, and edge cases should the user expect?
7. Which live route can the reader open, and which related articles should they read next?
8. Which words might a user search for, including visible button labels, route names, abbreviations, and glossary terms?

Use the existing article structure as the schema. Keep explanations in `sections`, procedural actions in `steps`, common questions in `faqs`, and every discoverable term in `keywords`. Add each navigation destination and major route family to `featureIds` so the focused coverage test can catch undocumented features.

## Screenshots

Screenshots are optional, but recommended for workflows where a visual state is easier to understand than prose. Capture from seeded local/demo data only. Before committing an image:

- Remove or avoid real names, email addresses, passwords, tokens, private notes, and production data.
- Keep the image focused on the workflow state, not on decorative browser chrome.
- Add descriptive `alt` text and a caption in the article's `screenshot` metadata.
- Check the image at desktop width and at 390px and 320px. The wiki hides decorative screenshots in forced-colors and print modes.
- Replace a screenshot when labels, layout, or the represented state changes.

## Required checks

Run the focused gate while authoring:

```text
npm --workspace apps/web run test:wiki
```

Before a user-facing change is merged, also run the normal web typecheck, lint, production build, and browser QA. The wiki review is part of release acceptance even when the feature change itself has no new article; record a short reason in `PROGRESS.md` when documentation is unchanged.

## Review expectations

Treat wiki copy as product behavior documentation, not marketing copy. Do not promise capabilities that are not enforced by the current route and server. Preserve important distinctions such as assigned Scripture scope versus general reading, individual mastery Honors versus historical practice milestones, and PBE rubric scoring versus Arcade speed scoring.
