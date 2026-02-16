### Delete 6 merged git branches (local and remote)

- **Project:** golf-clip
- **Status:** done
- **Priority:** low
- **Type:** refactor
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** 6 branches remain locally and on origin after their PRs were merged to master. They add noise to `git branch` output and slow down tab-completion. All are confirmed merged: chore/remove-ishevccodec (#18), chore/remove-legacy-pipelines, feat/adjust-impact-time (#15), feat/audio-export (#17), fix/scrubber-global-time-handling (#16), test/trajectory-generator (#20). Also clean up remotes/origin/fix/clip-review-tests which was merged as PR #14.
- **Added:** 2026-02-15
- **Updated:** 2026-02-15

#### Acceptance Criteria

- [ ] All 6 local branches deleted (`git branch -d <name>` succeeds for each)
- [ ] All 7 remote tracking branches deleted (`git push origin --delete <name>` succeeds, including fix/clip-review-tests)
- [ ] `git branch -a` shows only `master` locally and `remotes/origin/master` + `remotes/origin/HEAD` remotely
- [ ] No errors — if any branch fails to delete (not fully merged), investigate before force-deleting

#### Next steps

1. Run `git branch -d chore/remove-ishevccodec chore/remove-legacy-pipelines feat/adjust-impact-time feat/audio-export fix/scrubber-global-time-handling test/trajectory-generator` to delete local branches
2. Run `git push origin --delete` for each remote branch (7 total including fix/clip-review-tests)
3. Run `git fetch --prune` to clean up stale remote refs
4. Verify with `git branch -a`
