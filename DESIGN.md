# Erudoza design system

The approved Field Guide Academy mockup and supplied assets are the visual authority. Refine both coach and student workspaces with the quiet precision of an Apple product, using the approved Option C command navigation and preserving the working coach setup flow. This is a product UI: tasks and readability come first.

## Shared rules

- One source of values: `apps/web/src/styles/tokens.css`. One source of controls and type: `styles/design-system.css` and `components/ui/index.tsx`.
- Warm ivory page, near-white surfaces, deep navy text and header, teal primary actions, selections and progress, restrained coral for attention. Mountain artwork belongs in the learner banner and small brand moments, not behind tables or forms.
- System sans for all interface headings, labels, values, and controls. Georgia for Scripture and the Erudoza wordmark. Fixed rem type scale with readable body and captions; tabular numbers for data.
- 4px spacing base. 24px panel padding, 24px section gaps, 12px control radius, 16px panels, 44px default controls. Compact desktop row actions are 32px; coarse-pointer touch controls remain at least 44px. One light border defines a panel; no decorative stacked frames.
- Shared Button, LinkButton, Input, Select, Textarea, Panel, PageHeader, Badge, Notice. Page CSS handles composition only; no local replacement button/type/color systems.
- Full default/hover/focus/pressed/disabled states; semantic error/success messages; short transitions respecting reduced motion. No glass effects as decoration.
- Both coach and student use Option C: compact navy brand/search/account bar, account-specific pinnable shortcuts, nested command navigation, and contextual breadcrumb menus. Persistent section links keep frequent workflows one click away. Coach/student permissions and selected student season remain intact. Responsive tables or lists remain readable; no page overflow.
- Mobile comes first. Start with one column at 320px, keep primary actions visible and touch targets usable, then add columns for larger screens. Dense data may scroll inside a labeled, keyboard-accessible region; the page itself must not scroll sideways. Keep the current section visible in the shortcut strip.
- Scripture inputs use available data: book and chapter choices come from the selected translation, and season/assignment verse choices come from stored pack coordinates within the allowed scope. Reset dependent choices when their parent changes. Server validation remains authoritative; never invent chapter or verse counts.
- Existing badges are milestone imagery, not UI controls or fabricated earned awards. Metrics and feedback reflect stored evidence.

Reference page: `/admin/design-system`. It renders the actual shared components. Review both workspaces at 1440px and 390px (plus 320px stress check), with real data, empty states, forms and practice feedback.

Implementation is a refinement using Impeccable's extract/operate/craft-floor guidance and bm-design-system, adapted to the user's existing brand and component needs. Additional editors, theme modes and native dependencies are outside this visual consistency pass.

Confirmation actions use `components/ui/ConfirmationDialog.tsx`: fixed footer, Cancel first, initial focus on Cancel, Escape and focus restoration, pending lock and errors inside the dialog. Use for deletion, password replacement and season activation; routine saves and navigation remain direct.

## Approved Option C — command center

The user approved prototype C on 10 September 2026 for the entire app. Its authority is the compact navy header with prominent search, pin controls, breadcrumb section switching, calm ivory surfaces, teal primary actions, dense readable tables, and clear section tabs. The prototype's students, percentages, dates, groups and illustrative artwork are not product data or permission to fabricate metrics.

Search is deterministic navigation, not AI. Ctrl/Cmd+K and All sections open the command center. Search existing sections, coach-accessible students, and accessible seasons. Pins are local preferences scoped to organization, user and role. Hierarchy expansion survives opening/closing within the visit. Closing an overlay restores focus; arrows and Enter support quick navigation. Anchor destinations must point to actual page sections and focus them once asynchronous content loads.
