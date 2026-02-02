# Frame Extraction Bug Analysis

**Date:** 2026-02-01
**Bug:** "Frame extraction produced no frames. The video may be corrupted or in an unsupported format."
**Status:** Analysis complete, fix documented in `docs/implementation-plans/2026-02-01-frame-extraction-fix.md`

---

## Summary

The bug occurs when exporting clips with tracer overlay in the browser app. The root cause is FFmpeg.wasm's inability to decode HEVC/H.265 encoded video, combined with insufficient error handling that obscures the actual failure reason.

---

## Code Flow Analysis

### 1. Export Entry Point

**File:** `apps/browser/src/components/ClipReview.tsx`

Export is triggered when user clicks "Export Clips" after reviewing shots. The flow:

1. **Line 374-480:** `handleExport()` callback
   - Gets approved segments from store (line 375-376)
   - Loads FFmpeg and creates `VideoFramePipeline` (lines 391-393)
   - Loops through approved segments calling `exportSegmentWithTracer()` (line 402)

2. **Line 343-369:** `exportSegmentWithTracer()` callback
   - Calls `pipeline.exportWithTracer(config)` (line 368)
   - Catches `HevcExportError` specifically (line 425) to show transcode modal
   - Other errors bubble up to show generic error message

### 2. Frame Extraction Location

**File:** `apps/browser/src/lib/video-frame-pipeline.ts`

The actual frame extraction happens in `VideoFramePipeline.exportWithTracer()`:

```
Lines 60-139: exportWithTracer() method
  |
  +-- Lines 78-83: HEVC codec check (calls isHevcCodec())
  |     If HEVC detected, throws HevcExportError immediately
  |
  +-- Lines 109-117: Frame extraction FFmpeg command
  |     ffmpeg.exec(['-ss', startTime, '-i', input, '-t', duration, '-vf', 'fps=30', '-f', 'image2', pattern])
  |
  +-- Lines 129-134: Frame verification
        Checks if frame_0001.png exists
        If not found, throws: "Frame extraction produced no frames..."
```

The exact FFmpeg command executed for frame extraction (line 110-117):
```javascript
await this.ffmpeg.exec([
  '-ss', startTime.toString(),    // Seek to start
  '-i', inputName,                // Input file
  '-t', duration.toString(),      // Duration
  '-vf', `fps=${fps}`,           // Video filter: extract at fps rate
  '-f', 'image2',                 // Output format: image sequence
  framePattern,                   // Output pattern: frame_%04d.png
])
```

### 3. HEVC Detection Logic

**File:** `apps/browser/src/lib/ffmpeg-client.ts`

```
Lines 99-126: isHevcCodec() function
  |
  +-- Writes video blob to FFmpeg virtual filesystem
  +-- Runs: ffmpeg -i input -f null -
  +-- Captures log output
  +-- Searches for 'hevc', 'h265', or 'hvc1' in logs
  +-- Returns true if any found
```

There's also a faster browser-based detection:

```
Lines 136-201: detectVideoCodec() function
  |
  +-- Creates temporary <video> element
  +-- Tries to load video metadata
  +-- If error or no dimensions, assumes HEVC
  +-- Used at upload time in VideoDropzone
```

---

## Why HEVC Videos Fail

### Root Cause 1: FFmpeg.wasm Lacks HEVC Decoder

FFmpeg.wasm (version 0.12.6 from CDN) is compiled without HEVC/H.265 decoder support. This is a deliberate choice because:

1. HEVC is patent-encumbered (licensing costs)
2. Including the decoder would increase WASM bundle size significantly (~5-10MB)
3. The decoder is computationally expensive for browser WASM

When FFmpeg.wasm attempts to process HEVC video:
- The `exec()` call may return non-zero exit code (but this wasn't being checked!)
- No frames are extracted to the virtual filesystem
- The error manifests as "frame_0001.png not found"

### Root Cause 2: Segment Codec Preservation

**File:** `apps/browser/src/lib/streaming-processor.ts`

When segments are extracted during processing:

```
Line 148: const segmentBlob = await extractVideoSegment(file, segmentStart, segmentDuration)
```

**File:** `apps/browser/src/lib/ffmpeg-client.ts`

```
Lines 355-361: extractVideoSegment() uses -c copy
  |
  ffmpeg -ss start -i input -t duration -c copy -avoid_negative_ts make_zero output
```

The `-c copy` flag means **stream copy** - no re-encoding. This preserves the original codec. So:

1. User uploads HEVC video (e.g., iPhone recording)
2. HEVC is detected at upload, user may choose to skip transcoding
3. Audio is extracted successfully (audio track is usually AAC, which works)
4. Video segments are extracted with `-c copy`, preserving HEVC
5. During export, segment is still HEVC
6. The `isHevcCodec()` check runs on the segment blob (lines 80-83)
7. If it correctly identifies HEVC, `HevcExportError` is thrown (good path)
8. If detection misses it, frame extraction proceeds and fails silently

### Root Cause 3: Missing Exit Code Validation

**File:** `apps/browser/src/lib/video-frame-pipeline.ts`

The original code (lines 109-123) didn't check FFmpeg's exit code:

```javascript
try {
  await this.ffmpeg.exec([...])  // Returns exit code, not checked!
} catch (error) {
  // Only catches if exec() throws, not if it returns non-zero
}
```

FFmpeg.wasm's `exec()` returns a numeric exit code but rarely throws. When HEVC decoding fails:
- Exit code is non-zero (e.g., 1)
- No exception is thrown
- Code proceeds to frame verification
- frame_0001.png doesn't exist
- Generic "no frames" error is thrown

---

## Detection Gap Analysis

### When HEVC Detection Works

1. **At upload time** (`detectVideoCodec()` in ffmpeg-client.ts)
   - Uses browser's native video element
   - If browser can't play it, assumes HEVC
   - User is shown `HevcTranscodeModal`

2. **At export time** (`isHevcCodec()` in ffmpeg-client.ts)
   - Uses FFmpeg log parsing
   - Explicitly checks segment blob before frame extraction
   - If detected, throws `HevcExportError`

### When Detection Can Fail

1. **Browser detection false negative**
   - Some browsers (Safari with extensions, Edge) can play HEVC
   - Video loads successfully but segment is still HEVC
   - Export fails later

2. **FFmpeg log parsing miss**
   - `isHevcCodec()` looks for 'hevc', 'h265', 'hvc1' in logs
   - If FFmpeg reports codec differently, detection fails
   - Rare but possible with unusual containers

3. **Segment created from transcoded video that still has issues**
   - If transcoding was interrupted or corrupted
   - Segment might be malformed but not HEVC

---

## Affected Code Paths

| File | Location | Issue |
|------|----------|-------|
| `video-frame-pipeline.ts` | Lines 109-117 | FFmpeg exit code not checked |
| `video-frame-pipeline.ts` | Lines 129-134 | Generic error message hides root cause |
| `streaming-processor.ts` | Line 148 | Segments preserve original codec |
| `ffmpeg-client.ts` | Lines 355-361 | `-c copy` preserves HEVC in segments |

---

## What Needs to Change (Conceptual)

### 1. Add Exit Code Validation (Priority: High)

Check FFmpeg's exit code after frame extraction. If non-zero, capture logs and throw descriptive error:

```javascript
const exitCode = await this.ffmpeg.exec([...])
if (exitCode !== 0) {
  throw new Error(`FFmpeg frame extraction failed with exit code ${exitCode}`)
}
```

### 2. Add Diagnostic Logging (Priority: Medium)

Capture FFmpeg stderr during frame extraction to help debug failures:

```javascript
let logs = ''
this.ffmpeg.on('log', ({ message }) => logs += message + '\n')
// ... exec() ...
if (exitCode !== 0) {
  console.error('[VideoFramePipeline] FFmpeg logs:', logs)
}
```

### 3. Consider Re-Checking Segment Codec (Priority: Low)

After segment extraction in `streaming-processor.ts`, re-run HEVC check on the segment blob. If HEVC, either:
- Auto-transcode segment (slow but seamless)
- Mark segment as needing transcoding before export

### 4. Improve Error Messages (Priority: Medium)

Replace generic "no frames" error with specific guidance:

- "FFmpeg failed to decode video (exit code X). The video may use HEVC codec which is not supported."
- Include link to transcode option or retry button

---

## Related Documentation

- **Bug report:** `docs/bugs/bug-frame-extraction-no-frames.md`
- **Implementation plan:** `docs/implementation-plans/2026-02-01-frame-extraction-fix.md`
- **HEVC transcoding modal:** `apps/browser/src/components/HevcTranscodeModal.tsx`

---

## Test Verification

Existing tests in `apps/browser/src/lib/video-frame-pipeline.test.ts` cover:
- HEVC detection and `HevcExportError` throwing (lines 316-403)
- Progress updates during extraction (lines 159-237)
- 100% progress reporting (lines 239-314)

Missing tests (noted in implementation plan):
- Exit code handling for frame extraction
- Diagnostic logging on failure
- Exit code handling for video encoding

---

## Summary Table

| Component | Responsibility | Issue |
|-----------|---------------|-------|
| `VideoDropzone` | HEVC detection at upload | Works, but user can skip transcoding |
| `streaming-processor` | Segment extraction | Uses `-c copy`, preserves HEVC |
| `ffmpeg-client.isHevcCodec` | HEVC detection | Works but can miss edge cases |
| `video-frame-pipeline.exportWithTracer` | Frame extraction + encoding | Missing exit code check, generic errors |
| `ClipReview` | Export orchestration | Catches `HevcExportError`, shows modal |

The fix should focus on `video-frame-pipeline.ts` to add exit code validation and diagnostic logging, as documented in the implementation plan.
