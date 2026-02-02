# Bug: Export with Tracer Hangs in VideoFramePipeline

**Status:** Fixed
**Priority:** P1
**Component:** video-frame-pipeline.ts, ffmpeg-client.ts
**Date:** 2026-02-02
**Fixed:** 2026-02-02

## Description

When exporting a clip with a tracer overlay, the export hangs indefinitely after calling `pipeline.exportWithTracer()`. The modal shows "Exporting Clips" with "Clip 1 of 1" but no progress percentage or phase information.

## Root Cause

The `isHevcCodec()` function in `ffmpeg-client.ts` was called at the start of `exportWithTracer()` to check if the video uses HEVC codec. This function:

1. Calls `fetchFile(videoBlob)` - converts entire blob to Uint8Array (blocking for large files)
2. Calls `ffmpeg.writeFile()` - writes entire video to WASM memory (can exhaust memory or hang)
3. Runs `ffmpeg.exec()` probe command

For large iPhone videos (500MB+), this caused indefinite hangs because FFmpeg WASM couldn't handle writing such large blobs to memory.

**The HEVC check was redundant** because HEVC is already detected during upload via `detectVideoCodec()` in `VideoDropzone.tsx`, which uses the browser's native video element (fast, no memory issues).

## Fix Applied

1. **Removed redundant `isHevcCodec()` call** from `video-frame-pipeline.ts:85`
   - HEVC is already detected during upload
   - If HEVC somehow reaches export, frame extraction will fail with clear error

2. **Added 10-second timeout to `isHevcCodec()`** in `ffmpeg-client.ts` as safety net
   - Prevents hangs if function is called elsewhere
   - Returns `false` on timeout (allows export to proceed, fails at frame extraction if truly HEVC)
   - Added deprecation warning recommending `detectVideoCodec()` instead

3. **Updated tests** to remove obsolete HEVC detection tests from pipeline

## Files Modified

- `apps/browser/src/lib/video-frame-pipeline.ts` - Removed isHevcCodec() call
- `apps/browser/src/lib/ffmpeg-client.ts` - Added timeout safety net
- `apps/browser/src/lib/video-frame-pipeline.test.ts` - Removed obsolete tests

## Verification

- Build passes: `npm run build`
- Pipeline tests pass: 12/12 tests in video-frame-pipeline.test.ts
- Local E2E testing: pending

## Related

- Implementation plan: `docs/implementation-plans/2026-02-02-export-hang-fix.md`
- Session handoff: `docs/session-handoffs/2026-02-02-e2e-debugging-plan.md`
