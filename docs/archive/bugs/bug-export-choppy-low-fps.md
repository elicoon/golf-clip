# Bug: Export Choppy / Low FPS

**Date:** 2026-02-02
**Status:** CLOSED (Cannot Reproduce)
**Severity:** Critical
**Component:** Browser Export Pipeline
**Closed:** 2026-02-04

## Resolution (2026-02-04)

**Cannot Reproduce.** Extensive testing showed V4 exports work correctly at 60fps across all environments:

| Environment | UI Version | FPS | File Size | Result |
|-------------|------------|-----|-----------|--------|
| Localhost (old UI) | V1/V2/V3/V4 buttons | 59.9 fps | 27.5 MB | ✅ Working |
| Localhost (new UI) | Single Export button | 60.0 fps | 27.6 MB | ✅ Working |
| Vercel PROD | V1/V2/V3/V4 buttons | 60.0 fps | ~27 MB | ✅ Working |

**Suspected Cause:** Intermittent Chrome rVFC throttling when tab loses focus, browser minimized, or Chrome Energy Saver active. The V4 pipeline already has throttling workarounds (lines 167-180 in video-frame-pipeline-v4.ts).

**If Recurs:** Capture Chrome version, tab focus state, Energy Saver mode, and system load at time of failure.

---

## Regression Context (2026-02-04)

This bug was reported after simplifying the export UI. Changes made:
- Removed V1, V2, V3 export buttons (kept only V4, renamed to "Export")
- Removed the Draft/Preview/Final quality dropdown (not used by V4)
- Kept the resolution dropdown (Original/1080p/720p)
- Cleaned up unused imports and handler functions

Investigation confirmed the UI cleanup did NOT cause the issue — the V4 code path is identical before and after.

---

## Original Bug Documentation (Previously Resolved)

## Symptoms

1. **Black frames with tracer only**: Exported videos showed just the red tracer line on a black background - no video content
2. **Low FPS**: Export captured only ~3fps instead of source 60fps, resulting in choppy playback
3. **Small file sizes**: Exports under 1MB when they should be 15-30MB

## Root Causes

### Issue 1: Black Frames

**Cause:** `createImageBitmap(video)` called directly on video element returns empty/black bitmap when video element is not attached to DOM.

**Evidence:**
```typescript
// This returns empty bitmap:
const bitmap = await createImageBitmap(video)

// Debug showed:
console.log('[PipelineV4] Center pixel after drawImage:', 0, 0, 0, 0) // All zeros
```

**Fix:** Draw video to canvas first, then create ImageBitmap from canvas:
```typescript
// Draw video to canvas (synchronous, guaranteed to have frame content)
captureCtx.drawImage(video, 0, 0, width, height)

// Then create bitmap from canvas
const bitmap = await createImageBitmap(captureCanvas)
```

### Issue 2: Low FPS (3fps instead of 60fps)

**Cause:** Capturing at source resolution (2160x3840 for 4K) during `requestVideoFrameCallback` is too slow. The callback must return quickly to not miss the next frame.

**Evidence:**
```
// With source resolution capture canvas:
[PipelineV4] Captured 29 frames at 2.9 fps effective  // BAD

// With output resolution capture canvas:
[PipelineV4] Captured 599 frames at 59.9 fps effective  // GOOD
```

**Fix:** Use output resolution for capture canvas, not source resolution:
```typescript
// WRONG: Source resolution (slow)
captureCanvas.width = sourceWidth   // 2160
captureCanvas.height = sourceHeight // 3840

// CORRECT: Output resolution (fast)
captureCanvas.width = width   // 608
captureCanvas.height = height // 1080
```

### Issue 3: Timestamp Offset Error

**Cause:** mp4-muxer requires first chunk to have timestamp 0, but our clips start at arbitrary times.

**Error:** `The first chunk for your media track must have a timestamp of 0`

**Fix:** Configure muxer to auto-offset timestamps:
```typescript
const muxer = new Muxer({
  target: new ArrayBufferTarget(),
  video: { codec: 'avc', width, height },
  fastStart: 'in-memory',
  firstTimestampBehavior: 'offset',  // <-- This fixes it
})
```

## Solution Summary

The V4 pipeline now uses a two-pass architecture:

1. **Pass 1 (Capture):** Play video at 1x, capture frames to output-resolution canvas, store as ImageBitmaps
2. **Pass 2 (Encode):** Iterate through captured bitmaps, composite tracer, encode with VideoEncoder

Key changes in `video-frame-pipeline-v4.ts`:
- Capture canvas at output resolution (608x1080), not source (2160x3840)
- Draw video to canvas before createImageBitmap
- Two-pass architecture to decouple capture from encoding
- Muxer configured with `firstTimestampBehavior: 'offset'`

## Verification

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Video content | Black/missing | Visible | Visible |
| FPS captured | 2.9 fps | 59.9 fps | ~60 fps |
| File size (10s clip) | <1 MB | 16.9 MB | >10 MB |
| Export speed | N/A | 0.85x realtime | ~1x realtime |

## Quality Threshold

Per user feedback: **Exports under 10MB typically indicate quality issues** (low FPS or missing content). Use this as a quick validation check.

## Files Modified

- `apps/browser/src/lib/video-frame-pipeline-v4.ts`

## Related Commits

- `[pending]` feat(export): fix V4 pipeline black frames and low FPS capture
