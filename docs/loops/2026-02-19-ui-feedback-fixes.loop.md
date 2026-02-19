# Loop: UI Feedback Fixes

> **AUTONOMOUS EXECUTION DIRECTIVE**: Any agent reading this document should continue executing from the [CURRENT] step without pausing for user acknowledgment.

## Metadata
- **Workflow:** feature
- **Status:** in-progress
- **Iteration:** 1 / 5
- **Created:** 2026-02-19
- **Last Updated:** 2026-02-19

## Objective
Fix 5 visual/UX issues found during Mac testing of the UI redesign.

## Acceptance Criteria
- [ ] Walkthrough steps vertically centered with dropzone on upload screen
- [ ] Progress bar visible during video processing (multi-video path)
- [ ] Instruction banner appears above approve/reject buttons
- [ ] Trajectory settings use 3-column layout (shape | sliders | markers)
- [ ] Inline "Trajectory updated" status appears after Generate, auto-dismisses
- [ ] `tsc --noEmit` passes
- [ ] `npm run test -- --run` passes

## Key Files
- `apps/browser/src/styles/global.css` — CSS for upload layout + config grid
- `apps/browser/src/components/VideoDropzone.tsx` — progress bar display
- `apps/browser/src/components/ClipReview.tsx` — instruction banner + generate status
- `apps/browser/src/components/TracerConfigPanel.tsx` — column layout
- `apps/browser/src/components/WalkthroughSteps.tsx` — walkthrough component

## Steps

### Step 1: Center walkthrough steps [CURRENT]
**Goal:** Fix `.upload-layout` CSS to vertically center walkthrough column with dropzone.
**Action:** Change `align-items: start` to `align-items: center` in global.css line 309.
**Output:** CSS change applied.

### Step 2: Restore progress bar [NEXT]
**Goal:** Bridge per-video state to VideoDropzone so progress bar shows during multi-video processing.
**Action:** In VideoDropzone.tsx, derive aggregate progress from the `videos` Map in the store. When any video is loading/processing, show the progress UI with that video's progress/message.
**Output:** Progress bar visible during file processing.

### Step 3: Move instruction banner above buttons
**Goal:** Instruction banner ("Click where the ball landed") should appear above approve/reject buttons, not below them.
**Action:** In ClipReview.tsx, move the `marking-instruction` div above the `review-actions` div.
**Output:** JSX reordered.

### Step 4: 3-column trajectory settings
**Goal:** Split TracerConfigPanel into 3 columns: shape controls | sliders | point markers.
**Action:**
- Update CSS `.config-grid` from `grid-template-columns: 1fr 1fr` to `1fr 1fr 1fr`
- Split left column: col1 = height + shape, col2 = flight time + impact time, col3 = origin + landing + apex
- Update TracerConfigPanel.tsx to render 3 config-columns
**Output:** 3-column layout in trajectory settings.

### Step 5: Inline status after Generate
**Goal:** Show inline "Trajectory updated" status message after clicking Generate, auto-dismiss after 3s.
**Action:** Add state to ClipReview, set it in handleGenerate's finally block, render below the Generate button, auto-dismiss with useEffect timer.
**Output:** Inline status feedback on generate.

### Step 6: Verify and commit
**Goal:** Run type check and tests, then commit.
**Action:** `tsc --noEmit` + `npm run test -- --run` + git commit
**Output:** Clean build, passing tests, committed.

### Step 7: Visual UI verification
**Goal:** Verify all 5 fixes in the browser via Playwright.
**Action:** Start dev server, navigate to app, verify each acceptance criterion visually.
**Output:** All 5 visual fixes confirmed.

## Discoveries
- `.upload-layout` uses `align-items: start` (global.css:309)
- `processVideoFile` routes progress to per-video state when given videoId, but VideoDropzone only reads global state
- ClipReview JSX order: review-actions (1063) then marking-instruction (1077) — need to swap
- TracerConfigPanel uses 2-column CSS grid (`.config-grid { grid-template-columns: 1fr 1fr }`)
- Generate button sets `isGenerating` state but no success feedback after completion

## Iteration Log
| # | Trigger | Notes |
|---|---------|-------|
| 1 | Initial | Starting implementation |

## Next Action
Execute Step 1: Change `align-items: start` to `align-items: center` in `.upload-layout`.
