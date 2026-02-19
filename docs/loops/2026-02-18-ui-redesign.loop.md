# LIVING_PLAN: UI Redesign — 6 Changes

> **AUTONOMOUS EXECUTION:** Do not pause for user acknowledgment. After context compaction, re-read this document from the top, find the `[CURRENT]` step, and continue executing until all acceptance criteria are met or max iterations reached.

<!--
RALPH LOOP TEMPLATE
===================
This document is the single source of truth for sequential agent iterations.
Each agent reads this fresh, executes ONE step, updates this doc, then exits.
Any agent can resume work from this document alone — no context dependencies.

AGENT CONTRACT:
1. Read this entire document before taking action
2. Execute ONLY the step marked [CURRENT]
3. Update Step Outputs, Discoveries, and Next Action before exiting
4. Never skip ahead or batch multiple steps
5. If blocked, document the blocker and propose resolution
-->

## Metadata

| Field | Value |
|-------|-------|
| **Workflow Type** | `feature` |
| **Status** | `in-progress` |
| **Iteration** | `1` |
| **Max Iterations** | `12` |
| **Created** | 2026-02-18 |
| **Last Updated** | 2026-02-18 |
| **Owner** | Eli |
| **Project** | `/home/eli/projects/golf-clip` |
| **Plan** | `docs/plans/2026-02-18-ui-redesign.md` |

---

## Objective

**Goal:** Redesign the GolfClip review UI with 6 changes: remove confirm dialog, remove header, add upload walkthrough illustrations, add strike indicators on scrubber, two-column trajectory settings, and reposition approve/reject buttons.

### Acceptance Criteria

- [ ] "No Golf Shot" button and Escape key reject immediately (no confirmation dialog)
- [ ] No sticky header on any screen
- [ ] "GolfClip" title shows on upload screen only
- [ ] Upload screen has two-column layout: walkthrough illustrations (left) + dropzone (right)
- [ ] Walkthrough illustrations are CSS/SVG (steps 1-2-3)
- [ ] TracerConfigPanel is two columns (shape controls left, point markers right)
- [ ] Approve/Reject buttons positioned between trajectory config and video player
- [ ] Instruction banner shows below buttons, above video
- [ ] Green strike indicator dot appears below scrubber at impact time
- [ ] Orange strike indicator dot shows original detection time when user adjusts impact
- [ ] ReviewActions component and reviewActionsStore removed
- [ ] `tsc --noEmit` passes with no errors
- [ ] All tests pass (`npm run test -- --run`)

### Scope Boundaries

- Not addressing: export pipeline changes
- Not addressing: mobile touch interactions
- Not addressing: test-writing for new UI (visual verification only)

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/browser/src/App.tsx` | View routing — header lives here, upload screen layout |
| `apps/browser/src/components/ClipReview.tsx` | Main review UI — layout order, confirm dialog, button placement |
| `apps/browser/src/components/TracerConfigPanel.tsx` | Trajectory settings — convert to two-column |
| `apps/browser/src/components/Scrubber.tsx` | Timeline — add strike indicators |
| `apps/browser/src/components/ReviewActions.tsx` | Header buttons — to be deleted |
| `apps/browser/src/stores/reviewActionsStore.ts` | Bridge store — to be deleted |
| `apps/browser/src/styles/global.css` | All CSS styles |
| `docs/plans/2026-02-18-ui-redesign.md` | Detailed implementation plan with code |

---

## Steps

### Step 1: Remove skip shot confirmation dialog
**Status:** [DONE]

**Purpose:** Simplify the reject flow — no confirmation step needed

**Inputs:**
- `apps/browser/src/components/ClipReview.tsx`

**Actions:**
- Remove `import { ConfirmDialog } from './ConfirmDialog'`
- Remove `showRejectConfirm` state and all `setShowRejectConfirm` calls
- Remove `handleRejectWithConfirm` wrapper callback
- Change button onClick from `() => setShowRejectConfirm(true)` to `handleReject`
- Change Escape handler to call `handleReject()` directly
- Remove the `<ConfirmDialog>` render block at bottom of component
- Remove `showRejectConfirm` from keyboard effect deps
- Update `setHandlers` call to use `handleReject` instead of `handleRejectWithConfirm`

**Expected Outputs:**
- ClipReview compiles without ConfirmDialog references
- "No Golf Shot" button rejects immediately
- Escape key rejects immediately

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: b181bc3
```

**Verification:** `cd apps/browser && npx tsc --noEmit` — PASS

---

### Step 2: Remove header and distribute content
**Status:** [CURRENT]

**Purpose:** Remove the sticky header, move title to upload screen only

**Inputs:**
- `apps/browser/src/App.tsx`
- `apps/browser/src/styles/global.css`

**Actions:**
- In App.tsx: Remove entire `<header>` element
- Remove `VideoQueue` and `ReviewActions` imports from App.tsx
- Add `<h1 className="app-title">GolfClip</h1>` above the about-box in upload view
- Keep "Process Another Video" on export-complete screen (already there)
- Add `.app-title` CSS rule (centered, 2rem, 700 weight)
- Remove all `.app-header` CSS rules from global.css (lines ~64-137)
- Remove mobile `.app-header` breakpoint rules

**Expected Outputs:**
- No header on any screen
- "GolfClip" title visible on upload screen
- Clean CSS without dead header rules

**Actual Outputs:**
```
[To be filled after execution]
```

**Verification:** `cd apps/browser && npx tsc --noEmit` + visual check dev server

---

### Step 3: Remove ReviewActions component and reviewActionsStore
**Status:** [NEXT]

**Purpose:** Clean up the header bridge pattern — buttons now live inline in ClipReview only

**Inputs:**
- `apps/browser/src/components/ClipReview.tsx`
- `apps/browser/src/components/ReviewActions.tsx` (delete)
- `apps/browser/src/stores/reviewActionsStore.ts` (delete)

**Actions:**
- In ClipReview.tsx: Remove `import { useReviewActionsStore }`
- Remove the `useReviewActionsStore()` hook call and all 3 registration effects (setHandlers, setCanApprove, setProgress)
- Delete `apps/browser/src/components/ReviewActions.tsx`
- Delete `apps/browser/src/stores/reviewActionsStore.ts`

**Expected Outputs:**
- No references to reviewActionsStore anywhere
- ReviewActions.tsx deleted
- reviewActionsStore.ts deleted

**Actual Outputs:**
```
[To be filled after execution]
```

**Verification:** `cd apps/browser && npx tsc --noEmit` + `grep -r "reviewActionsStore\|ReviewActions" apps/browser/src/` shows no hits (except test files if any)

---

### Step 4: Reorder ClipReview layout
**Status:** [NEXT]

**Purpose:** Move approve/reject buttons between trajectory config and video player

**Inputs:**
- `apps/browser/src/components/ClipReview.tsx`

**Actions:**
- Reorder JSX in the main return of ClipReview. New order:
  1. review-header (shot counter)
  2. feedback-error banner
  3. TracerConfigPanel
  4. review-actions buttons
  5. marking-instruction banner
  6. video-container
  7. zoom info
  8. transport controls
  9. Scrubber
  10. tracer-controls
  11. confidence-info
  12. keyboard-hints
  13. Export modal

**Expected Outputs:**
- Layout renders in new order: config → buttons → instruction → video → scrubber

**Actual Outputs:**
```
[To be filled after execution]
```

**Verification:** `cd apps/browser && npx tsc --noEmit` + visual check dev server

---

### Step 5: Two-column trajectory settings
**Status:** [NEXT]

**Purpose:** Save vertical space by putting shape controls and point markers side by side

**Inputs:**
- `apps/browser/src/components/TracerConfigPanel.tsx`
- `apps/browser/src/styles/global.css`

**Actions:**
- In TracerConfigPanel.tsx: Wrap config rows in `<div className="config-grid">` with two `<div className="config-column">` children
  - Left column: Shot Height, Shot Shape, Flight Time
  - Right column: Origin Point, Impact Time, Landing Point, Apex Point
  - Style options toggle + style rows: full width below grid
  - Generate button: full width below
- Add CSS: `.config-grid` (2-col grid), `.config-column` (flex column), `.config-grid .config-row` (stack vertically within columns)
- Add mobile breakpoint: collapse to 1 column at <=600px

**Expected Outputs:**
- Config panel renders as two columns on desktop
- Collapses to single column on mobile

**Actual Outputs:**
```
[To be filled after execution]
```

**Verification:** `cd apps/browser && npx tsc --noEmit` + visual check at various widths

---

### Step 6: Strike indicator on timeline scrubber
**Status:** [NEXT]

**Purpose:** Show visual indicator of detected ball strike time on the timeline

**Inputs:**
- `apps/browser/src/components/Scrubber.tsx`
- `apps/browser/src/components/ClipReview.tsx`
- `apps/browser/src/styles/global.css`

**Actions:**
- Add `originalStrikeTime?: number` and `strikeTime?: number` props to Scrubber
- Render strike indicator dots inside `.scrubber` div (after playhead):
  - Green dot at `strikeTime` position (current impact time)
  - Orange dot at `originalStrikeTime` position (only when different from current)
  - 10px diameter circles, positioned absolutely below the track
- In ClipReview: Add `originalStrikeTimeRef` to capture initial strike time on shot load
- Pass both times to Scrubber as props
- Add CSS: `.scrubber-strike-indicators`, `.strike-indicator`, `.strike-indicator-original`, `.strike-indicator-current`
- Ensure `.scrubber` has `position: relative`

**Expected Outputs:**
- Green dot visible at impact time below scrubber
- Orange dot appears when user adjusts impact time via "Set to Playhead"

**Actual Outputs:**
```
[To be filled after execution]
```

**Verification:** `cd apps/browser && npx tsc --noEmit` + visual check with a loaded video

---

### Step 7: Upload screen walkthrough illustrations
**Status:** [NEXT]

**Purpose:** Show product walkthrough (upload → mark → export) on the landing page

**Inputs:**
- `apps/browser/src/App.tsx`
- `apps/browser/src/styles/global.css`

**Actions:**
- Create `apps/browser/src/components/WalkthroughSteps.tsx` with 3 SVG illustration cards
  - Step 1: Upload Video (upload icon + dashed border)
  - Step 2: Mark Tracers (video frame + trajectory arc)
  - Step 3: Export Clips (file icon + download arrow)
- In App.tsx: Wrap upload view content in `.upload-layout` grid (left: WalkthroughSteps, right: about-box + VideoDropzone)
- Add CSS: `.upload-layout` (2-col grid 280px/1fr), `.walkthrough-steps`, `.walkthrough-step`, `.walkthrough-number`, `.walkthrough-illustration`
- Mobile: collapse to horizontal strip above dropzone at <=700px

**Expected Outputs:**
- Upload screen shows illustrations on left, dropzone on right
- Mobile: illustrations horizontal above dropzone

**Actual Outputs:**
```
[To be filled after execution]
```

**Verification:** `cd apps/browser && npx tsc --noEmit` + visual check desktop and narrow window

---

### Step 8: Final cleanup and test run
**Status:** [NEXT]

**Purpose:** Ensure everything compiles, tests pass, and visual verification is complete

**Inputs:**
- All modified files from Steps 1-7

**Actions:**
- Run `cd apps/browser && npx tsc --noEmit` — fix any remaining type errors
- Run `cd apps/browser && npm run test -- --run` — fix any failing tests
- Run `cd apps/browser && npm run dev` — visual verification of all changes
- Check for any leftover dead code or unused imports
- Commit any fixes

**Expected Outputs:**
- Zero type errors
- All tests green
- Visual verification checklist complete

**Actual Outputs:**
```
[To be filled after execution]
```

**Verification:** All acceptance criteria checked off

---

## Discoveries

| Iteration | Discovery | Impact |
|-----------|-----------|--------|
| 0 | ClipReview already has inline buttons (line 1045-1056) in addition to header ReviewActions — just need to reorder, not recreate | Simplifies Task 4 |
| 0 | `.scrubber` may need `position: relative` added for absolute strike indicators | Check in Task 6 |
| 0 | ConfirmDialog component itself stays (generic utility) — only its usage in ClipReview is removed | No need to delete ConfirmDialog.tsx |

---

## What Failed

| Iteration | Approach | Why It Failed | Lesson |
|-----------|----------|---------------|--------|
| | | | |

---

## Blockers

### Active Blockers

None

### Resolved Blockers

| ID | Resolution | Iteration Resolved |
|----|------------|-------------------|
| | | |

---

## Next Action

**For Iteration 1:**

1. **Read:** Step 1 actions and `apps/browser/src/components/ClipReview.tsx`
2. **Execute:** Step 1 — Remove ConfirmDialog usage from ClipReview (remove import, state, wrapper, button handler, escape handler, render block)
3. **Watch for:** Test files that reference ConfirmDialog or showRejectConfirm — may need updating
4. **Update:** Record actual tsc output, commit hash

---

## Iteration Log

| Iteration | Timestamp | Step Executed | Outcome | Duration |
|-----------|-----------|---------------|---------|----------|
| 0 | 2026-02-18 | Setup/Planning | Loop doc created from implementation plan | — |

---

## Verification Log

| Timestamp | Check | Result | Evidence |
|-----------|-------|--------|----------|
| | | | |

---

## Exit Checklist

- [ ] Step outputs recorded with actual values (not placeholders)
- [ ] Discoveries section updated if anything learned
- [ ] What Failed section updated if approach didn't work
- [ ] Blockers section updated if stuck
- [ ] Next Action section updated with specific instructions
- [ ] Iteration count incremented in Metadata
- [ ] Last Updated timestamp refreshed
- [ ] Status field reflects current state
