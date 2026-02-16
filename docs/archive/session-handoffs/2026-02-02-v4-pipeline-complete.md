# V4 Real-Time Export Pipeline - Complete

**Date:** 2026-02-02
**Status:** COMPLETE - Working at 60fps with video content + tracer
**Branch:** `poc/ffmpeg-filter-export`

## Summary

Built V4 export pipeline using `requestVideoFrameCallback()` for real-time frame capture. Exports 4K videos at 60fps with tracer overlay in approximately real-time (~0.85x).

## Problem Statement

V3 pipeline was slow for all resolutions due to frame-by-frame seeking:
- Each `video.currentTime = X` + waiting for `seeked` event took 300-500ms
- 4K videos took 5-8 minutes per 10-15s clip
- Even 1080p was noticeably slow

## Solution: V4 Real-Time Capture

V4 plays the video at 1x speed and captures frames as they decode using `requestVideoFrameCallback()`.

### Key Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    V4 TWO-PASS EXPORT PIPELINE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PASS 1: REAL-TIME CAPTURE (Fast)                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  1. Seek to startTime                                        │   │
│  │  2. Play video at 1x speed                                   │   │
│  │  3. requestVideoFrameCallback() fires on each decoded frame  │   │
│  │  4. Draw video to capture canvas (at OUTPUT resolution)      │   │
│  │  5. createImageBitmap(captureCanvas) → store in array        │   │
│  │  6. Stop when currentTime >= endTime                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ↓                                       │
│  PASS 2: ENCODING (Can be slow, doesn't affect capture)             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  1. For each captured ImageBitmap:                           │   │
│  │     - Draw to output canvas                                  │   │
│  │     - Draw tracer overlay                                    │   │
│  │     - Create VideoFrame, encode with VideoEncoder            │   │
│  │  2. Flush encoder, finalize muxer                            │   │
│  │  3. Return MP4 blob                                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Critical Implementation Details

#### 1. Capture Canvas at OUTPUT Resolution

**Wrong approach (slow, ~3fps):**
```typescript
// Capture at source resolution (2160x3840 for 4K)
captureCanvas.width = sourceWidth   // 2160
captureCanvas.height = sourceHeight // 3840
captureCtx.drawImage(video, 0, 0, sourceWidth, sourceHeight)
```

**Correct approach (fast, ~60fps):**
```typescript
// Capture at output resolution (608x1080 for 1080p downscale)
captureCanvas.width = width   // 608
captureCanvas.height = height // 1080
captureCtx.drawImage(video, 0, 0, width, height)
```

Drawing a 4K frame to a 4K canvas during `requestVideoFrameCallback` is too slow and causes frame drops. Drawing directly to output resolution is fast enough to capture at 60fps.

#### 2. Draw to Canvas BEFORE createImageBitmap

**Wrong approach (black frames):**
```typescript
// createImageBitmap directly from video element - unreliable
const bitmap = await createImageBitmap(video)
```

**Correct approach (works):**
```typescript
// Draw to canvas first, then create bitmap from canvas
captureCtx.drawImage(video, 0, 0, width, height)
const bitmap = await createImageBitmap(captureCanvas)
```

`createImageBitmap(video)` can return empty/black frames in some browsers when the video element isn't attached to DOM. Drawing to canvas first guarantees the frame content is captured.

#### 3. Muxer Timestamp Configuration

```typescript
const muxer = new Muxer({
  target: new ArrayBufferTarget(),
  video: { codec: 'avc', width, height },
  fastStart: 'in-memory',
  firstTimestampBehavior: 'offset', // Auto-offset so first frame is t=0
})
```

Without `firstTimestampBehavior: 'offset'`, the muxer throws "first chunk must have timestamp of 0" error because our timestamps are relative to clip start, not absolute.

#### 4. Two-Pass Architecture Prevents Frame Drops

The original single-pass approach (capture + encode in same callback) dropped frames because encoding is too slow:
- `requestVideoFrameCallback` fires at 60Hz
- Encoding a frame can take 50-100ms
- By the time encoding finishes, multiple frames have been missed

Two-pass solution:
- Pass 1: Only capture (fast) - stores ImageBitmaps in array
- Pass 2: Encode all captured frames (slow, but doesn't matter now)

## Test Results

### 4K Portrait Video (2160x3840, 60fps source)

| Clip | Duration | Frames Captured | Effective FPS | Export Time | File Size |
|------|----------|-----------------|---------------|-------------|-----------|
| Shot 1 | 10.0s | 599 | 59.9 fps | 11.7s | 16.9 MB |
| Shot 2 | 15.0s | 901 | 60.1 fps | 17.8s | 28.8 MB |
| Shot 3 | 13.9s | 834 | 60.0 fps | 16.7s | 26.5 MB |

All exports:
- Capture at source framerate (60fps)
- Export at ~0.85x realtime (slightly slower than clip duration)
- Include video content + tracer overlay
- File sizes well over 10MB quality threshold

## Files Modified

| File | Changes |
|------|---------|
| `apps/browser/src/lib/video-frame-pipeline-v4.ts` | New V4 pipeline with two-pass architecture |
| `apps/browser/src/lib/video-frame-pipeline-v3.ts` | Added `ExportResolution` type and resolution option |
| `apps/browser/src/components/ClipReview.tsx` | Added resolution dropdown, Export V4 button |

## Key Code Sections

### video-frame-pipeline-v4.ts

**Capture loop (Pass 1):**
```typescript
const captureFrame = async (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
  // Draw video to capture canvas (at output resolution)
  captureCtx.drawImage(video, 0, 0, width, height)

  // Create ImageBitmap from canvas (fast)
  const bitmap = await createImageBitmap(captureCanvas)
  const relativeTimeUs = Math.round((currentVideoTime - startTime) * 1_000_000)

  capturedBitmaps.push({ bitmap, timeUs: relativeTimeUs })

  // Request next frame
  callbackId = video.requestVideoFrameCallback(captureFrame)
}
```

**Encoding loop (Pass 2):**
```typescript
for (let i = 0; i < capturedBitmaps.length; i++) {
  const { bitmap, timeUs } = capturedBitmaps[i]

  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  drawTracer(ctx, trajectory, trajectoryTime, width, height, tracerStyle)

  const frame = new VideoFrame(canvas, { timestamp: timeUs })
  encoder.encode(frame, { keyFrame: i % 30 === 0 })
  frame.close()
}
```

## Browser Compatibility

- Requires `requestVideoFrameCallback` support (Chrome 83+, Edge 83+, Safari 15.4+)
- Falls back to V3 if not supported (checked via `isVideoFrameCallbackSupported()`)

## Quality Threshold

Per user feedback: exports under 10MB likely indicate quality issues (low fps or resolution). All V4 exports exceed this threshold.

## Commits

- `[pending]` - feat(export): add V4 real-time capture pipeline with 60fps support

## Next Steps

1. Get user approval for merge to master
2. Consider making V4 the default export method
3. Remove V2/V3 POC buttons after V4 is stable in production
