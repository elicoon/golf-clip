# Scrubber Coordinate System Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the Scrubber component's coordinate system mismatch so playhead position and trim handles render correctly when reviewing video clips.

**Architecture:** The Scrubber receives global video times (e.g., clipStart: 45s from the original video) but the blob it's scrubbing starts at time 0. The fix converts global times to blob-relative times before passing to Scrubber, and moves the Scrubber visually to be grouped with transport controls.

**Tech Stack:** React, TypeScript

---

## Background

### The Problem

1. **Coordinate mismatch**: ClipReview passes `currentShot.clipStart` (e.g., 45.0s in original video) to Scrubber, but the video blob only covers the segment and starts at 0s.

2. **Negative positions**: When `video.currentTime` returns blob-relative time (e.g., 3.0s) and `timeToPosition()` subtracts `windowStart` (45.0s global), the result is negative, causing the playhead to render off-screen.

3. **Layout issue**: The Scrubber is placed after the TracerConfigPanel (line 1064), visually disconnecting it from the video transport controls it belongs with.

### The Solution

1. Convert global times to blob-relative before passing to Scrubber
2. Move Scrubber JSX to render after video transport controls
3. Add a window duration guard to prevent division by zero

---

## Task 1: Add Blob-Relative Time Conversion in ClipReview

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:1064-1069`

**Step 1: Calculate blob-relative times**

Locate the Scrubber usage at line 1064-1069:

```tsx
<Scrubber
  videoRef={videoRef}
  startTime={currentShot.clipStart}
  endTime={currentShot.clipEnd}
  onTimeUpdate={handleTrimUpdate}
/>
```

Change it to pass blob-relative times:

```tsx
<Scrubber
  videoRef={videoRef}
  startTime={currentShot.clipStart - currentShot.startTime}
  endTime={currentShot.clipEnd - currentShot.startTime}
  onTimeUpdate={(newStart, newEnd) => {
    // Convert blob-relative times back to global for storage
    handleTrimUpdate(newStart + currentShot.startTime, newEnd + currentShot.startTime)
  }}
/>
```

**Step 2: Run typecheck to verify no type errors**

Run: `cd apps/browser && npm run typecheck`
Expected: No errors related to Scrubber props

**Step 3: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "fix(scrubber): convert global times to blob-relative for Scrubber

The video blob starts at 0, but clipStart/clipEnd are global times.
Subtract startTime offset before passing to Scrubber."
```

---

## Task 2: Move Scrubber to Video Transport Controls Section

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Locate current Scrubber position**

The Scrubber is currently at lines 1064-1069, after the TracerConfigPanel. It should be visually grouped with video playback controls.

**Step 2: Cut the Scrubber JSX from lines 1064-1069**

Remove the entire Scrubber block (including the updated props from Task 1).

**Step 3: Paste Scrubber after video-transport-controls div**

Insert the Scrubber immediately after the closing `</div>` of `video-transport-controls` (after line 951):

```tsx
      </div>

      <Scrubber
        videoRef={videoRef}
        startTime={currentShot.clipStart - currentShot.startTime}
        endTime={currentShot.clipEnd - currentShot.startTime}
        onTimeUpdate={(newStart, newEnd) => {
          handleTrimUpdate(newStart + currentShot.startTime, newEnd + currentShot.startTime)
        }}
      />

      {/* Instruction banner based on review step */}
```

**Step 4: Verify dev server renders correctly**

Run: `cd apps/browser && npm run dev`
Expected: Scrubber appears below the video transport controls (skip/play/step buttons)

**Step 5: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "refactor(clip-review): move Scrubber under transport controls

Groups timeline controls together for better UX. Scrubber now renders
immediately after skip/play/step buttons."
```

---

## Task 3: Add Window Duration Guard in Scrubber

**Files:**
- Modify: `apps/browser/src/components/Scrubber.tsx:39`

**Step 1: Locate windowDuration calculation**

At line 39:

```tsx
const windowDuration = windowEnd - windowStart
```

**Step 2: Add minimum duration guard**

Change to prevent division by zero:

```tsx
const windowDuration = Math.max(0.1, windowEnd - windowStart)
```

**Step 3: Run typecheck**

Run: `cd apps/browser && npm run typecheck`
Expected: No type errors

**Step 4: Commit**

```bash
git add apps/browser/src/components/Scrubber.tsx
git commit -m "fix(scrubber): guard against zero window duration

Prevents NaN/Infinity in position calculations when windowEnd equals windowStart."
```

---

## Task 4: Manual Verification

**Files:** None (testing only)

**Step 1: Start dev server**

Run: `cd apps/browser && npm run dev`

**Step 2: Upload a video and detect shots**

1. Open http://localhost:5173
2. Upload a test video with at least one golf shot
3. Wait for detection to complete

**Step 3: Enter clip review and verify scrubber behavior**

Verify the following in clip review:

- [ ] Scrubber appears below the transport control buttons (skip/play/step)
- [ ] Playhead position matches video currentTime (not negative/off-screen)
- [ ] Start handle renders at left edge of selected region
- [ ] End handle renders at right edge of selected region
- [ ] Dragging start handle updates clip start time
- [ ] Dragging end handle updates clip end time
- [ ] Clicking on track seeks video to that position
- [ ] Time labels show correct blob-relative times (starting from 0)

**Step 4: Commit verification results**

If all checks pass, the fix is complete. If any fail, debug and fix before proceeding.

---

## Summary of Changes

| File | Change |
|------|--------|
| `ClipReview.tsx` | Convert global times to blob-relative when passing to Scrubber |
| `ClipReview.tsx` | Move Scrubber JSX from after TracerConfigPanel to after video-transport-controls |
| `Scrubber.tsx` | Add `Math.max(0.1, ...)` guard to windowDuration |

## Edge Cases Handled

1. **Zero-duration window**: Guard prevents NaN in position calculations
2. **Global vs blob time**: Explicit conversion in ClipReview
3. **Time updates**: Callback converts blob-relative back to global for storage
