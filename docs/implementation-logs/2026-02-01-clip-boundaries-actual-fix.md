# Clip Boundaries Extension Fix - Implementation Log

**Date:** 2026-02-01
**Branch:** `fix/clip-boundary-extension-v2`
**Commit:** `3e19fc1`

## Problem

The timeline scrubber only allowed shortening clips, not extending them. The window was locked to +/-5 seconds from the detected clip boundaries, which prevented users from extending clips when the auto-detection cut off too early.

## Root Cause

In `packages/frontend/src/components/Scrubber.tsx`:

1. `windowPadding` was hardcoded to 5 seconds
2. The window bounds were calculated relative to `startTime` and `endTime` with only 5s padding
3. The end handle constraint used `duration` (loaded video duration) but clamped to a small window
4. There was no way for users to extend beyond the initial detected boundaries

## Solution

### 1. Added `videoDuration` prop to Scrubber interface

```typescript
interface ScrubberProps {
  videoRef: RefObject<HTMLVideoElement>
  startTime: number
  endTime: number
  onTimeUpdate: (start: number, end: number) => void
  disabled?: boolean
  videoDuration?: number  // NEW: Total video duration for extended boundary support
}
```

### 2. Dynamic extension buffer calculation

```typescript
// Calculate extension buffer: use 30s or 25% of video duration, whichever is smaller
const totalDuration = videoDuration || duration
const extensionBuffer = totalDuration ? Math.min(30, totalDuration * 0.25) : 30
```

This approach:
- Allows up to 30 seconds of extension by default
- For short videos, limits to 25% of total duration to prevent showing too much empty timeline
- Falls back to 30s if video duration is not yet known

### 3. Updated window bounds calculation

```typescript
const windowStart = lockedWindow
  ? lockedWindow.start
  : Math.max(0, startTime - extensionBuffer)
const windowEnd = lockedWindow
  ? lockedWindow.end
  : totalDuration
    ? Math.min(totalDuration, endTime + extensionBuffer)
    : endTime + extensionBuffer
```

### 4. Updated end handle constraint

```typescript
// Ensure minimum 0.5s clip duration and clamp to video bounds
const maxEnd = videoDuration || duration || endTime + 30
const newEnd = Math.min(maxEnd, Math.max(time, startTime + 0.5))
```

### 5. Pass videoDuration from ClipReview

In `packages/frontend/src/components/ClipReview.tsx`:

```tsx
const { shots, updateShot, currentJob } = useAppStore()

// ...

<Scrubber
  videoRef={videoRef}
  startTime={currentShot.clip_start}
  endTime={currentShot.clip_end}
  onTimeUpdate={handleTimeUpdate}
  disabled={loadingState === 'loading'}
  videoDuration={currentJob?.video_info?.duration}
/>
```

## Files Changed

| File | Changes |
|------|---------|
| `packages/frontend/src/components/Scrubber.tsx` | Added `videoDuration` prop, dynamic extension buffer, updated window/handle bounds |
| `packages/frontend/src/components/ClipReview.tsx` | Pass `videoDuration` from app store to Scrubber |

## Verification

- TypeScript check passes (main source files compile without errors)
- Commit created on branch `fix/clip-boundary-extension-v2`

## Expected Behavior After Fix

1. For a 2-minute video, users can now extend clip boundaries up to 30s beyond detected range
2. For short videos (<2 minutes), extension limited to 25% of video duration
3. Users can extend both start and end handles to include more footage
4. The scrubber timeline shows a larger window for easier navigation

## Note

This fix only affects `packages/frontend`. The `apps/browser` version has a separate codebase that may need a similar fix applied separately.
