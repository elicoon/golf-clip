# Redundant Navigation Buttons Fix - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove duplicate navigation controls from ClipReview and reposition review action buttons for better UX.

**Architecture:** The ClipReview component currently has three control regions: `playback-controls` (Previous/Play/Next), `video-transport-controls` (frame-precise navigation), and `review-actions` (Approve/Reject). The `playback-controls` duplicates functionality and will be removed. The `review-actions` will be repositioned after the `marking-instruction` banner for immediate visibility.

**Tech Stack:** React (TypeScript), CSS

---

## Context

### Current Structure (lines 890-1100 of ClipReview.tsx)

```
890:  <div className="review-header">...</div>
891:
892:  <div className="playback-controls">      <-- REMOVE THIS BLOCK (891-912)
893:    <button>Previous</button>
900:    <button>Play/Pause</button>             <-- Duplicated in video-transport-controls
905:    <button>Next</button>
912:  </div>
913:
914:  <div className="video-transport-controls">  <-- KEEP (precise frame controls)
915:    ...
951:  </div>
952:
953:  <div className="marking-instruction">...</div>
967:
968:  <div className="video-container">...</div>  <-- After this, we need review-actions
...
1082:
1083: <div className="review-actions">           <-- MOVE THIS UP
1084:   <button>No Golf Shot</button>
1087:   <button>Approve Shot</button>
1090: </div>
```

### Target Structure

```
<div className="review-header">...</div>

<div className="video-transport-controls">...</div>  (KEEP - precise frame controls)

<div className="marking-instruction">...</div>

<div className="review-actions">...</div>           (MOVED - immediately after instruction)

<div className="video-container">...</div>
```

---

## Task 1: Remove playback-controls div from ClipReview.tsx

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:891-912`

**Step 1: Delete the playback-controls block**

In `apps/browser/src/components/ClipReview.tsx`, delete lines 891-912 (the entire `playback-controls` div):

```tsx
// DELETE THIS ENTIRE BLOCK (lines 891-912):
      <div className="playback-controls">
        <button
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          className="btn-secondary"
        >
          ← Previous
        </button>
        <button
          onClick={togglePlayPause}
          className="btn-secondary btn-play"
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={handleNext}
          disabled={currentIndex >= totalShots - 1}
          className="btn-secondary"
        >
          Next →
        </button>
      </div>
```

**Step 2: Verify the file compiles**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm run typecheck`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "fix(ClipReview): remove duplicate playback-controls nav buttons"
```

---

## Task 2: Move review-actions div after marking-instruction

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Cut the review-actions block**

Locate the review-actions div (after Task 1, it will be around line 1061-1068):

```tsx
      <div className="review-actions">
        <button onClick={handleReject} className="btn-no-shot">
          ✕ No Golf Shot
        </button>
        <button onClick={handleApprove} className="btn-primary btn-large">
          ✓ Approve Shot
        </button>
      </div>
```

Cut this entire block.

**Step 2: Paste after marking-instruction**

Insert the review-actions block immediately after the closing `</div>` of `marking-instruction` (around line 945 after Task 1). The result should look like:

```tsx
      {/* Instruction banner based on review step */}
      <div className="marking-instruction">
        {reviewStep === 'marking_landing' && (
          <>
            <span className="step-badge">Step 1</span>
            <span className="instruction-text">Click where the ball landed</span>
          </>
        )}
        {reviewStep === 'reviewing' && (
          <>
            <span className="step-badge complete">Ready</span>
            <span className="instruction-text">Review the trajectory, then approve or reject</span>
          </>
        )}
      </div>

      <div className="review-actions">
        <button onClick={handleReject} className="btn-no-shot">
          ✕ No Golf Shot
        </button>
        <button onClick={handleApprove} className="btn-primary btn-large">
          ✓ Approve Shot
        </button>
      </div>

      <div className="video-container">
```

**Step 3: Verify the file compiles**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm run typecheck`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "fix(ClipReview): move review-actions after marking-instruction for visibility"
```

---

## Task 3: Remove orphaned .playback-controls CSS

**Files:**
- Modify: `apps/browser/src/styles/global.css:850-859`

**Step 1: Delete the .playback-controls CSS block**

In `apps/browser/src/styles/global.css`, delete lines 850-859:

```css
/* DELETE THIS BLOCK (lines 850-859): */
.playback-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  padding: var(--spacing-sm);
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius);
}
```

**Step 2: Verify build succeeds**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm run build`
Expected: Build completes without errors

**Step 3: Commit**

```bash
git add apps/browser/src/styles/global.css
git commit -m "chore(css): remove orphaned .playback-controls styles"
```

---

## Task 4: Visual Verification

**Step 1: Start dev server**

Run: `cd c:\Users\Eli\projects\golf-clip\apps\browser && npm run dev`

**Step 2: Test in browser**

1. Open http://localhost:5173
2. Upload a golf video
3. Navigate to ClipReview
4. Verify:
   - No "Previous / Play / Next" buttons appear
   - Video transport controls (frame step icons) still work
   - "No Golf Shot" and "Approve Shot" buttons appear near the top, after the instruction banner
   - Keyboard shortcuts still work (Space for play/pause, arrow keys, Enter/Escape)

**Step 3: Take screenshot evidence**

Save screenshot to `docs/test-evidence/2026-02-01-redundant-nav-fixed.png`

**Step 4: Final commit**

```bash
git add docs/test-evidence/
git commit -m "test: add visual evidence of redundant nav fix"
```

---

## Rollback Plan

If issues arise, revert all commits from this session:

```bash
git revert HEAD~3..HEAD
```

---

## Files Modified

| File | Change |
|------|--------|
| `apps/browser/src/components/ClipReview.tsx` | Remove playback-controls, move review-actions |
| `apps/browser/src/styles/global.css` | Remove .playback-controls CSS |

## Acceptance Criteria

- [ ] No duplicate play/pause button
- [ ] No Previous/Next navigation buttons
- [ ] Review actions (Approve/Reject) visible near top of review UI
- [ ] Video transport controls (frame stepping) still functional
- [ ] Keyboard shortcuts unchanged
- [ ] No TypeScript or build errors
