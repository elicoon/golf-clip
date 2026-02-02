# Bug Analysis: Clip Boundaries Cannot Be Extended Beyond Detected Range

**Date:** 2026-02-01
**Bug:** Timeline scrubber only allows shortening clips, not extending them

---

## Summary

The clip boundary extension is constrained at two levels:

1. **Visual constraint (Scrubber.tsx)**: The scrubber's visible window is locked to `startTime - 5s` to `endTime + 5s`, and handle positions are calculated relative to this window
2. **Logical constraint (Scrubber.tsx)**: Handle drag operations clamp values to prevent extension beyond the current window bounds

The bug prevents users from extending clip boundaries to capture parts of the shot that occur before `clip_start` or after `clip_end` (e.g., to include more of the ball landing, or the golfer's follow-through).

---

## Root Cause Analysis

### Constraint Location 1: Window Bounds Calculation

**File:** `packages/frontend/src/components/Scrubber.tsx`
**Lines:** 29-39

```typescript
// Window around the clip to show (extra context before and after)
// Lock the window while dragging to prevent it from shifting
const windowPadding = 5 // seconds
const [lockedWindow, setLockedWindow] = useState<{ start: number; end: number } | null>(null)

// Calculate window bounds - use locked values if dragging, otherwise compute from props
const windowStart = lockedWindow
  ? lockedWindow.start
  : Math.max(0, startTime - windowPadding)
const windowEnd = lockedWindow
  ? lockedWindow.end
  : Math.min(duration || endTime + windowPadding, endTime + windowPadding)
```

**Problem:** The visible scrubber window is calculated as:
- `windowStart = startTime - 5` (clamped to 0)
- `windowEnd = endTime + 5` (clamped to video duration)

This creates a **fixed viewport** around the current clip boundaries. While this shows 5 seconds of context on each side, the handle constraints (see below) prevent the user from actually using that context.

### Constraint Location 2: Start Handle Drag Logic

**File:** `packages/frontend/src/components/Scrubber.tsx`
**Lines:** 118-121

```typescript
if (isDragging === 'start') {
  // Ensure minimum 0.5s clip duration and clamp to bounds
  const newStart = Math.max(0, Math.min(time, endTime - 0.5))
  onTimeUpdate(newStart, endTime)
}
```

**Problem:** The start handle is constrained by:
- `Math.max(0, ...)` - Cannot go before 0 (correct)
- `Math.min(time, endTime - 0.5)` - Cannot go past end minus 0.5s (correct)

However, there is **no constraint preventing extension earlier than the current `startTime`**. The issue is not here.

### Constraint Location 3: End Handle Drag Logic

**File:** `packages/frontend/src/components/Scrubber.tsx`
**Lines:** 122-125

```typescript
} else if (isDragging === 'end') {
  // Ensure minimum 0.5s clip duration and clamp to bounds
  const newEnd = Math.min(duration, Math.max(time, startTime + 0.5))
  onTimeUpdate(startTime, newEnd)
}
```

**Problem:** The end handle is constrained by:
- `Math.min(duration, ...)` - Cannot exceed video duration (correct)
- `Math.max(time, startTime + 0.5)` - Must be at least 0.5s after start (correct)

Again, there is **no constraint preventing extension beyond the current `endTime`**. The issue is not here.

### Actual Root Cause: Window Locking During Drag

**File:** `packages/frontend/src/components/Scrubber.tsx`
**Lines:** 100-106

```typescript
// Lock the window dimensions when starting to drag a handle
if (type === 'start' || type === 'end') {
  setLockedWindow({
    start: Math.max(0, startTime - windowPadding),
    end: Math.min(duration || endTime + windowPadding, endTime + windowPadding),
  })
}
```

**Problem:** When a drag starts, the window is locked to the **current** clip boundaries plus padding. The `positionToTime` function then maps mouse positions to times **within this locked window**:

```typescript
const positionToTime = useCallback(
  (position: number): number => {
    return windowStart + (position / 100) * windowDuration
  },
  [windowStart, windowDuration]
)
```

Since `windowStart = startTime - 5` and `windowEnd = endTime + 5`, and the scrubber's visible track represents 0% to 100% of this window, the user can only drag handles within this visible range.

**The real constraint:** If the user drags the start handle all the way to the left edge (position 0%), it maps to `windowStart` which is `startTime - 5`. Similarly, dragging the end handle to the right edge (position 100%) maps to `windowEnd` which is `endTime + 5`.

So the user CAN extend by up to 5 seconds in either direction, but:
1. This is not clearly communicated visually
2. The 5-second limit may be insufficient for some shots
3. The "out-of-bounds" visual styling makes it appear the user shouldn't drag into those areas

### Constraint Location 4: Visual "Out-of-Bounds" Styling

**File:** `packages/frontend/src/components/Scrubber.tsx`
**Lines:** 204-212

```tsx
{/* Out-of-bounds regions (dimmed) */}
<div
  className="scrubber-region-outside"
  style={{ left: 0, width: `${startPos}%` }}
/>
<div
  className="scrubber-region-outside"
  style={{ left: `${endPos}%`, width: `${100 - endPos}%` }}
/>
```

**Problem:** The "dimmed" regions outside the current selection create a visual barrier that discourages users from extending into that area. The styling suggests these regions are "off limits" when they're actually just showing context.

---

## Data Flow

1. Backend creates shots with `clip_start` and `clip_end` based on detection:
   ```python
   # apps/desktop/backend/detection/pipeline.py:391-392
   clip_start = max(0, shot["strike_time"] - settings.clip_padding_before)
   clip_end = min(duration, strike_time + 7.0 + settings.clip_padding_after)
   ```

2. Frontend receives shots via API and stores in Zustand:
   ```typescript
   // packages/frontend/src/stores/appStore.ts:17-27
   interface DetectedShot {
     clip_start: number
     clip_end: number
     // ...
   }
   ```

3. ClipReview passes boundaries to Scrubber:
   ```tsx
   // packages/frontend/src/components/ClipReview.tsx:1434-1439
   <Scrubber
     videoRef={videoRef}
     startTime={currentShot.clip_start}
     endTime={currentShot.clip_end}
     onTimeUpdate={handleTimeUpdate}
   />
   ```

4. Scrubber calculates window around current boundaries:
   ```typescript
   // windowPadding = 5 seconds
   windowStart = startTime - 5  // Only 5s before clip
   windowEnd = endTime + 5      // Only 5s after clip
   ```

---

## What Needs to Change

### Option A: Respect Full Video Bounds (Recommended)

Change the window calculation to use the full video duration instead of clip-relative padding:

```typescript
// Current (constrained):
const windowStart = Math.max(0, startTime - windowPadding)
const windowEnd = Math.min(duration || endTime + windowPadding, endTime + windowPadding)

// Fixed (full video bounds):
const windowStart = 0
const windowEnd = duration
```

**Pros:**
- User can extend clip to any point in the video
- Simple change

**Cons:**
- Scrubber becomes very compressed for long videos with short clips
- May need zoom/scroll functionality for usability

### Option B: Increase Window Padding

Change `windowPadding` from 5 to a larger value (e.g., 30 seconds):

```typescript
const windowPadding = 30 // seconds instead of 5
```

**Pros:**
- Quick fix
- Maintains current UX model

**Cons:**
- Still has an arbitrary limit
- Doesn't solve the fundamental problem

### Option C: Dynamic Window with Mini-Map

Add a mini-map showing the full video timeline, with the main scrubber showing a zoomable window:

**Pros:**
- Best UX for all video lengths
- Clear visual communication

**Cons:**
- More complex implementation
- Requires significant UI changes

### Option D: Add Extension Buffers

Pass video duration to Scrubber and use it for bounds:

```typescript
// In ClipReview.tsx, pass videoDuration prop
<Scrubber
  videoRef={videoRef}
  startTime={currentShot.clip_start}
  endTime={currentShot.clip_end}
  videoDuration={videoInfo.duration}  // NEW
  onTimeUpdate={handleTimeUpdate}
/>

// In Scrubber.tsx, use video bounds for handle limits
const windowStart = 0
const windowEnd = videoDuration
```

---

## Files That Need Modification

1. **`packages/frontend/src/components/Scrubber.tsx`**
   - Line 29: Change `windowPadding` or remove the concept
   - Lines 33-38: Calculate window using video duration instead of clip bounds
   - Lines 100-106: Remove or adjust window locking logic

2. **`packages/frontend/src/components/ClipReview.tsx`** (if implementing Option D)
   - Line 1434-1439: Pass video duration as prop to Scrubber

---

## Testing Criteria

After fix, verify:
1. Start handle can be dragged to any time from 0 to `endTime - 0.5s`
2. End handle can be dragged to any time from `startTime + 0.5s` to video duration
3. Visual feedback clearly shows when user is in "extension" territory
4. Clip boundaries update correctly when handles are extended
5. Export uses the extended boundaries
