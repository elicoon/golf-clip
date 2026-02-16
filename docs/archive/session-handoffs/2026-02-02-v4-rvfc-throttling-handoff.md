# V4 Export Pipeline - requestVideoFrameCallback Throttling Fix

**Date:** 2026-02-02
**Status:** RESOLVED
**Branch:** `master`

## Problem

V4 export pipeline only captured ~10-15 frames at 1fps instead of ~600 frames at 60fps for a 10-second 60fps clip. Additionally, the tracer animation was choppy even after frame capture was fixed.

## Root Causes & Fixes

### Issue 1: rVFC Throttling (Frame Capture)

Chrome throttles `requestVideoFrameCallback` to ~1fps under certain conditions:
1. ✅ Detached video elements (not in DOM) - **Fixed in commit 52041f5**
2. ✅ Elements outside viewport bounds (top: -9999px) - **Fixed in commit 785d8ee**

**Solution:** Position video element in viewport corner with minimal visibility:
```typescript
video.style.position = 'fixed'
video.style.bottom = '0'
video.style.right = '0'
video.style.width = '1px'
video.style.height = '1px'
video.style.opacity = '0.01'
video.style.pointerEvents = 'none'
video.style.zIndex = '-1'
document.body.appendChild(video)
```

### Issue 2: Choppy Tracer Animation

Even with 60fps video capture, tracer was jumping between positions.

**Root cause:** Trajectory generator created only 30 fixed points regardless of flight time. For a 3s flight at 60fps (180 frames), the tracer jumped every 6 frames.

**Solution 1** (commit 581bad8): Generate 60 trajectory points per second:
```typescript
// Before: Fixed 30 points
const NUM_TRAJECTORY_POINTS = 30

// After: Dynamic based on flightTime
const TRAJECTORY_POINTS_PER_SECOND = 60
const numPoints = Math.max(30, Math.ceil(config.flightTime * TRAJECTORY_POINTS_PER_SECOND))
```

**Solution 2** (commit 461ac5e): Interpolate the leading edge between trajectory points for perfectly smooth animation at any framerate.

### Issue 3: Vercel Not Auto-Deploying

Git pushes weren't triggering Vercel deployments. Required manual `vercel --prod` from `apps/browser/` directory.

## Final Results

After all fixes:
- **834 frames captured** at 60fps for ~14s clip
- **181 trajectory points** for 3s flight (60 pts/sec)
- **Smooth tracer animation** with interpolated leading edge
- **~27MB export files** (was ~6MB when throttled)

## Diagnostic Output (Working)

```
[PipelineV4] DIAGNOSTIC - Callback stats: {
  totalCallbacks: 834,
  capturedFrames: 834,
  avgIntervalMs: 16.71,  // ✅ 60fps
  expectedFps: 59.84
}
[PipelineV4] Trajectory points: 181
[PipelineV4] Captured 834 frames at 60.0 fps effective
```

## Key Commits

| Commit | Description |
|--------|-------------|
| 52041f5 | Append video to DOM to prevent rVFC throttling |
| 785d8ee | Position video in viewport to prevent rVFC throttling |
| 581bad8 | Increase trajectory points to 60/sec |
| 461ac5e | Interpolate tracer leading edge for smooth animation |
| 9155540 | Remove debug logging |

## Key Files

| File | Purpose |
|------|---------|
| [video-frame-pipeline-v4.ts](../../apps/browser/src/lib/video-frame-pipeline-v4.ts) | V4 pipeline with rVFC capture + tracer rendering |
| [trajectory-generator.ts](../../apps/browser/src/lib/trajectory-generator.ts) | Trajectory point generation |

## Lessons Learned

1. **rVFC throttling is position-sensitive** - Video must be in DOM AND in viewport bounds
2. **Trajectory smoothness requires both point density AND interpolation** - 60pts/sec alone wasn't enough; needed interpolation for the leading edge
3. **Vercel auto-deploy can silently fail** - Always verify deployment with `vercel ls` or manual deploy
