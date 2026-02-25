### Triage 5 Open Pull Requests: Review Status, Resolve Conflicts, Recommend Merge Order
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** needs user input — merge decisions require owner approval
- **Notes:** 5 PRs are open (#23–#27), oldest from 2026-02-22. Handler state indicates several golf-clip PRs have passed QE/code review but await user merge. As branches age, merge conflicts accumulate and CI checks go stale. A triage pass would document each PR's merge readiness, identify conflicts, and recommend a merge order to unblock the pipeline. PRs: #23 structured logging, #24 GitHub Actions CI, #25 Prettier formatting, #26 coverage thresholds 60%, #27 pre-commit hooks.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] Each open PR has a one-line status summary (mergeable / has conflicts / needs rebase / needs review)
- [ ] Merge order recommendation documented based on dependency analysis (e.g., CI before coverage thresholds)
- [ ] Any PRs with merge conflicts are rebased or marked with specific conflict files
- [ ] User presented with actionable merge checklist

#### Next steps
1. Run `gh pr list --state open --json number,title,mergeable,mergeStateStatus` to get current merge status
2. For each PR, run `gh pr checks <number>` to verify CI status
3. Check for inter-PR dependencies (e.g., pre-commit hooks depend on Prettier being merged first)
4. Document findings and present merge order recommendation to user
