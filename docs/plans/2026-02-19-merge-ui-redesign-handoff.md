# Handoff: Merge UI Redesign to Master

## Mission
Merge all UI redesign + feedback fix work from `feat/ui-feedback-fixes` into `master` via a clean PR, without regressing the tracer renderer and audio timing fixes from PR #21.

## Context
The golf-clip browser app (`apps/browser/`) had a major UI redesign done across 20+ commits on `feat/ui-feedback-fixes`. This work needs to land on master. Separately, PR #21 ("unify tracer rendering") fixed critical export bugs — tracer timing and audio timing — and was merged to master. These two bodies of work touch overlapping files (especially `ClipReview.tsx`, `TrajectoryEditor.tsx`, `video-frame-pipeline-v4.ts`) and must be reconciled.

## What We Learned

### The branch tangle
- `feat/ui-feedback-fixes` and `feat/video-zoom-pan-controls` point to the same commit — they're aliases.
- `feat/ui-feedback-fixes-v2` was a separate branch off master (after PR #21) where the user accidentally made some edits. Those edits were stashed (stash@{0}) as reference but should NOT be applied — the 4 layout tweaks have already been re-implemented fresh on the correct branch.

### The stale master problem (critical discovery)
- Local `master` was at `14942a2` (stale). Remote `origin/master` was at `5050836` (includes PR #21 merge).
- The first rebase used stale local master — it went cleanly (no conflicts!) but silently dropped PR #21's work because:
  - `tracer-renderer.ts` and `tracer-renderer.test.ts` (new files from PR #21) were never in the feature branch, so they just didn't exist after rebase
  - Files like `video-frame-pipeline-v4.ts` and `TrajectoryEditor.tsx` were modified by both PR #21 and the feature branch — the rebase replayed the feature branch's older versions
- **This was caught when the user tested export on Mac and found tracer timing + audio timing regressions**
- Local master has been updated to `5050836` (matching origin/master)

### The rebase conflict
- Second rebase attempt (onto correct master) immediately hit a conflict in `ClipReview.tsx` at the very first commit (`efa73aa feat: add keyboard-driven zoom`). This was aborted — no partial rebase state remains.
- The conflict is between PR #21's changes to ClipReview.tsx (tracer renderer integration) and the feature branch's zoom/pan additions to the same file.

### PR #21 tracer renderer fixes — what they changed
Read the full plan at `docs/plans/2026-02-18-unify-tracer-rendering.md` and loop doc at `docs/loops/2026-02-18-unify-tracer-rendering-archived.loop.md` for detailed context. Summary:

**New files (must exist after merge):**
- `apps/browser/src/lib/tracer-renderer.ts` — shared tracer line drawing (physics easing, path-length interpolation, 3-layer bezier glow)
- `apps/browser/src/lib/tracer-renderer.test.ts` — 15 unit tests

**Modified files (must preserve PR #21 changes):**
- `apps/browser/src/lib/video-frame-pipeline-v4.ts` — fixed time offset bug (`relativeTime + startTime` not `relativeTime + trajectory[0].timestamp`), replaced inline `drawTracer` with shared `drawTracerLine` import
- `apps/browser/src/components/TrajectoryEditor.tsx` — removed ~156 lines of inline rendering, replaced with `drawTracerLine()` call
- `apps/browser/src/lib/ffmpeg-client.ts` — audio timing alignment fix
- `apps/browser/src/components/ClipReview.tsx` — wired up shared renderer

### The 4 layout tweaks (already committed on feature branch)
These are in commit `f9d3fbc` on `feat/ui-feedback-fixes`:
1. Generate button moved under Shot Shape in column 1
2. Approve/reject buttons moved below the scrubber
3. Instruction banner moved above trajectory settings
4. Style options hidden, status text changed to "Tracer generated. Click play to see animation"

### What the user visually verified and approved
- Walkthrough steps centered on upload screen
- Progress bar visible during processing
- Instruction banner above trajectory settings
- 3-column trajectory panel with Generate under Shot Shape
- Approve/reject buttons below scrubber
- "Tracer generated. Click play to see animation" auto-dismisses after 3s

## Current State

- **Done:**
  - All 4 layout tweaks re-implemented and committed on `feat/ui-feedback-fixes` (commit `f9d3fbc`)
  - Local master updated to match origin/master (`5050836`, includes PR #21)
  - Stash created with wrong-branch reference edits (stash@{0}, do not apply)
  - Visual verification of all 5 UI fixes via Playwright (all passed)
  - tsc clean and 383 tests passing (pre-rebase)

- **In Progress:**
  - Rebase of `feat/ui-feedback-fixes` onto master — second attempt aborted after ClipReview.tsx conflict

- **Not Started:**
  - Resolving rebase conflicts (especially ClipReview.tsx reconciling zoom/pan + tracer renderer)
  - Post-rebase verification (tsc, tests, visual, AND export test for tracer/audio timing)
  - Push, PR creation, merge
  - Cleanup: drop stash, remove `/home/eli/projects/golf-clip-tracer-fix` worktree, delete stale branches

- **Blocked:** Nothing blocked, just needs careful conflict resolution

## Codebase Context

### Git state (exact)
```
Branch: feat/ui-feedback-fixes
HEAD: f9d3fbc (20 commits ahead of old master, needs rebase onto 5050836)
Local master: 5050836 (up to date with origin/master, includes PR #21)
Stash@{0}: "layout-tweaks-reference-do-not-apply" — DO NOT apply, reference only
Worktree: /home/eli/projects/golf-clip-tracer-fix on fix/unify-tracer-rendering (stale, safe to remove)
```

### Key files
- `apps/browser/src/components/ClipReview.tsx` — main review UI, will conflict during rebase (zoom/pan vs tracer renderer)
- `apps/browser/src/components/TracerConfigPanel.tsx` — trajectory config, layout tweaks done
- `apps/browser/src/components/TrajectoryEditor.tsx` — must use `drawTracerLine` from shared renderer after merge
- `apps/browser/src/lib/tracer-renderer.ts` — shared renderer from PR #21, must exist after merge
- `apps/browser/src/lib/video-frame-pipeline-v4.ts` — export pipeline, must have correct time offset
- `apps/browser/src/lib/ffmpeg-client.ts` — audio timing fix from PR #21
- `apps/browser/src/styles/global.css` — layout CSS

### Key documentation
- `docs/plans/2026-02-19-merge-ui-redesign.md` — the merge plan (partially executed, needs updating for rebase redo)
- `docs/plans/2026-02-18-unify-tracer-rendering.md` — PR #21 implementation details
- `docs/loops/2026-02-19-ui-feedback-fixes.loop.md` — UI feedback fixes loop doc

## Recommended Next Action

Re-attempt `git rebase master` on `feat/ui-feedback-fixes`. For each conflict:
1. Read BOTH versions carefully — understand what PR #21 added (tracer renderer imports, shared `drawTracerLine` calls) AND what the feature branch added (zoom/pan, layout changes)
2. Merge both sets of changes — do NOT just pick one side
3. After each resolution, verify the file still imports and uses `drawTracerLine` from `tracer-renderer.ts`

After rebase completes:
- Verify `tracer-renderer.ts` and `tracer-renderer.test.ts` exist on disk
- Run `tsc --noEmit` and `npm run test -- --run`
- Test export on Mac via SSH tunnel (`ssh -L 5173:localhost:5173`) to verify tracer timing and audio timing are correct

## Open Questions
- The rebase may have many conflicts across the 20 commits since PR #21 touches files the feature branch also modified extensively. If conflicts are too numerous, an alternative approach would be: merge master into the feature branch instead of rebasing (preserves both histories, avoids replaying 20 commits one by one). Trade-off: messier history but much simpler conflict resolution (one merge commit instead of potentially 20 conflict resolutions).
- Squash vs merge for the final PR was decided as merge (preserve history), but given the complexity this could be revisited.
