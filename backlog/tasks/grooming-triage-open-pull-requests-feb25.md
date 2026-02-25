### Triage 5 Open Pull Requests: Review Status, Resolve Conflicts, Recommend Merge Order
- **Project:** golf-clip
- **Status:** done
- **Priority:** high
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Actual completion:** 2026-02-25
- **Blockers:** none
- **Notes:** 6 PRs triaged (not 5 — #28 was new). Key finding: PRs #24→#25→#26→#27 form a linear stacked chain; #28 is the same branch targeting master directly. Recommended merging #28 to collapse the stack, then rebasing #23. Full report in dispatch: `docs/handler-dispatches/2026-02-25-golf-clip-triage-open-prs.md`
- **Added:** 2026-02-24
- **Updated:** 2026-02-25

#### Acceptance Criteria
- [x] Each open PR has a one-line status summary (mergeable / has conflicts / needs rebase / needs review)
- [x] Merge order recommendation documented based on dependency analysis (e.g., CI before coverage thresholds)
- [x] Any PRs with merge conflicts are rebased or marked with specific conflict files
- [x] User presented with actionable merge checklist
