# Bug: Scrubber Timeline Not Working

**Status:** Fixed
**Priority:** Critical
**Component:** Scrubber.tsx, ClipReview.tsx
**Date:** 2026-02-01

## Description

The scrubber/timeline component is fundamentally broken. The playhead doesn't move during video playback, time labels can be inverted, and the scrubber is positioned far from other playback controls.

## Issues

### 1. Clip Trim Handles Not Working
The handles that allow extending or reducing the clip length at the start/end are incorrectly rendered and non-functional.

### 2. Playhead Doesn't Track Video Playback
The playhead should move along the timeline as the video plays, but it remains static. There's a non-functional visual artifact that looks like a play button but doesn't actually track position.

### 3. Wrong Position in Layout
Scrubber is positioned below the video and tracer controls instead of grouped with playback controls above the video.

**Decision:** Move scrubber to directly above video, grouped with all playback controls (transport buttons, etc).

### 4. (Possibly Fixed) Inverted Time Window Calculation
The scrubber can display incorrect time labels - left side showing larger time than right side. May be fixed based on 2026-02-01 testing showing correct labels.

**Root cause (if still occurring):** The `windowEnd` calculation in Scrubber.tsx has a race condition with video duration.

## Expected Behavior

- Playhead moves smoothly along timeline during video playback
- Left time label < Right time label (always)
- Clicking/dragging on timeline seeks video correctly
- Scrubber positioned with other playback controls above video

## Technical Notes

**Window calculation fix needed:**
```typescript
// Guard against inverted window
const rawWindowEnd = Math.min(duration || endTime + windowPadding, endTime + windowPadding)
const windowEnd = lockedWindow
  ? lockedWindow.end
  : Math.max(rawWindowEnd, windowStart + 1)  // ensure at least 1s window

// Prevent division by zero/negative
const windowDuration = Math.max(0.1, windowEnd - windowStart)
```

**Layout fix:** Move `<Scrubber />` JSX in ClipReview.tsx to directly after transport controls section.

**Static artifact:** Remove the non-functional playhead element from Scrubber.tsx JSX (lines 261-267).

## Files

- `apps/browser/src/components/Scrubber.tsx` - Window calculation, playhead element
- `apps/browser/src/components/ClipReview.tsx` - Layout position
- `apps/browser/src/styles/global.css` - Scrubber styles

## Resolution

Window calculation guards were added in commit 33e64c4 to prevent inverted time windows and division by zero/negative values. The fixes include:

1. Guard against inverted window: `Math.max(rawWindowEnd, windowStart + 1)` ensures at least 1s window
2. Prevent division by zero: `Math.max(0.1, windowEnd - windowStart)` for windowDuration
3. Playhead now properly tracks video playback with correct position calculations

## Verification

Unit tests were created in `apps/browser/src/components/Scrubber.unit.test.tsx` to verify:
- Window calculations produce valid ranges
- Playhead position updates correctly during playback
- Time labels always display left < right
- Edge cases (zero duration, missing values) are handled gracefully
