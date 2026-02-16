# Session Handoff: Export Tracer Pipeline Hang (Continued Investigation)

**Date:** 2026-02-02
**Status:** STILL BROKEN - Previous fixes did not resolve the issue
**Priority:** P1

---

## TL;DR for Next Claude Instance

The export with tracer overlay hangs at 90% on 4K 60fps iPhone videos. Three fixes have been deployed but the issue persists. The problem is likely FFmpeg WASM running out of memory when processing 4K frames, even with frame count limiting. **Next step: Test if ALWAYS downscaling 4K to 1080p fixes the issue.**

---

## Problem Statement

When exporting clips with tracer overlay from 4K 60fps iPhone videos, the export hangs at ~90% during the "extracting" phase. The 2-minute timeout does not trigger, indicating FFmpeg is silently stuck rather than blocking on a single operation.

### Reproduction Steps

1. Upload a 4K 60fps iPhone video to https://browser-seven-sigma.vercel.app
2. Wait for shot detection to complete
3. Mark landing point to generate trajectory
4. Approve the shot
5. Click "Export 1 Clip" with "Render Shot Tracers" enabled
6. Observe: Export modal shows progress, reaches ~90% during "extracting" phase, then hangs indefinitely

---

## What Was Already Fixed (These Fixes Are DEPLOYED But Issue Persists)

### Fix 1: Removed `isHevcCodec()` call (commit `ff3a06d`)

**Location:** `apps/browser/src/lib/video-frame-pipeline.ts`

**What it did:** Removed the HEVC codec check that was loading the entire video blob into FFmpeg WASM memory before export. This was causing an immediate hang on large files.

**Why it didn't fully fix:** This was causing hangs at the START of export. Now export progresses to 90% before hanging, so a different issue remains.

### Fix 2: Added timeout and progress phases (commit `2a71e8c`)

**Location:** `apps/browser/src/lib/video-frame-pipeline.ts`

**What it did:**
- Added 'preparing' phase to show progress during blob loading
- Added 2-minute timeout on frame extraction
- Added fallback progress updates every second during extraction

**Why it didn't fully fix:** The timeout never triggers - FFmpeg appears to be making progress (internal event loop continues) but never completes frame extraction.

### Fix 3: Frame count limiting and 1080p downscale (commit `dfc08dd`)

**Location:** `apps/browser/src/lib/video-frame-pipeline.ts`

**What it did:**
- Capped total frames to 450 (15 seconds at 30fps)
- Reduced FPS to 24fps minimum for long clips
- Downscale to 1080p for clips that STILL exceed frame limit after FPS reduction

**Why it didn't fully fix:** The downscale only triggers for clips > ~18 seconds at 24fps. Most test clips are shorter, so they're still being processed at 4K resolution with high frame counts.

---

## Key Files

### Primary Code Files

| File | Purpose |
|------|---------|
| `apps/browser/src/lib/video-frame-pipeline.ts` | Main export pipeline, `exportWithTracer()` method |
| `apps/browser/src/lib/ffmpeg-client.ts` | FFmpeg WASM wrapper, blob loading, codec detection |
| `apps/browser/src/components/ClipReview.tsx` | UI that calls export, progress display |

### Relevant Bug Documentation

| File | Description |
|------|-------------|
| `docs/bugs/bug-export-tracer-pipeline-hang.md` | Original bug doc (marked as Fixed, but issue persists) |
| `docs/session-handoffs/2026-02-02-export-hang-investigation.md` | Initial investigation notes |
| `docs/session-handoffs/2026-02-02-e2e-debugging-plan.md` | Debug session tracking |

---

## Current State of `video-frame-pipeline.ts`

The `exportWithTracer()` method at line 63 has the following flow:

```
1. [LINES 83-113] Frame limiting logic:
   - MAX_FRAMES_AT_30FPS = 450
   - MIN_FPS = 24
   - If frames > 450: reduce fps to 24fps minimum
   - If STILL > 450 at 24fps: add 1080p downscale filter

2. [LINES 121-145] Preparing phase:
   - Convert blob to Uint8Array via fetchFile()
   - Write to FFmpeg filesystem

3. [LINES 147-229] Extracting phase (THIS IS WHERE IT HANGS):
   - 2-minute timeout set up
   - FFmpeg exec to extract frames as PNG
   - Filter: fps=${effectiveFps}${scaleFilter}
   - Output: frame_%04d.png

4. [LINES 237-275] Compositing phase:
   - Read each frame from FFmpeg FS
   - Draw tracer overlay on canvas
   - Write composited frame back

5. [LINES 277-334] Encoding phase:
   - Re-encode frames to video with audio
```

### The Hang Location

The hang occurs at line 182-189 inside the FFmpeg exec call:

```typescript
const execPromise = this.ffmpeg.exec([
  '-ss', startTime.toString(),
  '-i', inputName,
  '-t', duration.toString(),
  '-vf', vfFilter,  // e.g., "fps=30" or "fps=24,scale=1920:1080:..."
  '-f', 'image2',
  framePattern,
])
```

The fallback progress interval continues running (so JS event loop is not blocked), but FFmpeg never completes. The timeout at line 191-195 never fires because `Promise.race` only works if one promise resolves - if FFmpeg is stuck internally without rejecting, the timeout works correctly but FFmpeg just stays stuck.

---

## Hypotheses to Investigate (Ordered by Likelihood)

### Hypothesis 1: 4K PNG Frame Memory Exhaustion (MOST LIKELY)

**Theory:** Even with 450 frames, each 4K PNG frame is ~8MB. 450 frames = 3.6GB of PNG data that must be stored in FFmpeg WASM's virtual filesystem (which lives in browser memory).

**Test:** Force 1080p downscale for ALL videos, not just long clips.

**Implementation:**
```typescript
// In video-frame-pipeline.ts, around line 91
// ALWAYS downscale 4K to 1080p regardless of clip length
if (videoWidth > 1920 || videoHeight > 1080) {
  scaleFilter = ',scale=1920:1080:force_original_aspect_ratio=decrease'
}
```

**Challenge:** We don't currently know the input video dimensions at this point. Need to either:
- Add a probe step to get dimensions first
- Accept the blob size as proxy (e.g., > 50MB segment = assume 4K)
- Always apply scale filter and let FFmpeg handle it (might be inefficient for 1080p sources)

### Hypothesis 2: Segment Blob Too Large

**Theory:** The 30-second segment blob from 4K 60fps video is massive (~100MB+). `fetchFile()` and `writeFile()` may complete, but FFmpeg's internal memory management fails when processing.

**Test:** Try with a 5-second segment instead of 30-second.

**Implementation:** Reduce segment duration in detection pipeline (affects user experience though).

### Hypothesis 3: PNG Format Memory Overhead

**Theory:** PNG encoding/decoding is memory-intensive. JPEG would use less memory.

**Test:** Change frame extraction to output JPEG instead of PNG:
```typescript
'-f', 'image2',
'-q:v', '2',  // JPEG quality
'frame_%04d.jpg',  // JPEG output
```

**Consideration:** Would need to update compositing phase to handle JPEG, and tracer overlay may have quality loss from JPEG compression.

### Hypothesis 4: FFmpeg WASM Internal Bug

**Theory:** Certain combinations of resolution/fps/duration trigger a bug in FFmpeg WASM 0.12.6.

**Test:** Try upgrading FFmpeg core version or using different exec parameters.

---

## Suggested Next Steps (In Order)

### Step 1: Add Dimension-Based Downscaling

Modify `exportWithTracer()` to ALWAYS downscale 4K to 1080p:

```typescript
// After line 113 in video-frame-pipeline.ts
// Add this check before any FFmpeg operations

// WORKAROUND: Always downscale large videos to 1080p to prevent memory exhaustion
// See: docs/session-handoffs/2026-02-02-export-hang-handoff.md
if (videoBlob.size > 50 * 1024 * 1024) {  // > 50MB segment
  scaleFilter = ',scale=1920:1080:force_original_aspect_ratio=decrease'
  console.warn('[Pipeline] Large segment detected - forcing 1080p downscale')
}
```

### Step 2: Add More Granular Logging

Add logging INSIDE the FFmpeg exec flow to see exactly where it stalls:

```typescript
// Before exec
console.log('[Pipeline] FFmpeg exec starting...')
console.log('[Pipeline] Input file size:', (await this.ffmpeg.readFile(inputName)).length)

// Set up frame output monitoring
let lastFrameCount = 0
const frameCheckInterval = setInterval(async () => {
  try {
    const files = await this.ffmpeg.listDir('/')
    const frameCount = files.filter(f => f.name.startsWith('frame_')).length
    if (frameCount !== lastFrameCount) {
      console.log(`[Pipeline] Frames extracted so far: ${frameCount}`)
      lastFrameCount = frameCount
    }
  } catch (e) { /* ignore */ }
}, 1000)
```

### Step 3: Test JPEG Instead of PNG

If Step 1 doesn't fully fix it, try JPEG frames:

```typescript
const framePattern = 'frame_%04d.jpg'  // Changed from .png

// In exec args:
'-q:v', '2',  // JPEG quality (2 = high quality)
'-f', 'image2',
framePattern,
```

### Step 4: Consider Chunked Processing

If memory is truly the issue, process frames in batches:
1. Extract frames 1-100
2. Composite frames 1-100
3. Delete frames 1-100 from FFmpeg FS
4. Extract frames 101-200
5. Repeat...

This would be a larger refactor but would solve memory issues definitively.

---

## Testing Instructions

### Local Development

```bash
cd c:\Users\Eli\projects\golf-clip\apps\browser
npm run dev
# Opens http://localhost:5173
```

### Production

https://browser-seven-sigma.vercel.app

### Test Scenario

1. Use a 4K 60fps iPhone video (any length)
2. Upload and wait for processing
3. Mark landing, generate trajectory
4. Approve shot, click Export with "Render Shot Tracers" enabled
5. Monitor console for `[Pipeline]` logs
6. Observe whether export completes or hangs

### Success Criteria

- Export completes within 60 seconds for a 5-second clip
- Progress bar reaches 100%
- Video file downloads with tracer overlay visible

---

## Git History Context

```
dfc08dd fix: limit frame count and downscale for 4K videos to prevent memory exhaustion
2a71e8c fix: add timeout and progress phases for export frame extraction
ff3a06d fix: prevent export hang on large files by removing redundant HEVC check
bf64bc5 fix: support multi-video segments in ClipReview and export
```

All fixes are on `master` and deployed to production.

---

## Questions to Answer

1. Does forcing 1080p downscale for ALL videos fix the hang?
2. What is the actual resolution of the segment blob? (Need to probe it)
3. Are frames being extracted at all, or does it hang before the first frame?
4. Would JPEG frames reduce memory enough to process 4K?

---

## Notes for Future Reference

- FFmpeg WASM version: `@ffmpeg/core@0.12.6` (loaded from CDN)
- FFmpeg wrapper version: `@ffmpeg/ffmpeg@0.12.10` (in package.json)
- Safari has known issues with canvas blur filter - there's a fallback in TrajectoryEditor.tsx
- The segment blob comes from the segment extraction during detection, which is 30 seconds centered on the shot (-15s to +15s from impact)
