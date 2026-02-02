# Export Hangs Bug Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two export hang scenarios: stuck at 0% during extraction (no progress events from FFmpeg.wasm for image2 format) and stuck at 99% during cleanup (completion callback fires after blocking cleanup loop).

**Architecture:** The VideoFramePipeline exports videos with tracer overlays through three phases: extraction, compositing, and encoding. The 0% hang occurs because FFmpeg.wasm doesn't emit progress events for `image2` format during frame extraction. The 99% hang occurs because the `cleanup()` call blocks before the `complete` progress callback fires. The fix moves the completion callback before cleanup and shows "extracting..." as indeterminate progress instead of relying on FFmpeg events.

**Tech Stack:** TypeScript, FFmpeg.wasm, Vitest

---

## Files Overview

| File | Purpose |
|------|---------|
| `apps/browser/src/lib/video-frame-pipeline.ts` | Main export pipeline - contains both bugs |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | Unit tests (existing tests for this bug) |

---

## Task 1: Fix 99% Hang - Move Completion Before Cleanup

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:221-228`

This is the quick win - swap lines 224 and 226 so completion is reported before cleanup starts.

**Step 1: Read the result before cleanup and report completion first**

In `video-frame-pipeline.ts`, find this code block (around lines 221-228):

```typescript
    const result = await this.ffmpeg.readFile(outputName)

    // Cleanup
    await this.cleanup(inputName, outputName, totalFrames)

    onProgress?.({ phase: 'complete', progress: 100 })

    return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
```

Replace with:

```typescript
    const result = await this.ffmpeg.readFile(outputName)

    // Report completion BEFORE cleanup to avoid 99% hang
    // Cleanup can be slow with many frames - user shouldn't wait for it
    onProgress?.({ phase: 'complete', progress: 100 })

    // Cleanup (non-blocking for user perception)
    await this.cleanup(inputName, outputName, totalFrames)

    return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
```

**Step 2: Run existing tests to verify the fix**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: Tests in "Issue 2: Export hangs at 99%" should pass, specifically:
- `should report 100% complete BEFORE starting cleanup`
- `should not cap progress at 99% - must reach 100%`
- `should complete the full phase sequence`

**Step 3: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts
git commit -m "fix(export): report completion before cleanup to prevent 99% hang

Move onProgress({ phase: 'complete' }) before cleanup() call so users
see 100% immediately after encoding finishes. Cleanup can be slow when
many frames need deletion."
```

---

## Task 2: Fix 0% Hang - Remove Unreliable Extraction Progress

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:86-99`

FFmpeg.wasm doesn't emit progress events for `image2` format, so the progress listener never fires during extraction. Instead of showing 0% forever, we'll report a single "extracting..." state and only update to 100% when frames are verified.

**Step 1: Simplify extraction phase progress reporting**

Find this code block (around lines 86-99):

```typescript
    // Phase 1: Extract frames from video
    onProgress?.({ phase: 'extracting', progress: 0 })

    const inputName = 'input.mp4'
    const framePattern = 'frame_%04d.png'

    await this.ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Set up progress listener for extraction phase
    const extractionProgressHandler = ({ progress }: { progress: number }) => {
      // FFmpeg reports progress as 0-1 ratio
      const percent = Math.round(progress * 100)
      onProgress?.({ phase: 'extracting', progress: Math.min(percent, 99) })
    }
    this.ffmpeg.on('progress', extractionProgressHandler)
```

Replace with:

```typescript
    // Phase 1: Extract frames from video
    // NOTE: FFmpeg.wasm doesn't emit progress events for image2 format,
    // so we report -1 as "indeterminate" progress. The UI should show
    // "Extracting..." without a percentage bar.
    onProgress?.({ phase: 'extracting', progress: -1 })

    const inputName = 'input.mp4'
    const framePattern = 'frame_%04d.png'

    await this.ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // NOTE: We intentionally don't set up a progress listener for extraction
    // because FFmpeg.wasm doesn't emit events for image2 format. The old
    // listener would show 0% forever, causing a perceived "hang."
```

**Step 2: Remove the extraction progress listener cleanup**

Find this code block (around lines 112-119):

```typescript
    } catch (error) {
      this.ffmpeg.off('progress', extractionProgressHandler)
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
      console.error('[VideoFramePipeline] Frame extraction failed:', message)
      throw new Error(`Frame extraction failed: ${message}`)
    }

    // Clean up extraction progress listener
    this.ffmpeg.off('progress', extractionProgressHandler)
```

Replace with:

```typescript
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
      console.error('[VideoFramePipeline] Frame extraction failed:', message)
      throw new Error(`Frame extraction failed: ${message}`)
    }
```

**Step 3: Update the ExportProgress interface to document indeterminate progress**

Find the ExportProgress interface (around lines 18-23):

```typescript
export interface ExportProgress {
  phase: 'extracting' | 'compositing' | 'encoding' | 'complete'
  progress: number  // 0-100
  currentFrame?: number
  totalFrames?: number
}
```

Replace with:

```typescript
export interface ExportProgress {
  phase: 'extracting' | 'compositing' | 'encoding' | 'complete'
  progress: number  // 0-100, or -1 for indeterminate (extracting phase)
  currentFrame?: number
  totalFrames?: number
}
```

**Step 4: Run tests to verify**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: Some tests in "Issue 1: Export hangs at 0%" may need updates since we changed the progress behavior. Check test output.

**Step 5: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts
git commit -m "fix(export): use indeterminate progress for extraction phase

FFmpeg.wasm doesn't emit progress events for image2 format, causing the
UI to show 0% forever during extraction. Changed to report progress=-1
(indeterminate) so UI can show 'Extracting...' without a percentage."
```

---

## Task 3: Update Tests for New Indeterminate Progress Behavior

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.test.ts:403-505`

The existing tests expect intermediate progress values during extraction. Since we now report -1 (indeterminate), we need to update these tests.

**Step 1: Update test expectations for indeterminate progress**

Find the test `should report extraction progress even when FFmpeg emits no progress events` (around line 404) and update it:

```typescript
    it('should report extraction progress even when FFmpeg emits no progress events', async () => {
      const { isHevcCodec } = await import('./ffmpeg-client')
      vi.mocked(isHevcCodec).mockResolvedValue(false)

      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpegWithBugs({ emitExtractionProgress: false })
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const progressUpdates: { phase: string; progress: number }[] = []

      await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 10,
        tracerStyle: defaultTracerStyle,
        onProgress: (p) => progressUpdates.push({ phase: p.phase, progress: p.progress }),
      })

      // The extraction phase should use indeterminate progress (-1) then reach 100%
      const extractionUpdates = progressUpdates.filter(p => p.phase === 'extracting')
      expect(extractionUpdates.length).toBeGreaterThan(0)

      // Should have indeterminate progress (-1) at start
      expect(extractionUpdates.some(p => p.progress === -1)).toBe(true)

      // Extraction must report 100% completion before moving to compositing
      const extractionComplete = extractionUpdates.some(p => p.progress === 100)
      expect(extractionComplete).toBe(true)
    })
```

**Step 2: Update the intermediate progress test**

Find `should show intermediate extraction progress when FFmpeg emits no events` (around line 433) and update it:

```typescript
    it('should use indeterminate progress when FFmpeg emits no events (fix for UI hang)', async () => {
      /**
       * FIXED BEHAVIOR: When FFmpeg.wasm doesn't emit progress events for image2 format,
       * we report -1 (indeterminate) so the UI shows "Extracting..." without a percentage.
       * This prevents the perceived "hang" at 0%.
       */
      const { isHevcCodec } = await import('./ffmpeg-client')
      vi.mocked(isHevcCodec).mockResolvedValue(false)

      const { VideoFramePipeline } = await import('./video-frame-pipeline')
      const mockFFmpeg = createMockFFmpegWithBugs({ emitExtractionProgress: false })
      const pipeline = new VideoFramePipeline(mockFFmpeg as any)

      const extractionProgressValues: number[] = []

      await pipeline.exportWithTracer({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 10,
        tracerStyle: defaultTracerStyle,
        onProgress: (p) => {
          if (p.phase === 'extracting') {
            extractionProgressValues.push(p.progress)
          }
        },
      })

      // FIXED: Should have -1 (indeterminate) at start, then 100% when complete
      expect(extractionProgressValues).toContain(-1)
      expect(extractionProgressValues).toContain(100)
    })
```

**Step 3: Update the test that expects specific FFmpeg progress values**

Find `should correctly report extraction progress when FFmpeg does emit events` (around line 477) and remove or skip it since we no longer listen for extraction progress:

```typescript
    it.skip('should correctly report extraction progress when FFmpeg does emit events', async () => {
      // This test is no longer applicable - we don't listen for extraction progress
      // because FFmpeg.wasm doesn't reliably emit events for image2 format
    })
```

**Step 4: Run tests to verify**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: All tests should pass.

**Step 5: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.test.ts
git commit -m "test(export): update tests for indeterminate extraction progress

Update test expectations to match new behavior where extraction phase
reports -1 (indeterminate) instead of trying to show FFmpeg progress
that never arrives."
```

---

## Task 4: Update UI to Handle Indeterminate Progress

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx` (find progress display)

The UI needs to handle `progress === -1` by showing "Extracting..." without a percentage.

**Step 1: Find the progress display in ClipReview.tsx**

Search for where export progress is displayed. Look for references to `exportProgress` or `progress.phase`.

**Step 2: Update progress display to handle indeterminate state**

Where the progress percentage is shown, add a check for -1:

```typescript
// Before (example - actual code may differ):
{progress.phase === 'extracting' && `Extracting: ${progress.progress}%`}

// After:
{progress.phase === 'extracting' && (
  progress.progress === -1
    ? 'Extracting frames...'
    : `Extracting: ${progress.progress}%`
)}
```

**Step 3: Verify in browser**

Run: `cd apps/browser && npm run dev`

1. Open http://localhost:5173
2. Load a test video
3. Approve a shot and click Export
4. Observe: Should show "Extracting frames..." (not "Extracting: 0%")
5. After extraction completes, should progress normally through compositing and encoding
6. Should reach 100% and trigger download (not hang at 99%)

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "fix(ui): show 'Extracting frames...' for indeterminate progress

Handle progress=-1 in export progress display to show a friendlier
message instead of 'Extracting: 0%' which looks like a hang."
```

---

## Task 5: Manual Verification

**Files:**
- None (manual testing only)

**Step 1: Test with a real video file**

1. Start dev server: `cd apps/browser && npm run dev`
2. Open http://localhost:5173
3. Load a golf video (non-HEVC)
4. Wait for shot detection
5. Approve a shot with trajectory
6. Click "Export 1 Clip"

**Step 2: Verify extraction phase**

Expected:
- Shows "Extracting frames..." (NOT "Extracting: 0%")
- Does NOT hang at 0%
- Transitions to compositing phase

**Step 3: Verify completion**

Expected:
- Progress reaches 100%
- Does NOT hang at 99%
- Download triggers automatically
- Exported video plays correctly

**Step 4: Document results**

Create test evidence in `docs/test-evidence/2026-02-01-export-hangs-fix/`:
- Screenshot of "Extracting frames..." state
- Screenshot of 100% completion
- Note any issues found

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Fix 99% hang - move completion before cleanup | 5 min |
| 2 | Fix 0% hang - use indeterminate progress | 10 min |
| 3 | Update tests for new behavior | 10 min |
| 4 | Update UI for indeterminate progress | 10 min |
| 5 | Manual verification | 15 min |

**Total estimated time:** ~50 minutes

**Acceptance criteria:**
1. Export no longer hangs at 0% (shows "Extracting frames..." instead)
2. Export no longer hangs at 99% (completion reported before cleanup)
3. All existing tests pass (with updates for new behavior)
4. Manual test confirms export works end-to-end
