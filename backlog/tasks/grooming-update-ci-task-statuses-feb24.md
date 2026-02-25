### Update 3 Stale CI Backlog Items to Done Status
- **Project:** golf-clip
- **Status:** done
- **Priority:** medium
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-24
- **Blockers:** none
- **Notes:** Three backlog items were completed by recent commits on `feat/github-actions-ci` but still show "not started": `refactor-add-eslint-typescript-react-config.md` (done in commits eda53b2, bdfb182), `test-configure-vitest-code-coverage-thresholds.md` (done in commits e5e8389, 0f2b256), and `test-add-playwright-e2e-to-ci-workflow.md` (done in commit 58ca7c9). Stale statuses inflate the actionable item count and cause handler to skip restocking.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [x] `refactor-add-eslint-typescript-react-config.md` status changed to `done` with updated date
- [x] `test-configure-vitest-code-coverage-thresholds.md` status changed to `done` with updated date
- [x] `test-add-playwright-e2e-to-ci-workflow.md` status changed to `done` with updated date
- [x] Remaining actionable backlog items count is accurate (should be 4 after this grooming)

#### Next steps
1. Open each of the 3 task files and change `Status: not started` to `Status: done`
2. Update the `Updated:` date to today's date in each file
3. Verify no other backlog items have drifted (compare git log to remaining "not started" items)
