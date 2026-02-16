# Debug Findings: Frame Step No Visible Video Change

**Date:** 2026-02-15
**Bug:** frame-step-no-visible-video-change
**Status:** Root cause identified

## Summary

Frame step buttons (⏩/⏪) step by 1/60s but the test video is 30fps. Every other click lands on the same decoded video frame, producing no visible change. Only 5 out of 10 clicks produce a visible frame change.

## Evidence

### requestVideoFrameCallback instrumentation on production

10 consecutive ⏩ clicks from paused state at clip start:

| Click | currentTime | mediaTime (actual frame) | New Frame? |
|-------|------------|--------------------------|------------|
| 1 | 0.082666 | 0.066000 | YES |
| 2 | 0.099332 | 0.066000 | NO |
| 3 | 0.115998 | 0.099333 | YES |
| 4 | 0.132664 | 0.099333 | NO |
| 5 | 0.149330 | 0.132667 | YES |
| 6 | 0.165996 | 0.132667 | NO |
| 7 | 0.182662 | 0.166000 | YES |
| 8 | 0.199328 | 0.166000 | NO |
| 9 | 0.215994 | 0.199333 | YES |
| 10 | 0.232660 | 0.199333 | NO |

### Analysis

- `currentTime` increments by exactly 1/60 = 0.016666s each click (code works correctly)
- `mediaTime` only changes every 2 clicks — gaps are ~0.033s = 1/30
- **Video is 30fps**, frame step is hardcoded to 1/60s
- Each frame occupies a 0.033s window; stepping 0.016s often stays within the same frame

## Root Cause

**Hardcoded frame step of 1/60s in ClipReview.tsx (lines 614, 619)**

```typescript
// stepFrameForward
videoRef.current.currentTime += 1/60  // 0.01667s — too small for 30fps video

// stepFrameBackward
videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1/60)
```

This assumes 60fps video. For 30fps video (or any other rate), the step size needs to match the actual frame duration.

## Fix

Two approaches:

### Approach A: Detect actual FPS via requestVideoFrameCallback (Recommended)
1. On video load, use `requestVideoFrameCallback` to measure actual frame duration
2. Store detected FPS in a ref
3. Step by `1/detectedFPS` instead of `1/60`

### Approach B: Step to next/previous frame boundary
1. After stepping, use `requestVideoFrameCallback` to get the actual `mediaTime`
2. If mediaTime didn't change, step again by another increment
3. More complex but handles variable-rate video

### Approach C: Use larger fixed step
1. Step by 1/30s always — works for 30fps but overshoots 60fps
2. Simplest but least correct

**Recommendation: Approach A** — detect FPS once, use it everywhere. Most video is 30fps or 60fps.

## Files to Modify

- `apps/browser/src/components/ClipReview.tsx` — lines 614 (stepFrameForward), 619 (stepFrameBackward)
- Need to add FPS detection logic (on video loadedmetadata or first frame callback)
