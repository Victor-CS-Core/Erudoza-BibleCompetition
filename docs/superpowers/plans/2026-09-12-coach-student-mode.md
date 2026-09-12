# Coach Student Mode — approved implementation plan

Approved in conversation September 12. One active Adult Owner/Admin account can switch between Coach and Student workspaces, self-assign within its organization's existing season scope, perform the same learner activities, earn evidence-backed Honors, and use earned avatars in both workspaces. Personal assignments and progress stay out of student rosters, coverage, counts, readiness and season setup status. Team Practice supports real coach players under the same match rules and shared scores; players cannot judge their match by switching workspace.

## Contracts and tasks

1. Cloudflare native backend: learner authorization and atomic guards; personal assignment lifecycle; student reporting isolation; Team Practice eligible players and invitation guards; native regression tests.
2. .NET backend: matching endpoint contracts, learner policies/services, reporting isolation and Team Practice behavior; integration tests.
3. Frontend: route-based workspace switch, preserved season and identity, My assignments with existing controls, empty-state action, learner Team Practice presentation; UI tests.
4. Integration: shared browser scenario on both runtimes, responsive checks, regression suites/typechecks/lint/builds, independent review, scoped commit/push and evidence checkpoint.

Personal assignment endpoints: GET/POST `/api/v1/organizations/{orgId}/seasons/{seasonId}/my-assignments`; DELETE the same path plus `/{assignmentId}`. Read responses reuse Assignment DTOs; POST reuses assignment input without studentUserId and derives the actor server-side. Existing `/assignments` continues to expose student assignments for coaches. Reuse existing persistence without renaming schema fields. Closed-season editability and active-season study rules remain.

Default difficulty Standard, coach sign-in Coach mode. Existing account roles remain authorization truth; URL determines workspace presentation. New self-assignment UI selects only existing seasons/passages and does not create seasons. Evidence and avatar identity persist through mode and assignment changes. Production deployment is outside this implementation checkpoint.

## Acceptance

Test positive and negative authorization, self-only ownership, organization isolation, season lifecycle and scope change behavior, reporting isolation, real study results/Honor eligibility, mode context and locked-avatar rejection. Verify Team Practice player/judge separation and coach invitations. Check 1440/390/320px layouts with keyboard access. Run both backend suites, frontend tests, types, lint and builds. Record actual outcomes and limits in PROGRESS.md; commit/push scoped task branch, without merging/deploying.
