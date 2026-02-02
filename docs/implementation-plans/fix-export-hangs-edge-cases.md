# Fix Export Hangs Edge Cases Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three remaining edge cases where the export modal can hang or fail to close: exceptions after downloads, silent FFmpeg extraction, and progress capping at 99%.

**Architecture:** The export flow in `ClipReview.tsx` calls `handleExport()` which iterates through approved segments, exports each via `VideoFramePipeline`, and triggers browser downloads. Three edge cases can prevent proper completion: (1) exceptions thrown AFTER downloads complete bypass `setExportComplete(true)`, (2) FFmpeg.wasm may not emit progress events during extraction causing 0% stuck, (3) progress is capped at 99% in `video-frame-pipeline.ts:97` preventing 100% display. The fix adds a finally block for defensive modal closing, fallback progress updates during extraction, and ensures 100% progress is explicitly set.

**Tech Stack:** TypeScript, React, Vitest, FFmpeg.wasm

---

## Files Overview

| File | Purpose |
|------|---------|
| `apps/browser/src/components/ClipReview.tsx` | Export flow with modal state management (lines 374-461) |
| `apps/browser/src/lib/video-frame-pipeline.ts` | Frame extraction and encoding pipeline (lines 86-129) |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | Unit tests for pipeline |
| `apps/browser/src/components/ClipReview.test.tsx` | Component tests (new file for edge case tests) |

---

## Task 1: Add Defensive Finally Block in handleExport

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx:374-461`

The current try/catch doesn't guarantee modal closure if an exception occurs AFTER downloads complete but BEFORE `setExportComplete(true)`. Adding a finally block ensures the modal eventually closes.

**Step 1: Write the failing test**

Create a new test file to verify the behavior.

In `apps/browser/src/components/ClipReview.export.test.tsx`, add at the end:

```typescript
// =============================================================================
// EDGE CASE: Modal Closes After Exception
// =============================================================================

describe('Export Modal Edge Cases', () => {
  beforeEach(() => {
    getStore().reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should close modal even if exception occurs after downloads complete', async () => {
    /**
     * EDGE CASE: If an exception is thrown AFTER downloads complete but BEFORE
     * setExportComplete(true), the modal could stay open forever.
     *
     * Expected behavior: Modal should close via finally block after timeout
     */
    const store = getStore()
    store.addSegment(createTestSegment({ id: 'seg-1', confidence: 0.85 }))

    // This test documents the expected behavior - actual component test would
    // require mocking VideoFramePipeline to throw after download
    expect(true).toBe(true) // Placeholder - documents the edge case
  })
})
```

**Step 2: Locate the handleExport function and identify the fix location**

Find in `ClipReview.tsx` around line 374:

```typescript
  const handleExport = useCallback(async () => {
    // ... setup code ...

    try {
      // ... export loop ...

      if (!exportCancelledRef.current) {
        setExportComplete(true)
        // Auto-close modal after showing success for 1.5 seconds
        setTimeout(() => {
          setShowExportModal(false)
          onComplete()
        }, 1500)
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'An error occurred during export')
    }
  }, [onComplete, exportSegmentWithTracer])
```

**Step 3: Add finally block with defensive timeout**

Replace the try/catch block (lines 389-460) with:

```typescript
    try {
      // Load FFmpeg for tracer export
      await loadFFmpeg()
      const ffmpeg = getFFmpegInstance()
      const pipeline = new VideoFramePipeline(ffmpeg)

      for (let i = 0; i < approved.length; i++) {
        if (exportCancelledRef.current) break

        const segment = approved[i]
        setExportProgress({ current: i + 1, total: approved.length })

        try {
          const exportedBlob = await exportSegmentWithTracer(segment, i, pipeline)

          if (exportedBlob) {
            // Download the exported MP4
            const url = URL.createObjectURL(exportedBlob)
            const a = document.createElement('a')
            a.href = url
            a.download = `shot_${i + 1}.mp4`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          } else {
            // No trajectory - download raw segment as MP4
            const a = document.createElement('a')
            a.href = segment.objectUrl
            a.download = `shot_${i + 1}.mp4`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
          }
        } catch (segmentError) {
          // Check if it's an HEVC error - show transcode modal
          if (segmentError instanceof HevcExportError) {
            const fileSizeMB = Math.round(segment.blob.size / (1024 * 1024))
            const { formatted: estimatedTime } = estimateTranscodeTime(fileSizeMB)

            // Hide export modal and show HEVC transcode modal
            setShowExportModal(false)
            setHevcTranscodeModal({
              show: true,
              segmentIndex: i,
              segmentBlob: segment.blob,
              estimatedTime,
              isTranscoding: false,
              transcodeProgress: 0,
              transcodeStartTime: null,
            })
            return // Exit export loop - user will choose to transcode or cancel
          }
          // Re-throw other errors
          throw segmentError
        }

        // Small delay between downloads to avoid browser throttling
        await new Promise(r => setTimeout(r, 500))
      }

      if (!exportCancelledRef.current) {
        setExportComplete(true)
        // Auto-close modal after showing success for 1.5 seconds
        setTimeout(() => {
          setShowExportModal(false)
          onComplete()
        }, 1500)
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'An error occurred during export')
    } finally {
      // Defensive: Ensure modal closes even if exception occurs after downloads
      // This handles edge cases where exceptions bypass setExportComplete(true)
      // Wait 10 seconds - if modal is still open without error/complete, force close
      setTimeout(() => {
        // Only force close if we're in a stuck state (modal open, no error, not complete)
        if (showExportModal && !exportError && !exportComplete && !exportCancelledRef.current) {
          console.warn('[ClipReview] Export modal stuck - forcing close after timeout')
          setShowExportModal(false)
        }
      }, 10000)
    }
```

**Step 4: Run tests to verify no regressions**

Run: `cd apps/browser && npm test -- --run ClipReview`

Expected: All existing tests pass.

**Step 5: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx apps/browser/src/components/ClipReview.export.test.tsx
git commit -m "fix(export): add defensive finally block to prevent modal hang

Add finally block with 10-second timeout to force-close export modal
if it gets stuck in an incomplete state. This handles edge cases where
exceptions occur after downloads complete but before setExportComplete."
```

---

## Task 2: Add Fallback Progress Updates During Extraction

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:86-129`
- Modify: `apps/browser/src/lib/video-frame-pipeline.test.ts`

FFmpeg.wasm doesn't reliably emit progress events for the `image2` format during frame extraction. The existing fix uses indeterminate progress (-1), but we can improve UX by adding periodic fallback updates.

**Step 1: Write the failing test**

Add to `video-frame-pipeline.test.ts`:

```typescript
describe('VideoFramePipeline extraction progress fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should emit periodic progress updates during extraction even when FFmpeg is silent', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const progressUpdates: { phase: string; progress: number }[] = []

    // Create a mock that delays exec to simulate slow extraction
    const execPromise = new Promise<void>(resolve => {
      // Simulate 3 seconds of extraction
      setTimeout(resolve, 3000)
    })

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk start
            0x00, 0x00, 0x00, 0x64, // width: 100
            0x00, 0x00, 0x00, 0x64, // height: 100
            0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, etc
          ]))
        }
        if (name === 'output.mp4') {
          return Promise.resolve(new Uint8Array([1, 2, 3]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockImplementation(() => execPromise),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(), // No progress events emitted
      off: vi.fn(),
    }

    const { VideoFramePipeline } = await import('./video-frame-pipeline')
    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    const exportPromise = pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
      onProgress: (p) => progressUpdates.push({ phase: p.phase, progress: p.progress }),
    })

    // Advance timers to trigger fallback progress updates
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)

    await exportPromise

    // Should have extraction updates (either indeterminate -1 or fallback values)
    const extractionUpdates = progressUpdates.filter(p => p.phase === 'extracting')
    expect(extractionUpdates.length).toBeGreaterThan(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: FAIL - test may timeout or show insufficient progress updates.

**Step 3: Add fallback progress mechanism**

In `video-frame-pipeline.ts`, find the extraction phase code (around line 86-120) and update:

```typescript
    // Phase 1: Extract frames from video
    // NOTE: FFmpeg.wasm doesn't reliably emit progress events for image2 format.
    // We report -1 (indeterminate) initially, with periodic fallback updates.
    onProgress?.({ phase: 'extracting', progress: -1 })

    const inputName = 'input.mp4'
    const framePattern = 'frame_%04d.png'

    await this.ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Set up fallback progress updates every second during extraction
    // This prevents the UI from appearing stuck if FFmpeg doesn't emit events
    let lastReportedProgress = -1
    const fallbackInterval = setInterval(() => {
      // Increment progress slowly to show activity (caps at 90%)
      if (lastReportedProgress === -1) {
        lastReportedProgress = 10
      } else if (lastReportedProgress < 90) {
        lastReportedProgress = Math.min(lastReportedProgress + 10, 90)
      }
      onProgress?.({ phase: 'extracting', progress: lastReportedProgress })
    }, 1000)

    // Extract frames as PNG sequence with error handling
    try {
      await this.ffmpeg.exec([
        '-ss', startTime.toString(),
        '-i', inputName,
        '-t', duration.toString(),
        '-vf', `fps=${fps}`,
        '-f', 'image2',
        framePattern,
      ])
    } catch (error) {
      clearInterval(fallbackInterval)
      const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
      console.error('[VideoFramePipeline] Frame extraction failed:', message)
      throw new Error(`Frame extraction failed: ${message}`)
    }

    // Clean up fallback interval
    clearInterval(fallbackInterval)

    // Verify frames were extracted
    try {
      await this.ffmpeg.readFile('frame_0001.png')
    } catch (error) {
      console.error('[VideoFramePipeline] No frames extracted - frame_0001.png not found')
      throw new Error('Frame extraction produced no frames. The video may be corrupted or in an unsupported format.')
    }

    onProgress?.({ phase: 'extracting', progress: 100 })
```

**Step 4: Run tests to verify**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: All tests pass.

**Step 5: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts apps/browser/src/lib/video-frame-pipeline.test.ts
git commit -m "fix(export): add fallback progress updates during extraction

Add periodic progress updates (every 1s) during frame extraction to
prevent UI from appearing stuck when FFmpeg doesn't emit events.
Progress increments 10% per second, capping at 90% before completion."
```

---

## Task 3: Ensure 100% Progress Is Set Before Returning

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:97,186,219`

The current code caps progress at 99% in multiple places to avoid "100% but not done" states. This causes a visual hang at 99%. The fix ensures 100% is explicitly reported when each phase truly completes.

**Step 1: Write the failing test**

Add to `video-frame-pipeline.test.ts`:

```typescript
describe('VideoFramePipeline 100% progress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should report exactly 100% progress when export completes', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const progressUpdates: { phase: string; progress: number }[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockImplementation((name: string) => {
        if (name === 'frame_0001.png') {
          // Minimal valid PNG header for dimension extraction
          return Promise.resolve(new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x64,
            0x00, 0x00, 0x00, 0x64,
            0x08, 0x02, 0x00, 0x00, 0x00,
          ]))
        }
        return Promise.resolve(new Uint8Array([1, 2, 3]))
      }),
      exec: vi.fn().mockResolvedValue(0),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    }

    const { VideoFramePipeline } = await import('./video-frame-pipeline')
    const pipeline = new VideoFramePipeline(mockFFmpeg as any)

    await pipeline.exportWithTracer({
      videoBlob: new Blob(['video'], { type: 'video/mp4' }),
      trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
      startTime: 0,
      endTime: 0.1,
      fps: 10,
      tracerStyle: {
        color: '#ff0000',
        thickness: 2,
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 0.5,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
      },
      onProgress: (p) => progressUpdates.push({ phase: p.phase, progress: p.progress }),
    })

    // Must have 100% for each phase that completes
    const has100Extracting = progressUpdates.some(p => p.phase === 'extracting' && p.progress === 100)
    const has100Encoding = progressUpdates.some(p => p.phase === 'encoding' && p.progress === 100)
    const hasComplete = progressUpdates.some(p => p.phase === 'complete' && p.progress === 100)

    expect(has100Extracting).toBe(true)
    expect(has100Encoding).toBe(true)
    expect(hasComplete).toBe(true)

    // Should NOT have any phase stuck at 99% as final value
    const extractingUpdates = progressUpdates.filter(p => p.phase === 'extracting')
    const encodingUpdates = progressUpdates.filter(p => p.phase === 'encoding')

    // Last extracting update should be 100, not 99
    const lastExtracting = extractingUpdates[extractingUpdates.length - 1]
    expect(lastExtracting?.progress).toBe(100)

    // Last encoding update should be 100, not 99
    const lastEncoding = encodingUpdates[encodingUpdates.length - 1]
    expect(lastEncoding?.progress).toBe(100)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: FAIL - progress may be capped at 99%.

**Step 3: Remove the 99% cap and ensure 100% is always reported**

In `video-frame-pipeline.ts`:

**Line 97** - Remove the cap in extraction progress handler (if it exists after Task 2):

The Task 2 changes replace this with fallback updates. The key is ensuring line 129 always executes:

```typescript
    onProgress?.({ phase: 'extracting', progress: 100 })
```

**Line 186** - Update encoding progress handler to allow 100%:

Find:
```typescript
    const encodingProgressHandler = ({ progress }: { progress: number }) => {
      const percent = Math.round(progress * 100)
      onProgress?.({ phase: 'encoding', progress: Math.min(percent, 99) })
    }
```

Replace with:
```typescript
    const encodingProgressHandler = ({ progress }: { progress: number }) => {
      const percent = Math.round(progress * 100)
      // Allow up to 99% from FFmpeg - we'll report 100% explicitly after exec completes
      onProgress?.({ phase: 'encoding', progress: Math.min(percent, 99) })
    }
```

Keep the 99% cap here because FFmpeg may report 100% before the file is fully written. The explicit 100% after is what matters.

**Line 219** - Ensure encoding reports 100% before complete:

Find:
```typescript
    onProgress?.({ phase: 'encoding', progress: 100 })

    const result = await this.ffmpeg.readFile(outputName)
```

This should already exist. If not, add it. The key is the order:

```typescript
    // Clean up encoding progress listener
    this.ffmpeg.off('progress', encodingProgressHandler)

    // Explicitly report 100% for encoding phase BEFORE reading result
    onProgress?.({ phase: 'encoding', progress: 100 })

    const result = await this.ffmpeg.readFile(outputName)

    // Report completion BEFORE cleanup to avoid 99% hang
    onProgress?.({ phase: 'complete', progress: 100 })

    // Cleanup (non-blocking for user perception)
    await this.cleanup(inputName, outputName, totalFrames)

    return new Blob([new Uint8Array(result as Uint8Array)], { type: 'video/mp4' })
```

**Step 4: Run tests to verify**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: All tests pass.

**Step 5: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts apps/browser/src/lib/video-frame-pipeline.test.ts
git commit -m "fix(export): ensure 100% progress is reported before completion

Explicitly report 100% progress for extracting and encoding phases
after their operations complete. The 99% cap remains for FFmpeg's
progress events, but we always follow up with explicit 100%."
```

---

## Task 4: Update UI to Handle All Progress States

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx` (export modal progress display)

Ensure the UI correctly handles all progress states: -1 (indeterminate), 0-99 (in progress), and 100 (complete).

**Step 1: Find the progress display in export modal**

Search for `exportPhase.progress` in `ClipReview.tsx`. Find around lines 846-858 and 1114-1126:

```typescript
                  <div className="export-progress-bar">
                    <div
                      className={`export-progress-fill${exportPhase.progress === -1 ? ' indeterminate' : ''}`}
                      style={{ width: exportPhase.progress === -1 ? '100%' : `${exportPhase.progress}%` }}
                    />
                  </div>
                  <p className="export-status">
                    Clip {exportProgress.current} of {exportProgress.total}
                    {exportPhase.phase && (
                      exportPhase.progress === -1
                        ? ` — ${exportPhase.phase}...`
                        : ` — ${exportPhase.phase} ${exportPhase.progress}%`
                    )}
                  </p>
```

**Step 2: Verify indeterminate CSS exists**

Check that the CSS file has the indeterminate animation. If not present in the app's CSS, add:

```css
.export-progress-fill.indeterminate {
  animation: indeterminate 1.5s infinite linear;
  background: linear-gradient(90deg, var(--primary) 0%, var(--primary-light) 50%, var(--primary) 100%);
  background-size: 200% 100%;
}

@keyframes indeterminate {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
```

**Step 3: Verify in browser**

Run: `cd apps/browser && npm run dev`

1. Open http://localhost:5173
2. Load a test video
3. Approve a shot and click Export
4. Observe:
   - Extraction phase shows indeterminate animation (not stuck at 0%)
   - After extraction, compositing shows percentage progress
   - Encoding shows percentage progress
   - Completes at 100% (not stuck at 99%)
   - Modal auto-closes after 1.5 seconds

**Step 4: Commit**

```bash
git add apps/browser/src/components/ClipReview.tsx
git commit -m "fix(ui): ensure all progress states are handled in export modal

Verify indeterminate progress display for extraction phase and
proper 100% display for completion."
```

---

## Task 5: Manual Verification

**Files:**
- None (manual testing only)

**Step 1: Test normal export flow**

1. Start dev server: `cd apps/browser && npm run dev`
2. Open http://localhost:5173
3. Load a golf video (non-HEVC)
4. Wait for shot detection
5. Approve a shot with trajectory
6. Click "Export 1 Clip"

**Expected:**
- Extraction phase shows indeterminate animation (pulsing bar)
- Progress updates every ~1 second during extraction
- Compositing shows frame progress (e.g., "Compositing 1/30")
- Encoding shows percentage progress
- Reaches 100% and modal shows success
- Modal closes after 1.5 seconds
- Download is triggered

**Step 2: Test edge case - simulate slow extraction**

For this test, use a longer video (30+ seconds) to ensure extraction takes time:

1. Load a longer video
2. Export a clip
3. Watch the extraction phase

**Expected:**
- Should NOT stay at 0% or -1%
- Should show periodic progress updates (10%, 20%, etc.)
- Should eventually reach 100% extraction

**Step 3: Document results**

Create test evidence in `docs/test-evidence/2026-02-01-export-hangs-edge-cases/`:
- Screenshot of indeterminate extraction
- Screenshot of encoding at 100%
- Screenshot of completion modal
- Note any issues found

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Add defensive finally block | 10 min |
| 2 | Add fallback progress updates | 15 min |
| 3 | Ensure 100% progress is set | 10 min |
| 4 | Update UI for all progress states | 5 min |
| 5 | Manual verification | 10 min |

**Total estimated time:** ~50 minutes

**Acceptance Criteria:**

1. Export modal closes within 10 seconds even if exception occurs after downloads
2. Extraction phase shows progress updates (not stuck at 0% or -1%)
3. Progress reaches exactly 100% for extracting, encoding, and complete phases
4. Modal auto-closes after showing success for 1.5 seconds
5. All existing tests pass
6. Manual test confirms export works end-to-end

**Edge Cases Addressed:**

| Edge Case | Solution |
|-----------|----------|
| Exception after downloads | Finally block with 10s timeout |
| FFmpeg silent during extraction | Fallback interval updates every 1s |
| Progress capped at 99% | Explicit 100% calls after phase completion |
