# Chibi share editor implementation plan

**Goal:** Extend the approved local character review with a themed, accessible patch editor and matching PNG export.

**Architecture:** Keep the existing character configuration and independent avatar/sash state. Store share decorations in App, render the 1200 × 1600 card through one canvas composition path, and expose patches through accessible overlay controls. The collection input follows the profile's `earnedAtUtc` eligibility convention; this review supplies labeled sample unlocks without calling account APIs.

**Scope:** User's September 13 request for drag-and-drop unlocked patches and Chibi-themed Share tools. No production account integration or deployment is authorized by this preview iteration.

## Implementation and acceptance

- [x] Add `verify-share.mjs` before implementation. It must initially fail on the absent patch tray, then exercise real drag/drop, tap addition, patch movement, keyboard placement, bounds, editing, undo/redo, persisted navigation, preserved sash/avatar state and exact preview/export pixel agreement.
- [x] Add `share.ts`: collection filtering, unique placements per unlocked patch, rotated bounds clamping, bounded history, common base-card and patch painting. Reject unavailable keys even when supplied through drag data.
- [x] Add `ShareEditor.tsx`: postcard canvas, three available sample patches, pointer movement, keyboard arrows with Shift for coarse movement, size/rotation, front/back, remove, clear and undo/redo. Touch users can tap to add and drag to move. Escape/pointer cancellation restores the original placement.
- [x] Integrate the editor in `review.tsx`, preserving state across pages and appearance/attire changes. Keep the existing download action name and PNG dimensions. Style with shared primitives/tokens and existing patch/scene art; no character outlines.
- [x] User follow-up: replace the unstable single-pixel skin reference, bound highlights and check 36 hairstyle/skin combinations, especially the light low-bun face. Verify all sash registrations descend upper-left to lower-right in screen coordinates; preserve current correct direction without mirroring patches or characters.
- [x] Build and type-check; run the Share checks, existing full review checks and background regressions. Inspect desktop, 390px and 320px, both body types/attires and a decorated night export. Save intentional Share review captures, document limitations and update PROGRESS.md.
- [x] Review scoped diff, explicitly stage, commit and normally push the current task branch; read back the remote checkpoint. Leave the local preview ready for user review.

The user has authorized implementation of this preview. Work runs inline on the existing `codex/profile-character-assets` branch; no additional approval ceremony or new task is needed.
