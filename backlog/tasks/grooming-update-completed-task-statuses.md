### Groom Completed Tasks: Check Acceptance Criteria Boxes and Correct Statuses
- **Project:** golf-clip
- **Status:** done
- **Priority:** high
- **Type:** grooming
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Two backlog tasks have mismatched statuses. `ux-add-error-boundary-component.md` has status "done" but all 5 AC boxes are unchecked (the feature was committed in `efceb59`). `ux-surface-ffmpeg-webcodecs-init-errors.md` has status "not started" but the work was committed in `e5158b0` on the `feat/structured-logging` branch. Both need their AC verified against the actual implementation and statuses corrected. This keeps the backlog accurate for handler dispatch.
- **Added:** 2026-02-22
- **Updated:** 2026-02-22

#### Acceptance Criteria
- [ ] `ux-add-error-boundary-component.md` AC boxes are checked where implementation matches, status confirmed as "done"
- [ ] `ux-surface-ffmpeg-webcodecs-init-errors.md` AC boxes are checked where implementation matches, status updated to "done"
- [ ] No backlog task has a status that contradicts its actual implementation state

#### Next steps
1. Read `apps/browser/src/components/ErrorBoundary.tsx` and `src/main.tsx` — verify each AC item against the implementation, check the boxes that pass
2. Read the commit `e5158b0` diff — verify each AC item in `ux-surface-ffmpeg-webcodecs-init-errors.md` against the implementation, check the boxes that pass
3. Update both task files with checked AC boxes and correct statuses
