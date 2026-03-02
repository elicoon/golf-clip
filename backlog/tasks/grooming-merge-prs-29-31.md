### Merge Open PRs #29–#31 (post-chain)
- **Project:** golf-clip
- **Status:** not started
- **Priority:** high
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Three PRs opened after the original PR chain grooming task (which covered #24–#28) are still unmerged: #29 (axe-core accessibility E2E spec, test/axe-core-accessibility-spec), #30 (HEVC codec detection edge cases + UAT checklist, test/hevc-codec-edge-cases), #31 (surface FFmpeg init errors on upload screen, fix/surface-init-errors). These are independent of each other and of the earlier chain. With every open PR adding merge conflict risk, these should be merged promptly. The existing grooming task (grooming-merge-open-pr-chain-feb26.md) does not cover these newer PRs.
- **Added:** 2026-03-01
- **Updated:** 2026-03-01

#### Acceptance Criteria
- [ ] PR #29 merged to master (or closed with rationale if superseded)
- [ ] PR #30 merged to master (or closed with rationale if superseded)
- [ ] PR #31 merged to master (or closed with rationale if superseded)
- [ ] CI (unit + E2E) passes on master after all merges

#### Next steps
1. Run `gh pr checks 29 && gh pr checks 30 && gh pr checks 31` to confirm each is green
2. Merge in order: #31 (bug fix, lowest risk) → #29 → #30; rebase any with conflicts before merging
3. Verify master CI passes after final merge
