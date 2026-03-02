### Close or merge stale branches without open PRs
- **Project:** golf-clip
- **Status:** done
- **Priority:** low
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Two local branches have unmerged commits but no open PRs: (1) refactor/decompose-clip-review — last commit da21823 "sync completed task statuses" plus 4 commits of UI refactoring work that hasn't been PRed; (2) feat/video-zoom-pan-controls — 4 unmerged commits including UI refinements. Additionally feat/react-lazy-code-split is the current session branch. Stale branches accumulate merge conflict risk and create confusion about what work is in flight. Each should be assessed: if changes are valuable, open a PR; if superseded, delete the branch.
- **Added:** 2026-03-01
- **Actual completion:** 2026-03-02
- **Updated:** 2026-03-02

#### Acceptance Criteria
- [x] refactor/decompose-clip-review assessed: deleted — only 1 backlog-sync commit (da21823), no code changes
- [x] feat/video-zoom-pan-controls assessed: deleted — all 22 commits already merged to master via PR #22
- [x] All remaining local branches have either an open PR or a rationale for their existence (fix/e2e-fixture-imports and public-release also deleted — 0 commits beyond master)
