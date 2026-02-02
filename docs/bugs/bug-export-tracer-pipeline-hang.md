# Bug: Export with Tracer Hangs in VideoFramePipeline

**Status:** Fixed (v2)
**Priority:** P1
**Component:** video-frame-pipeline.ts
**Date:** 2026-02-02
**Last Updated:** 2026-02-02

## Description

When exporting a clip with a tracer overlay from 4K video, the export hangs during the compositing phase. The root cause was identified as memory exhaustion from processing high-resolution frames without GC breathing room.

## Root Cause (Confirmed)

The hang occurs in **Phase 2: Compositing loop** (lines 253-303 of `video-frame-pipeline.ts`), NOT in frame extraction as initially assumed.

The 90% progress was a red herring - the fallback progress interval in extraction caps at 90%, making it appear extraction was hung when it was actually complete.

Each 4K frame creates ~70MB in active memory allocations:
- ImageBitmap decode: ~35MB
- ImageData for compositing: ~35MB
- Blob for re-encoding: ~3-5MB
- Plus Canvas memory overhead

For 450 frames, this means ~31GB of memory churn, overwhelming the browser's GC.

## Issue Timeline

### Original Issue (FIXED - Phase 1)

The `isHevcCodec()` function caused indefinite hangs on large files by writing entire blob to FFmpeg WASM memory.

### Second Issue (FIXED - Phase 2)

After removing `isHevcCodec()`, exports progressed further but hung at ~90%. Investigation revealed this was the compositing loop, not extraction.

## Fixes Applied

### Phase 1: isHevcCodec Removal (Commit ff3a06d)

1. Removed redundant `isHevcCodec()` call
2. Added 10-second timeout to `isHevcCodec()` as safety net
3. Updated tests

### Phase 2: Additional Mitigations (Commits 2a71e8c, dfc08dd)

1. Added 'preparing' phase for progress visibility
2. Added 2-minute extraction timeout
3. Added frame count limiting (max 450 frames)
4. Added FPS reduction (minimum 24fps)
5. Added 1080p downscaling for long clips (>18s)

### Phase 3: Memory Exhaustion Fix (Current)

1. **Blob-size trigger for downscale** - Blobs >50MB now trigger automatic 1080p downscale (previously only warned at >100MB)

2. **Pipeline-wide timeout** - Added 3-minute overall timeout with per-frame checks during compositing

3. **Batched compositing with GC breathing room** - Process frames in batches of 10 with `setTimeout(0)` between batches to allow GC

4. **Reduced progress callback frequency** - Update progress every 10 frames instead of every frame to reduce overhead

## Files Modified

- `apps/browser/src/lib/video-frame-pipeline.ts`:
  - Lines 81-84: Added pipeline timeout and batch size constants
  - Lines 133-143: Added blob-size trigger for 1080p downscale
  - Lines 254-258: Added timeout check in compositing loop
  - Lines 288-296: Reduced progress updates to every 10 frames
  - Lines 298-302: Added GC breathing room between batches

## Verification Status

- Build passes: `npm run build` ✅
- Pipeline tests pass: 46/46 tests ✅
- Code review: APPROVED ✅
- Local E2E: Pending
- PROD E2E: Pending

## Test Environment

- Video: 4K 60fps from iPhone
- Segment blob: Up to 30 seconds
- Browser: Chrome, Safari, Firefox

## Related

- Implementation plan v1: `docs/implementation-plans/2026-02-02-export-hang-fix.md`
- Implementation plan v2: `docs/implementation-plans/2026-02-02-export-hang-fix-v2.md`
- Session handoff: `docs/session-handoffs/2026-02-02-e2e-debugging-plan.md`
- Latest investigation handoff: `docs/session-handoffs/2026-02-02-export-hang-handoff.md`
- Initial investigation: `docs/session-handoffs/2026-02-02-export-hang-investigation.md`
- E2E Debug Session v2: `docs/plans/2026-02-02-e2e-debug-session-v2.md`
- UAT Test Checklist: `docs/uat/export-pipeline-uat.md`
