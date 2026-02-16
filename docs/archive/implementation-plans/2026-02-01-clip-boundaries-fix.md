# Clip Boundaries Extension Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to extend clip boundaries beyond the detected range, up to the full video duration.

**Architecture:** Pass video duration to Scrubber, use it for window bounds instead of clip bounds, and update visual styling to distinguish extension zones.

**Tech Stack:** React, TypeScript

---

## Background

### Root Cause Analysis (from debug report)

The Scrubber window is locked to `startTime ± 5s`:

```typescript
// packages/frontend/src/components/Scrubber.tsx lines 29-39
const windowPadding = 5 // seconds
const windowStart = Math.max(0, startTime - windowPadding)
const windowEnd = Math.min(duration || endTime + windowPadding, endTime + windowPadding)
```

**Problems:**
1. Window padding of 5s is arbitrary and may be insufficient
2. Handle positions are calculated relative to this window, limiting extension
3. Visual "out-of-bounds" styling discourages extension
4. User cannot extend beyond ±5s from detected boundaries

---

## Task 1: Add Duration Prop to Scrubber

**Files:**
- Modify: `packages/frontend/src/components/Scrubber.tsx`

**Step 1: Update props interface**

Find the props interface (around line 10-20) and add `videoDuration`:

```typescript
interface ScrubberProps {
  videoRef: React.RefObject<HTMLVideoElement>
  startTime: number
  endTime: number
  onTimeUpdate: (start: number, end: number) => void
  videoDuration?: number  // NEW: Full video duration for extension bounds
}
```

**Step 2: Destructure new prop**

Update the function signature:

```typescript
export function Scrubber({
  videoRef,
  startTime,
  endTime,
  onTimeUpdate,
  videoDuration,  // NEW
}: ScrubberProps) {
```

---

## Task 2: Update Window Calculation

**Files:**
- Modify: `packages/frontend/src/components/Scrubber.tsx`

**Step 1: Calculate extension buffer**

Replace the fixed `windowPadding` with a dynamic buffer based on video duration:

```typescript
// Calculate extension buffer - allow extending to full video or at least 30s each way
const extensionBuffer = videoDuration
  ? Math.max(30, (videoDuration - (endTime - startTime)) / 2)
  : 30

// Window around the clip with extension buffer
const windowStart = Math.max(0, startTime - extensionBuffer)
const windowEnd = videoDuration
  ? Math.min(videoDuration, endTime + extensionBuffer)
  : Math.min(duration || endTime + extensionBuffer, endTime + extensionBuffer)
```

**Alternative (simpler):** Just use full video duration:

```typescript
const windowStart = 0
const windowEnd = videoDuration || duration || endTime + 30
```

---

## Task 3: Update Handle Constraints

**Files:**
- Modify: `packages/frontend/src/components/Scrubber.tsx`

**Step 1: Update start handle constraint**

Find the start handle drag logic (around line 118-121):

```typescript
if (isDragging === 'start') {
  const newStart = Math.max(0, Math.min(time, endTime - 0.5))
  onTimeUpdate(newStart, endTime)
}
```

This is already correct - allows dragging to time 0.

**Step 2: Update end handle constraint**

Find the end handle drag logic (around line 122-125):

```typescript
} else if (isDragging === 'end') {
  const newEnd = Math.min(duration, Math.max(time, startTime + 0.5))
  onTimeUpdate(startTime, newEnd)
}
```

Update to use `videoDuration`:

```typescript
} else if (isDragging === 'end') {
  const maxEnd = videoDuration || duration || endTime + 30
  const newEnd = Math.min(maxEnd, Math.max(time, startTime + 0.5))
  onTimeUpdate(startTime, newEnd)
}
```

---

## Task 4: Add Visual Extension Zone Indicators

**Files:**
- Modify: `packages/frontend/src/components/Scrubber.tsx`
- Modify: `packages/frontend/src/styles/Scrubber.css` (or equivalent)

**Step 1: Calculate detected vs extension zones**

Add calculation for the detected zone position:

```typescript
// Original detected boundaries (for visual indication)
const detectedStartPos = timeToPosition(originalStartTime)
const detectedEndPos = timeToPosition(originalEndTime)
```

Note: Will need to pass `originalStartTime` and `originalEndTime` as props.

**Step 2: Add extension zone styling**

In the JSX, add visual distinction for extension zones:

```tsx
{/* Extension zone before detected start */}
{startPos < detectedStartPos && (
  <div
    className="scrubber-extension-zone"
    style={{ left: `${startPos}%`, width: `${detectedStartPos - startPos}%` }}
  />
)}

{/* Extension zone after detected end */}
{endPos > detectedEndPos && (
  <div
    className="scrubber-extension-zone"
    style={{ left: `${detectedEndPos}%`, width: `${endPos - detectedEndPos}%` }}
  />
)}
```

**Step 3: Add CSS for extension zone**

```css
.scrubber-extension-zone {
  position: absolute;
  top: 0;
  height: 100%;
  background: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 4px,
    rgba(255, 193, 7, 0.2) 4px,
    rgba(255, 193, 7, 0.2) 8px
  );
  pointer-events: none;
}
```

---

## Task 5: Pass Duration from ClipReview

**Files:**
- Modify: `packages/frontend/src/components/ClipReview.tsx`

**Step 1: Find Scrubber usage**

Locate where Scrubber is rendered (around line 1064-1069 or similar).

**Step 2: Pass videoDuration prop**

```tsx
<Scrubber
  videoRef={videoRef}
  startTime={currentShot.clip_start}
  endTime={currentShot.clip_end}
  onTimeUpdate={handleTimeUpdate}
  videoDuration={videoInfo?.duration}  // NEW
/>
```

---

## Testing Verification

1. **Unit test:** Verify Scrubber allows extension:
   - Start handle can drag to time 0
   - End handle can drag to video duration
   - Extended boundaries are passed to onTimeUpdate

2. **Integration test:**
   - Load video with clip at 30s-35s
   - Extend start to 20s, verify works
   - Extend end to 50s, verify works
   - Export clip, verify extended boundaries used

3. **Visual test:**
   - Extension zones show diagonal stripe pattern
   - Clear distinction between detected and extended areas

---

## Risk Assessment

**Risk Level:** Low-Medium
- Props interface change is backward compatible (optional prop)
- Window calculation change may affect scrubber zoom/scale
- Need to test with various video durations (short vs long)

**Potential Issues:**
- Very long videos may make scrubber hard to use (consider zoom)
- Need to verify export respects extended boundaries
