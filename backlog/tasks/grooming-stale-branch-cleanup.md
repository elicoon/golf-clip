### Close or merge stale branches without open PRs
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Two local branches have unmerged commits but no open PRs: (1) refactor/decompose-clip-review — last commit da21823 "sync completed task statuses" plus 4 commits of UI refactoring work that hasn't been PRed; (2) feat/video-zoom-pan-controls — 4 unmerged commits including UI refinements. Additionally feat/react-lazy-code-split is the current session branch. Stale branches accumulate merge conflict risk and create confusion about what work is in flight. Each should be assessed: if changes are valuable, open a PR; if superseded, delete the branch.
- **Added:** 2026-03-01
- **Updated:** 2026-03-01

#### Acceptance Criteria
- [ ] refactor/decompose-clip-review assessed: either PR opened or branch deleted with reason documented
- [ ] feat/video-zoom-pan-controls assessed: either PR opened or branch deleted with reason documented
- [ ] All remaining local branches have either an open PR or a rationale for their existence

#### Next steps
1. Run `git log master..refactor/decompose-clip-review` and `git log master..feat/video-zoom-pan-controls` to see what's unmerged
2. For each branch, check if the changes are already on master (cherry-picked or superseded) or represent new work worth PRing
3. Open PRs for valuable work or delete branches and document why in the commit message
