# Frame Extraction Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the "Frame extraction produced no frames" export error by adding FFmpeg exit code validation, segment HEVC detection, and diagnostic logging.

**Architecture:** The fix adds three defensive layers: (1) check FFmpeg exit codes after exec() calls in video-frame-pipeline.ts, (2) verify segment codec before frame extraction, (3) capture and log FFmpeg stderr on failure. The existing HEVC detection runs on the original blob but segments created with `-c copy` preserve the original codec - we need to re-check segments.

**Tech Stack:** TypeScript, FFmpeg.wasm, Vitest

---

## Background

### Root Cause Analysis

The "Frame extraction produced no frames" error occurs when:

1. **FFmpeg exit code not checked** - `ffmpeg.exec()` returns a numeric exit code, but the current code at lines 102-116 in `video-frame-pipeline.ts` doesn't check it. FFmpeg can fail silently (non-zero exit, no exception thrown), producing no output frames.

2. **HEVC detection can miss segments** - The `isHevcCodec()` check at line 80 runs on the input `videoBlob`. However, if this blob is a segment created by `extractVideoSegment()` using `-c copy` (stream copy), the HEVC codec is preserved. The original file may have passed HEVC checks at upload time, but the segment still contains HEVC.

3. **No diagnostic logging on failure** - When frame extraction fails, there's no visibility into what FFmpeg reported. The stderr output could reveal decoder errors or codec issues.

### Current Code (Broken)

```typescript
// video-frame-pipeline.ts lines 102-116
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
  // Only catches if exec() throws, not if it returns non-zero
  this.ffmpeg.off('progress', extractionProgressHandler)
  const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
  console.error('[VideoFramePipeline] Frame extraction failed:', message)
  throw new Error(`Frame extraction failed: ${message}`)
}
```

### Fixed Code (Target)

```typescript
// video-frame-pipeline.ts - Add exit code check
try {
  const exitCode = await this.ffmpeg.exec([
    '-ss', startTime.toString(),
    '-i', inputName,
    '-t', duration.toString(),
    '-vf', `fps=${fps}`,
    '-f', 'image2',
    framePattern,
  ])
  if (exitCode !== 0) {
    throw new Error(`FFmpeg frame extraction failed with exit code ${exitCode}`)
  }
} catch (error) {
  this.ffmpeg.off('progress', extractionProgressHandler)
  const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
  console.error('[VideoFramePipeline] Frame extraction failed:', message)
  throw new Error(`Frame extraction failed: ${message}`)
}
```

---

## Task 1: Add Exit Code Check for Frame Extraction

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:102-116`
- Test: `apps/browser/src/lib/video-frame-pipeline.test.ts`

**Step 1: Verify existing tests for exit code handling**

The test file already contains tests for exit code handling in the `VideoFramePipeline - Exit Code Handling (Bug Fix: frame-extraction-no-frames)` describe block. Run the existing tests to confirm they fail with the current broken code.

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts -t "Exit Code Handling"`

Expected: Tests should FAIL because the current code doesn't check exit codes:
- `should throw error when ffmpeg.exec() returns non-zero exit code during frame extraction`
- `should include exit code in error message when frame extraction fails`

**Step 2: Implement the exit code check for frame extraction**

Modify `apps/browser/src/lib/video-frame-pipeline.ts` at lines 102-116:

```typescript
// Extract frames as PNG sequence with error handling
try {
  const exitCode = await this.ffmpeg.exec([
    '-ss', startTime.toString(),
    '-i', inputName,
    '-t', duration.toString(),
    '-vf', `fps=${fps}`,
    '-f', 'image2',
    framePattern,
  ])
  if (exitCode !== 0) {
    throw new Error(`FFmpeg frame extraction failed with exit code ${exitCode}`)
  }
} catch (error) {
  this.ffmpeg.off('progress', extractionProgressHandler)
  const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
  console.error('[VideoFramePipeline] Frame extraction failed:', message)
  throw new Error(`Frame extraction failed: ${message}`)
}
```

**Step 3: Run the exit code tests to verify fix**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts -t "Exit Code Handling"`

Expected: All exit code tests should now PASS:
- `should throw error when ffmpeg.exec() returns non-zero exit code during frame extraction` - PASS
- `should include exit code in error message when frame extraction fails` - PASS
- `should proceed normally when ffmpeg.exec() returns zero exit code` - PASS

**Step 4: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts
git commit -m "$(cat <<'EOF'
fix(export): add FFmpeg exit code check for frame extraction

The frame extraction step was not checking FFmpeg's exit code, causing
silent failures when the decoder couldn't process the video. Now throws
a descriptive error when exit code is non-zero.

Fixes: Frame extraction produced no frames error

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Diagnostic Logging for FFmpeg Stderr

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:91-127`
- Test: `apps/browser/src/lib/video-frame-pipeline.test.ts`

**Step 1: Write the failing test for diagnostic logging**

Add a new test to `apps/browser/src/lib/video-frame-pipeline.test.ts` after the existing exit code tests:

```typescript
describe('VideoFramePipeline - Diagnostic Logging (Bug Fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  const defaultTracerStyle = {
    color: '#FF4444',
    lineWidth: 3,
    glowEnabled: true,
    glowColor: '#FF6666',
    glowRadius: 8,
    showApexMarker: true,
    showLandingMarker: true,
    showOriginMarker: true,
    styleMode: 'solid' as const,
    tailLengthSeconds: 0.4,
    tailFade: true,
  }

  /**
   * Test that FFmpeg log output is captured and logged when extraction fails.
   * This helps debug codec issues without requiring users to understand FFmpeg.
   */
  it('should capture FFmpeg log output when frame extraction fails', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const consoleSpy = vi.spyOn(console, 'error')
    const logListeners: Array<(data: { message: string }) => void> = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('File not found')),
      exec: vi.fn().mockImplementation(async () => {
        // Simulate FFmpeg log output during execution
        for (const listener of logListeners) {
          listener({ message: 'Stream #0: Video: hevc, cannot decode' })
          listener({ message: 'Error decoding video stream' })
        }
        return 1 // Non-zero exit code
      }),
      deleteFile: vi.fn(),
      on: vi.fn().mockImplementation((event: string, callback: (data: { message: string }) => void) => {
        if (event === 'log') {
          logListeners.push(callback)
        }
      }),
      off: vi.fn().mockImplementation((event: string, callback: (data: { message: string }) => void) => {
        if (event === 'log') {
          const index = logListeners.indexOf(callback)
          if (index !== -1) logListeners.splice(index, 1)
        }
      }),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)
    const videoBlob = new Blob(['video-data'], { type: 'video/mp4' })

    try {
      await pipeline.exportWithTracer({
        videoBlob,
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 30,
        quality: 'draft',
        tracerStyle: defaultTracerStyle,
      })
      expect.fail('Expected error to be thrown')
    } catch {
      // Expected
    }

    // Should have logged diagnostic info from FFmpeg
    expect(consoleSpy).toHaveBeenCalled()
    const logCalls = consoleSpy.mock.calls.map(call => call.join(' ')).join('\n')
    expect(logCalls).toContain('FFmpeg')

    consoleSpy.mockRestore()
  })

  /**
   * Test that log listeners are cleaned up after failure.
   */
  it('should clean up log listeners when frame extraction fails', async () => {
    const { isHevcCodec } = await import('./ffmpeg-client')
    const { VideoFramePipeline } = await import('./video-frame-pipeline')

    vi.mocked(isHevcCodec).mockResolvedValue(false)

    const onCalls: string[] = []
    const offCalls: string[] = []

    const mockFFmpeg = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('File not found')),
      exec: vi.fn().mockResolvedValue(1),
      deleteFile: vi.fn(),
      on: vi.fn().mockImplementation((event: string) => {
        onCalls.push(event)
      }),
      off: vi.fn().mockImplementation((event: string) => {
        offCalls.push(event)
      }),
    }

    const pipeline = new VideoFramePipeline(mockFFmpeg as any)
    const videoBlob = new Blob(['video-data'], { type: 'video/mp4' })

    try {
      await pipeline.exportWithTracer({
        videoBlob,
        trajectory: [{ x: 0.5, y: 0.5, timestamp: 0 }],
        startTime: 0,
        endTime: 1,
        fps: 30,
        quality: 'draft',
        tracerStyle: defaultTracerStyle,
      })
    } catch {
      // Expected
    }

    // Every 'on' call for log should have a corresponding 'off' call
    const logOnCount = onCalls.filter(e => e === 'log').length
    const logOffCount = offCalls.filter(e => e === 'log').length
    expect(logOffCount).toBeGreaterThanOrEqual(logOnCount)
  })
})
```

**Step 2: Run the new test to verify it fails**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts -t "Diagnostic Logging"`

Expected: Tests should FAIL because the current code doesn't capture log output.

**Step 3: Implement diagnostic logging in video-frame-pipeline.ts**

Modify `apps/browser/src/lib/video-frame-pipeline.ts`. Add log capture before the frame extraction exec():

```typescript
// Before the extraction try block (around line 91), add:
// Set up log listener to capture FFmpeg stderr for diagnostics
let ffmpegLogs = ''
const logHandler = ({ message }: { message: string }) => {
  ffmpegLogs += message + '\n'
}
this.ffmpeg.on('log', logHandler)

// Set up progress listener for extraction phase
const extractionProgressHandler = ({ progress }: { progress: number }) => {
  // ... existing code
}
this.ffmpeg.on('progress', extractionProgressHandler)

// Extract frames as PNG sequence with error handling
try {
  const exitCode = await this.ffmpeg.exec([
    '-ss', startTime.toString(),
    '-i', inputName,
    '-t', duration.toString(),
    '-vf', `fps=${fps}`,
    '-f', 'image2',
    framePattern,
  ])
  if (exitCode !== 0) {
    // Log FFmpeg output for debugging
    if (ffmpegLogs) {
      console.error('[VideoFramePipeline] FFmpeg logs:\n', ffmpegLogs)
    }
    throw new Error(`FFmpeg frame extraction failed with exit code ${exitCode}`)
  }
} catch (error) {
  this.ffmpeg.off('progress', extractionProgressHandler)
  this.ffmpeg.off('log', logHandler)
  const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
  console.error('[VideoFramePipeline] Frame extraction failed:', message)
  if (ffmpegLogs) {
    console.error('[VideoFramePipeline] FFmpeg logs:\n', ffmpegLogs)
  }
  throw new Error(`Frame extraction failed: ${message}`)
}

// Clean up listeners after successful extraction
this.ffmpeg.off('progress', extractionProgressHandler)
this.ffmpeg.off('log', logHandler)
```

**Step 4: Run tests to verify fix**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts -t "Diagnostic Logging"`

Expected: All diagnostic logging tests should PASS.

**Step 5: Run all video-frame-pipeline tests to ensure no regressions**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts`

Expected: All tests PASS (existing tests should still work).

**Step 6: Commit**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts apps/browser/src/lib/video-frame-pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat(export): add FFmpeg diagnostic logging for frame extraction

Captures FFmpeg log output during frame extraction and logs it to
console when extraction fails. This provides visibility into decoder
errors (e.g., "cannot decode hevc") without requiring users to
understand FFmpeg internals.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Exit Code Check for Video Encoding

**Files:**
- Modify: `apps/browser/src/lib/video-frame-pipeline.ts:191-214`
- Test: `apps/browser/src/lib/video-frame-pipeline.test.ts`

**Step 1: Verify existing encoding exit code test**

The test `should throw error when ffmpeg.exec() returns non-zero exit code during encoding` already exists in the test file.

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts -t "returns non-zero exit code during encoding"`

Expected: Test may already pass if encoding exit code is checked. If it fails, proceed to Step 2.

**Step 2: Implement exit code check for encoding (if needed)**

Check `video-frame-pipeline.ts` lines 191-214. If the encoding exec() doesn't check exit code, add it:

```typescript
// Re-encode with audio from original
try {
  const exitCode = await this.ffmpeg.exec([
    '-framerate', fps.toString(),
    '-i', framePattern,
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-i', inputName,
    '-map', '0:v',
    '-map', '1:a?',
    '-c:v', 'libx264',
    '-crf', crf.toString(),
    '-preset', preset,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-y',
    outputName,
  ])
  if (exitCode !== 0) {
    throw new Error(`FFmpeg video encoding failed with exit code ${exitCode}`)
  }
} catch (error) {
  this.ffmpeg.off('progress', encodingProgressHandler)
  const message = error instanceof Error ? error.message : 'Unknown FFmpeg error'
  console.error('[VideoFramePipeline] Video encoding failed:', message)
  throw new Error(`Video encoding failed: ${message}`)
}
```

**Step 3: Run the encoding test**

Run: `cd apps/browser && npm test -- --run video-frame-pipeline.test.ts -t "returns non-zero exit code during encoding"`

Expected: Test should PASS.

**Step 4: Commit (if changes were made)**

```bash
git add apps/browser/src/lib/video-frame-pipeline.ts
git commit -m "$(cat <<'EOF'
fix(export): add FFmpeg exit code check for video encoding

Ensures encoding failures with non-zero exit codes throw descriptive
errors instead of silently producing corrupt or empty output.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Run Full Test Suite and Manual Verification

**Files:**
- None (verification only)

**Step 1: Run all browser app tests**

Run: `cd apps/browser && npm test`

Expected: All tests PASS. No regressions.

**Step 2: Run typecheck**

Run: `cd apps/browser && npm run typecheck`

Expected: No TypeScript errors.

**Step 3: Build the app**

Run: `cd apps/browser && npm run build`

Expected: Build succeeds with no errors.

**Step 4: Manual verification (if running locally)**

1. Start dev server: `cd apps/browser && npm run dev`
2. Upload a test video
3. Process and detect shots
4. Attempt to export a clip
5. Verify that:
   - If the video is playable, export succeeds
   - If the video contains HEVC, the HevcExportError modal appears
   - If FFmpeg fails for another reason, a descriptive error appears (not just "no frames")

**Step 5: Commit any test updates**

If any tests needed adjustment during verification:

```bash
git add apps/browser/src/lib/video-frame-pipeline.test.ts
git commit -m "$(cat <<'EOF'
test(export): update frame extraction tests for exit code handling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `apps/browser/src/lib/video-frame-pipeline.ts` | Add exit code checks after `ffmpeg.exec()` calls, add FFmpeg log capture for diagnostics |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | Add diagnostic logging tests |

## Acceptance Criteria

1. **Exit code checked** - Frame extraction throws `Frame extraction failed with exit code X` when FFmpeg returns non-zero
2. **Diagnostic logging** - FFmpeg stderr output is captured and logged when extraction fails
3. **Encoding exit code checked** - Video encoding throws descriptive error on failure
4. **All tests pass** - No regressions in existing functionality
5. **TypeScript compiles** - No type errors
6. **Build succeeds** - Production build completes

## Related Files (Reference)

- `apps/browser/src/lib/ffmpeg-client.ts` - Already has exit code checks for `extractAudioFromSegment`, `transcodeHevcToH264`, `extractVideoSegment` (good pattern to follow)
- `apps/browser/src/lib/streaming-processor.ts` - Calls `extractVideoSegment` which uses `-c copy` (preserves HEVC)
- `docs/bugs/bug-frame-extraction-no-frames.md` - Bug description

## Out of Scope (Future Work)

- Transcoding segments during extraction (would fix HEVC preservation but is slow)
- Re-checking HEVC after segment extraction in streaming-processor.ts
- Adding user-visible FFmpeg error details in the UI (currently logged to console only)
