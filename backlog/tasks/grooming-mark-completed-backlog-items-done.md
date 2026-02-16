### Mark completed backlog items as done and remove test artifact

- **Project:** golf-clip
- **Status:** done
- **Priority:** low
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** 5 backlog items have inconsistent statuses after being completed by workers. Three say "done" but two others use "closed" and "fixed" instead of the standard "done" status. One item (`test-cleanup-test-task-from-golf-clip.md`) is a draft test artifact from dev-org skills testing that should be deleted. Consistent statuses help the handler pipeline scan correctly.
- **Added:** 2026-02-15
- **Updated:** 2026-02-15

#### Acceptance Criteria

- [ ] `bug-export-choppy-low-fps.md` status field reads "done" (was "closed")
- [ ] `bug-transport-buttons-not-clickable.md` status field reads "done" (was "fixed")
- [ ] `test-cleanup-test-task-from-golf-clip.md` is deleted from backlog/tasks/
- [ ] All remaining backlog items have status of either "done", "not started", or "in progress" — no ad-hoc statuses
- [ ] `git diff` shows only status field changes and file deletion, no other modifications

#### Next steps

1. Edit `bug-export-choppy-low-fps.md`: change Status from "closed" to "done"
2. Edit `bug-transport-buttons-not-clickable.md`: change Status from "fixed" to "done"
3. Delete `test-cleanup-test-task-from-golf-clip.md`
4. Verify all remaining items have standard statuses
