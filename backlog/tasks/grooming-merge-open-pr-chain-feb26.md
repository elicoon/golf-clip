### Merge Open PR Chain and Resolve Branch Drift (#23–#28)
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Six PRs have been open since Feb 22–25 with passing tests but no merge activity. The chain is stacked: #24 (CI workflow) → #25 (Prettier) → #26 (raise coverage 60%) → #27 (pre-commit hooks) → #28 (WCAG + a11y). Additionally, older PRs #23 (structured logging) and older feature PRs #15–#20 are still open. With this many open PRs, any new feature branches will face increasing merge conflicts over time. Worker should: check each PR for merge conflicts with master, rebase/update as needed, run tests to confirm green, then merge in dependency order (#24 first, then sequentially up to #28). PR #23 (#feat/structured-logging) can merge independently.
- **Added:** 2026-02-26
- **Updated:** 2026-02-26

#### Acceptance Criteria
- [ ] All 6 PRs (#23–#28) merged to master or confirmed closed with rationale
- [ ] No merge conflicts remain on master after sequential merge
- [ ] CI (unit tests + E2E) passes on master after each merge step
- [ ] Older PRs #15–#20 each assessed: confirm still relevant or close as superseded

#### Next steps
1. Run `gh pr list` and check merge status of each PR in chain order (#23, #24, #25, #26, #27, #28)
2. For each PR, run `gh pr checks <N>` to confirm tests are green, then merge in order
3. For #15–#20, check if the changes are already on master (likely superseded by later work) and close with note
