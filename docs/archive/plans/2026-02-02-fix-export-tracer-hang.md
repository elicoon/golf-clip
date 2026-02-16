# Fix Export Tracer Hang Bug - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the redundant `isHevcCodec()` check from the export pipeline that hangs on large video blobs.

**Architecture:** The `isHevcCodec()` function reads the ENTIRE video blob into WASM memory to probe the codec. This is redundant because `detectVideoCodec()` already checks for HEVC during upload in `VideoDropzone.tsx` - any HEVC video would have been rejected or transcoded before reaching export. The fix removes the proactive check while keeping the `HevcExportError` class for edge case handling.

**Tech Stack:** TypeScript, Vitest, FFmpeg WASM

---

## Background

### Root Cause Analysis

In `apps/browser/src/lib/video-frame-pipeline.ts` line 85:
```typescript
const isHevc = await isHevcCodec(videoBlob)
```

This calls `isHevcCodec()` in `ffmpeg-client.ts` which:
1. `await fetchFile(videoBlob)` - converts entire blob to Uint8Array (blocks for large files ~500MB+)
2. `await ffmpeg.writeFile()` - writes to WASM memory (can exhaust memory)
3. `await ffmpeg.exec()` - runs probe on entire file

### Why This Check is Redundant

The HEVC detection flow already happens during video upload:
1. User drops video file in `VideoDropzone.tsx`
2. `detectVideoCodec(file)` is called (line 59 in `processFileInBackground()`)
3. If HEVC is detected, the `HevcTranscodeModal` appears
4. User either transcodes to H.264 or cancels

By the time export is called, the video has ALREADY been validated as H.264-compatible.

### Files Involved

| File | Purpose |
|------|---------|
| `apps/browser/src/lib/video-frame-pipeline.ts` | Contains the redundant `isHevcCodec()` call |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | Has tests that mock `isHevcCodec()` |
| `apps/browser/src/lib/ffmpeg-client.ts` | Defines `isHevcCodec()` function (keep, used elsewhere) |

---

## Task 1: Remove isHevcCodec Import and Call

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:5` (import line)
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:82-89` (check block)

**Step 1: Read the current file**

Verify current state of the file before editing.

**Step 2: Remove the import**

Change line 5 from:
```typescript
import { isHevcCodec } from './ffmpeg-client'
```

To:
```typescript
// isHevcCodec import removed - HEVC check happens during upload in VideoDropzone
```

**Step 3: Remove the HEVC check block**

Replace lines 82-89:
```typescript
    // Check for HEVC codec before attempting frame extraction
    // FFmpeg WASM cannot decode HEVC, so we need to fail fast with a clear error
    console.log('[Pipeline] Checking HEVC codec...')
    const isHevc = await isHevcCodec(videoBlob)
    console.log('[Pipeline] isHevc:', isHevc)
    if (isHevc) {
      throw new HevcExportError()
    }
```

With a comment explaining why the check was removed:
```typescript
    // NOTE: HEVC codec check removed - it was causing hangs on large files by reading
    // the entire blob into WASM memory. HEVC detection already happens during upload
    // in VideoDropzone.tsx via detectVideoCodec(). If an HEVC video somehow reaches
    // this point, the FFmpeg frame extraction will fail and throw a descriptive error.
```

**Step 4: Verify build compiles**

Run: `cd c:/Users/Eli/projects/golf-clip/apps/browser && npm run build`
Expected: Build succeeds with no TypeScript errors

**Step 5: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts
git commit -m "$(cat <<'EOF'
fix: remove redundant isHevcCodec check that hangs on large files

The isHevcCodec() call was reading the entire video blob into WASM
memory, causing hangs on large files (500MB+). This check is redundant
because HEVC detection already happens during upload in VideoDropzone
via detectVideoCodec().

Fixes: export tracer pipeline hang bug

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update Tests to Remove isHevcCodec Mocking

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.test.ts`

The existing tests mock `isHevcCodec` because it was being called. Since we removed the call, we need to:
1. Remove the mock setup (lines 5-11)
2. Update tests that explicitly test HEVC behavior through `isHevcCodec`

**Step 1: Remove the isHevcCodec mock setup**

Delete lines 5-11:
```typescript
// Mock ffmpeg-client module
vi.mock('./ffmpeg-client', async () => {
  const actual = await vi.importActual('./ffmpeg-client')
  return {
    ...actual,
    isHevcCodec: vi.fn(),
  }
})
```

**Step 2: Remove isHevcCodec imports from tests**

Search for and remove all instances of:
```typescript
const { isHevcCodec } = await import('./ffmpeg-client')
vi.mocked(isHevcCodec).mockResolvedValue(false)
```

These appear in multiple test blocks:
- Line 170-171 (extraction progress fallback)
- Line 246-247 (100% progress)
- Line 323-327 (HEVC detection - entire test needs rework)
- Line 363-369 (proceed when not HEVC)
- Line 444-447 (FFmpeg exit code handling)
- Line 490-493 (exit code value)
- Line 540-543 (succeed with exit code 0)
- Line 596-599 (exit code for extraction)
- Line 660-663 (HevcExportError catchable - remove entire test)
- Line 709-712 (detect HEVC before extraction - remove entire test)
- Line 781-783 (diagnostic logging)
- Line 843-844 (cleanup log listeners)

**Step 3: Remove HEVC-specific test blocks**

Delete the following test blocks entirely since they test behavior that no longer exists:

1. **Delete `describe('VideoFramePipeline HEVC detection')`** (lines 317-405)
   - Tests `isHevcCodec` being called, which no longer happens

2. **Delete `describe('VideoFramePipeline HEVC codec integration')`** (lines 650-746)
   - Tests HEVC detection happening before frame extraction, which no longer happens

**Step 4: Keep HevcExportError class tests**

The `HevcExportError` class should still exist (for potential edge cases or future use). But we don't test it being thrown from `exportWithTracer` anymore since that code path is removed.

**Step 5: Run tests to verify**

Run: `cd c:/Users/Eli/projects/golf-clip/apps/browser && npm run test`
Expected: All remaining tests pass

**Step 6: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.test.ts
git commit -m "$(cat <<'EOF'
test: remove isHevcCodec mocking after removing the call

Removes mocks and tests for isHevcCodec in video-frame-pipeline since
the actual call was removed. HEVC detection now happens only during
upload, not during export.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update Bug Documentation

**Files:**
- Modify: `docs/bugs/bug-export-tracer-pipeline-hang.md`

**Step 1: Update bug status to Fixed**

Change the header section:
```markdown
**Status:** Fixed
**Resolution:** Removed redundant isHevcCodec() call
**Fixed Date:** 2026-02-02
```

**Step 2: Add resolution section**

Add after "Next Steps":
```markdown
## Resolution

The hang was caused by `isHevcCodec()` reading the entire video blob into WASM memory. For large files (500MB+), this operation blocks indefinitely.

**Root Cause:** `isHevcCodec()` in `ffmpeg-client.ts` uses `fetchFile(videoBlob)` which converts the entire blob to a Uint8Array, then writes it to WASM filesystem. This is slow and memory-intensive.

**Fix:** Removed the `isHevcCodec()` call from `exportWithTracer()` in `video-frame-pipeline.ts`. This check was redundant because:
1. HEVC detection already happens during upload via `detectVideoCodec()` in `VideoDropzone.tsx`
2. Any HEVC video would have been rejected or transcoded before reaching export
3. If an HEVC video somehow reaches export, FFmpeg will fail with a clear error during frame extraction

**Files Changed:**
- `apps/browser/src/lib/video-frame-pipeline.ts` - Removed isHevcCodec import and call
- `apps/browser/src/lib/video-frame-pipeline.test.ts` - Removed related mocks and tests
```

**Step 3: Commit**

```bash
git add docs/bugs/bug-export-tracer-pipeline-hang.md
git commit -m "$(cat <<'EOF'
docs: mark export tracer hang bug as fixed

Documented the root cause (isHevcCodec reading entire blob) and
resolution (removing the redundant check).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Manual Verification (No Code Changes)

**Step 1: Run the full test suite**

Run: `cd c:/Users/Eli/projects/golf-clip/apps/browser && npm run test`
Expected: All tests pass

**Step 2: Start dev server and test manually**

Run: `cd c:/Users/Eli/projects/golf-clip/apps/browser && npm run dev`

Manual test steps:
1. Open browser to localhost URL
2. Upload a known H.264 video file (large file preferred, 500MB+)
3. Wait for shot detection to complete
4. Mark at least one shot with landing point
5. Generate trajectory
6. Click export with tracer enabled
7. **Verify:** Export should proceed immediately without hanging
8. **Verify:** Progress bar shows "extracting" phase within a few seconds

**Step 3: Document test results**

If verification passes, the bug fix is complete.

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Remove isHevcCodec import and call | 5 min |
| 2 | Update tests to remove mocking | 10 min |
| 3 | Update bug documentation | 5 min |
| 4 | Manual verification | 5 min |

**Total:** ~25 minutes

**Risk Assessment:** Low - The change removes code rather than adding complexity. The HEVC detection is already happening at upload time, so this is purely removing redundant work.
