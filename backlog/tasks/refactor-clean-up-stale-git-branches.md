### Delete Merged and Stale Git Branches (Local and Remote)
- **Project:** golf-clip
- **Status:** not started
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The repo has accumulated 5+ branches from completed work: `feat/ui-feedback-fixes`, `feat/ui-feedback-fixes-v2`, `feat/video-zoom-pan-controls`, `backup/feat-ui-pre-merge`, `backup/master-pre-merge`, and potentially `fix/unify-tracer-rendering`. These were created during UI redesign (PR #22) and earlier feature work. They add noise to branch listings and should be cleaned up after confirming each is fully merged or no longer needed.
- **Added:** 2026-02-22
- **Updated:** 2026-02-22

#### Acceptance Criteria
- [ ] All branches that are fully merged into master are deleted locally and on origin
- [ ] Backup branches (`backup/*`) are deleted after confirming master contains their changes
- [ ] `git branch -a` shows only master, current feature branch, and any actively-in-progress branches
- [ ] No unmerged work is lost (verify with `git log` before deleting each branch)

#### Next steps
1. Run `git branch -a --merged master` to list all branches fully merged into master
2. For each merged branch (excluding master and current branch), delete local with `git branch -d` and remote with `git push origin --delete`
3. For backup branches, run `git log master..backup/branch-name` to confirm no unique commits exist before deleting
4. Run `git remote prune origin` to clean up stale remote tracking references
