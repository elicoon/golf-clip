# Bug: Export Hangs at Various Stages

**Status:** Fixed
**Priority:** P1
**Component:** Export Pipeline (video-frame-pipeline.ts, ClipReview.tsx)
**Date:** 2026-01-31
**Fixed:** 2026-02-01

## Description

Export process can hang at different stages without completing. Two observed failure modes:

## Issue 1: Stuck at 0% (Extracting Phase)

Export hangs at "extracting 0%" indefinitely. Frame extraction fails silently.

**Symptoms:**
- Progress shows "extracting 0%" repeatedly in console
- Network activity shows blob requests working (206 responses)
- Never advances beyond 0%
- Export never completes or fails - just hangs

**Suspected cause:** Frame extraction either fails silently or progress callback is not being invoked during extraction phase.

## Issue 2: Stuck at 99% (Final Phase)

Export progresses normally but stops at 99% and never completes.

**Symptoms:**
- Progress advances normally through phases
- Reaches 99% and stays there forever
- No download triggered

**Suspected cause:**
- FFmpeg.wasm progress callback not firing final 100% event
- Progress calculation rounding issue (99.5% showing as 99%)
- Final write/download step not updating progress
- Export may actually complete but UI doesn't reflect it

## Reproduction Steps

1. Load a video (e.g., IMG_3940.MOV)
2. Wait for shot detection
3. Approve a shot with trajectory
4. Click "Export 1 Clip"
5. Observe progress - may hang at 0% or 99%

## Technical Notes

**Files to investigate:**
- `apps/browser/src/lib/video-frame-pipeline.ts` - `extractFrames()`, progress handlers
- `apps/browser/src/lib/canvas-compositor.ts` - Compositing logic
- `apps/browser/src/components/ClipReview.tsx` - Export function, progress callback wiring

**Next steps:**
1. Add console logging to trace execution through frame extraction
2. Verify segment blob contains valid data before export
3. Check if progress callback is properly wired
4. Test with smaller/simpler video file
5. Check if export actually completes despite showing 99%

## Files

- `apps/browser/src/lib/video-frame-pipeline.ts`
- `apps/browser/src/lib/canvas-compositor.ts`
- `apps/browser/src/components/ClipReview.tsx`

## Fix Details

### Commit 33e64c4 - Initial Fix
Auto-close behavior added to handle the common 99% hang scenario. When the export reaches a high progress percentage and the underlying operation completes, the modal now auto-closes rather than remaining stuck at 99%.

### Commit c0068b1 - Edge Case Fixes
Comprehensive fix for remaining edge cases:

1. **0% Extraction Hang Fixed** - Added fallback interval timer that emits progress every 1s during extraction when FFmpeg.wasm doesn't emit events (image2 format limitation)
2. **Indeterminate State** - Extraction now starts at -1 (indeterminate) with animated progress bar, rather than misleading 0%
3. **Defensive Timeout** - Added 10-second timeout in finally block to force-close stuck modal if exception occurs after downloads
4. **CSS Animation** - Added indeterminate progress bar animation for extraction phase

### Tests Added
- `video-frame-pipeline.test.ts` - 229 new lines testing progress fallback and 100% completion
- `ClipReview.export.test.tsx` - 22 tests covering modal visibility, auto-close, error states

## Verification

All 137 tests pass:
- VideoFramePipeline: 23 tests ✓
- ClipReview.export: 22 tests ✓
- ClipReview.layout: 27 tests ✓
- Scrubber: 41 tests ✓
