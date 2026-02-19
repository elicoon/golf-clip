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
| **Status** | `complete` |
| **Iteration** | `8` |
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

- [x] "No Golf Shot" button and Escape key reject immediately (no confirmation dialog)
- [x] No sticky header on any screen
- [x] "GolfClip" title shows on upload screen only
- [x] Upload screen has two-column layout: walkthrough illustrations (left) + dropzone (right)
- [x] Walkthrough illustrations are CSS/SVG (steps 1-2-3)
- [x] TracerConfigPanel is two columns (shape controls left, point markers right)
- [x] Approve/Reject buttons positioned between trajectory config and video player
- [x] Instruction banner shows below buttons, above video
- [x] Green strike indicator dot appears below scrubber at impact time
- [x] Orange strike indicator dot shows original detection time when user adjusts impact
- [x] ReviewActions component and reviewActionsStore removed
- [x] `tsc --noEmit` passes with no errors
- [x] All tests pass (`npm run test -- --run`)

### Scope Boundaries

- Not addressing: export pipeline changes
- Not addressing: mobile touch interactions
- Not addressing: test-writing for new UI (visual verification only)

---

## Key Files

| File | Purpose |
|------|---------|
| `apps/browser/src/App.tsx` | View routing — header removed, upload screen layout with walkthrough |
| `apps/browser/src/components/ClipReview.tsx` | Main review UI — reordered layout, no confirm dialog |
| `apps/browser/src/components/TracerConfigPanel.tsx` | Trajectory settings — two-column grid |
| `apps/browser/src/components/Scrubber.tsx` | Timeline — strike indicators added |
| `apps/browser/src/components/WalkthroughSteps.tsx` | NEW — SVG walkthrough illustrations |
| `apps/browser/src/styles/global.css` | All CSS styles |
| `docs/plans/2026-02-18-ui-redesign.md` | Detailed implementation plan with code |

---

## Steps

### Step 1: Remove skip shot confirmation dialog
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: b181bc3
```

---

### Step 2: Remove header and distribute content
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: 5a1edc0
```

---

### Step 3: Remove ReviewActions component and reviewActionsStore
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: f816079
Deleted: ReviewActions.tsx, reviewActionsStore.ts
Cleaned: zoom test mock for reviewActionsStore
```

---

### Step 4: Reorder ClipReview layout
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: f3e9934
New layout: config → buttons → instruction → video → scrubber
```

---

### Step 5: Two-column trajectory settings
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: 0e77cc7
TSX: config-grid with two config-column divs
CSS: .config-grid (2-col), .config-column, mobile collapse at 600px
```

---

### Step 6: Strike indicator on timeline scrubber
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: 7a902f8
Scrubber: originalStrikeTime + strikeTime props, green/orange dots
ClipReview: originalStrikeTimeRef stored on shot change
CSS: .scrubber-strike-indicators, .strike-indicator-current (green), .strike-indicator-original (orange)
```

---

### Step 7: Upload screen walkthrough illustrations
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Commit: 10efdbb
Created: WalkthroughSteps.tsx with 3 SVG illustration cards
App.tsx: upload-layout grid (walkthrough left, about+dropzone right)
CSS: .upload-layout (280px/1fr grid), .walkthrough-*, mobile collapse at 700px
```

---

### Step 8: Final cleanup and test run
**Status:** [DONE]

**Actual Outputs:**
```
tsc --noEmit: clean (0 errors)
Tests: 23 files passed, 383 tests passed
Commit: 1f5a232
Fixed: Deleted ClipReview.confirm.test.tsx (obsolete)
Fixed: Removed confirm-dialog-confirm clicks from feedbackError tests
Fixed: Updated layout test reject assertions (immediate, no dialog)
```

---

## Discoveries

| Iteration | Discovery | Impact |
|-----------|-----------|--------|
| 0 | ClipReview already has inline buttons (line 1045-1056) in addition to header ReviewActions — just need to reorder, not recreate | Simplified Task 4 |
| 0 | `.scrubber` already has `position: relative` — no CSS change needed | Simplified Task 6 |
| 0 | ConfirmDialog component itself stays (generic utility) — only its usage in ClipReview is removed | No need to delete ConfirmDialog.tsx |
| 8 | Three test files referenced confirm-dialog: feedbackError, confirm, and layout tests. Confirm test deleted entirely, others updated. | Required extra cleanup in Step 8 |

---

## What Failed

| Iteration | Approach | Why It Failed | Lesson |
|-----------|----------|---------------|--------|
| — | — | — | No failures — all steps executed cleanly |

---

## Blockers

### Active Blockers

None

### Resolved Blockers

None

---

## Next Action

**Loop complete.** All 8 steps executed, all acceptance criteria met. Ready for visual verification by user.

---

## Iteration Log

| Iteration | Timestamp | Step Executed | Outcome | Duration |
|-----------|-----------|---------------|---------|----------|
| 0 | 2026-02-18 | Setup/Planning | Loop doc created from implementation plan | — |
| 1 | 2026-02-18 | Step 1 | Removed confirm dialog from ClipReview | — |
| 2 | 2026-02-18 | Step 2 | Removed header, added title to upload screen | — |
| 3 | 2026-02-18 | Step 3 | Deleted ReviewActions + reviewActionsStore | — |
| 4 | 2026-02-18 | Step 4 | Reordered ClipReview layout | — |
| 5 | 2026-02-18 | Step 5 | Two-column trajectory settings | — |
| 6 | 2026-02-18 | Step 6 | Strike indicators on scrubber | — |
| 7 | 2026-02-18 | Step 7 | Walkthrough illustrations on upload screen | — |
| 8 | 2026-02-18 | Step 8 | Test fixes and final verification | — |

---

## Verification Log

| Timestamp | Check | Result | Evidence |
|-----------|-------|--------|----------|
| 2026-02-18 | `tsc --noEmit` | PASS | 0 errors |
| 2026-02-18 | `npm run test -- --run` | PASS | 23 files, 383 tests |

---

## Exit Checklist

- [x] Step outputs recorded with actual values (not placeholders)
- [x] Discoveries section updated if anything learned
- [x] What Failed section updated if approach didn't work
- [x] Blockers section updated if stuck
- [x] Next Action section updated with specific instructions
- [x] Iteration count incremented in Metadata
- [x] Last Updated timestamp refreshed
- [x] Status field reflects current state
