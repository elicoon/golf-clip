# Implementation Plan: Fix Export Tracer Pipeline Hang

**Date:** 2026-02-02
**Status:** Ready for Implementation
**Bug:** bug-export-tracer-pipeline-hang.md

## Summary

Remove the redundant `isHevcCodec()` check from `exportWithTracer()` that causes hangs on large video files.

## Root Cause

In `apps/browser/src/lib/video-frame-pipeline.ts` line 85:
```typescript
const isHevc = await isHevcCodec(videoBlob)
```

This calls `isHevcCodec()` which writes the ENTIRE video blob to FFmpeg WASM memory:
1. `fetchFile(videoBlob)` - converts entire blob to Uint8Array (blocks for large files)
2. `ffmpeg.writeFile()` - writes to WASM memory (can exhaust memory or hang)
3. `ffmpeg.exec()` - runs probe on entire file

For large iPhone videos (500MB+), this is extremely slow or hangs indefinitely.

## Why This Check is Redundant

HEVC detection already happens during upload in `VideoDropzone.tsx:59`:
```typescript
const codecInfo = await detectVideoCodec(file)
```

The `detectVideoCodec()` function uses the browser's native video element (no FFmpeg) to detect HEVC. If HEVC is detected, the user is prompted to transcode BEFORE processing begins.

Therefore, if a video reaches the export stage, it has already passed HEVC validation.

## Implementation Steps

### Step 1: Remove isHevcCodec check from exportWithTracer

**File:** `apps/browser/src/lib/video-frame-pipeline.ts`

**Change:** Remove lines 82-89:
```typescript
// REMOVE THIS BLOCK:
// Check for HEVC codec before attempting frame extraction
// FFmpeg WASM cannot decode HEVC, so we need to fail fast with a clear error
console.log('[Pipeline] Checking HEVC codec...')
const isHevc = await isHevcCodec(videoBlob)
console.log('[Pipeline] isHevc:', isHevc)
if (isHevc) {
  throw new HevcExportError()
}
```

Also remove the import for `isHevcCodec`:
```typescript
// Change this:
import { isHevcCodec } from './ffmpeg-client'
// To remove it entirely (if not used elsewhere)
```

### Step 2: Keep HevcExportError for safety

The `HevcExportError` class and its handling in `ClipReview.tsx` should remain. If FFmpeg encounters an HEVC file that somehow slipped through, it will fail during frame extraction. The error handling will catch this and show the transcode modal.

### Step 3: Update isHevcCodec with timeout (optional safety net)

**File:** `apps/browser/src/lib/ffmpeg-client.ts`

Add a timeout to `isHevcCodec()` so if it's ever called again, it won't hang:

```typescript
export async function isHevcCodec(videoBlob: Blob): Promise<boolean> {
  // Add timeout to prevent hangs on large files
  const TIMEOUT_MS = 10000; // 10 seconds

  const timeoutPromise = new Promise<boolean>((_, reject) => {
    setTimeout(() => reject(new Error('HEVC check timed out')), TIMEOUT_MS)
  });

  const checkPromise = async (): Promise<boolean> => {
    // ... existing implementation
  };

  try {
    return await Promise.race([checkPromise(), timeoutPromise]);
  } catch (error) {
    console.warn('[isHevcCodec] Check failed or timed out, assuming non-HEVC:', error);
    return false; // Assume non-HEVC on timeout, let frame extraction fail if it is HEVC
  }
}
```

### Step 4: Clean up debug logging

Remove temporary debug logging added during investigation:
- `console.log('[Pipeline] exportWithTracer called')`
- `console.log('[Pipeline] Config:', ...)`
- `console.log('[Pipeline] Checking HEVC codec...')`
- etc.

Keep error logging.

## Verification Steps

1. **Build passes:** `cd apps/browser && npm run build`
2. **Tests pass:** `cd apps/browser && npm run test`
3. **Manual test:** Upload large video, approve shot, export with tracer
4. **Expected:** Export completes without hanging, progress bar shows phases

## Rollback Plan

If issues occur, restore the `isHevcCodec()` check but add a 5-second timeout with fallback to false.

## Files Modified

- `apps/browser/src/lib/video-frame-pipeline.ts` - Remove HEVC check
- `apps/browser/src/lib/ffmpeg-client.ts` - Optional: add timeout to isHevcCodec
