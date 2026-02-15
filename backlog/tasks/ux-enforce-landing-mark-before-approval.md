### Enforce Landing Mark Before Shot Approval
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** User testing (UT v1 and v2) found that users can click "Next" to approve a shot without ever marking the landing point. This bypasses Step 1 of the review flow entirely. The "Next" button should be disabled until the user has completed the landing mark step (or explicitly chosen to skip tracer generation).
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] "Next" button is disabled (grayed out, non-clickable) when the user has not yet marked a landing point
- [ ] "Next" button becomes enabled after landing is marked and tracer is reviewed (or after user explicitly accepts/skips tracer)
- [ ] Enter keyboard shortcut is also disabled until landing is marked
- [ ] "No Golf Shot" button remains always available (skipping is still allowed)
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. In `ClipReview.tsx`, add a guard on the "Next" button's `disabled` prop tied to `reviewStep` state — disable when step is "mark_landing"
2. Add the same guard to the Enter key handler
3. Add a test that verifies "Next" is disabled before landing is marked
