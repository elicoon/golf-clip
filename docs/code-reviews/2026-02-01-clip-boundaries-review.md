# Code Review: Clip Boundaries Extension Fix

## Summary

The branch `fix/clip-boundary-extension` does NOT address the bug described in `bug-clip-boundaries-cannot-extend.md`. Instead, it implements three distinct features: (1) FFmpeg exit code checking for frame extraction, (2) multi-video upload support without blocking, and (3) per-video state tracking in the processing store. The branch name is misleading.

## Changes Reviewed

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `apps/browser/src/lib/video-frame-pipeline.ts` | +32 | Add FFmpeg exit code checks and diagnostic logging |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | +481 | New tests for exit code handling and HEVC integration |
| `apps/browser/src/stores/processingStore.ts` | +151 | Multi-video state tracking with per-video actions |
| `apps/browser/src/lib/streaming-processor.ts` | +73 | Support per-video state updates via videoId parameter |
| `apps/browser/src/components/VideoDropzone.tsx` | +69/-63 | Multiple file upload support with parallel processing |

## Findings

### Issues (Must Fix)

- [ ] **CRITICAL: Integration tests failing (11 failures)** - The mock FFmpeg in `video-frame-pipeline.integration.test.ts` does not return an exit code from `exec()`. Since the new code checks `if (exitCode !== 0)`, and `undefined !== 0` is true, all tests that don't explicitly mock the exit code now fail. The mock's `exec()` must return `Promise.resolve(0)` for success cases.

- [ ] **Branch name mismatch** - Branch `fix/clip-boundary-extension` does not fix the clip boundary extension bug (allowing users to extend clip boundaries beyond detected range). The actual bug in `Scrubber.tsx` and `ClipReview.tsx` is untouched. Consider renaming the branch to something like `feat/multi-video-upload` or `fix/ffmpeg-exit-code-handling`.

- [ ] **Unused import removal incomplete** - `VideoDropzone.tsx` removes `estimateTranscodeTime` from imports but the corresponding functionality for HEVC handling in multi-file mode just marks as error with a generic message. Users lose the estimated transcode time information.

- [ ] **`isCheckingCodec` unused setter** - Line 85 has `const [isCheckingCodec] = useState(false)` - the setter is removed but the state variable is still declared. This is a lint warning waiting to happen. Should either remove entirely or keep the setter for future use.

### Suggestions (Nice to Have)

- [ ] **Better HEVC handling in multi-file mode** - Currently HEVC files in multi-file upload get marked as error with "HEVC codec detected - needs transcoding". Consider showing a transcode modal or providing a "Transcode All HEVC" action rather than just failing.

- [ ] **Progress aggregation for multi-video** - When processing multiple videos in parallel, there's no aggregate progress view. Each video has individual progress but no overall "3 of 5 videos complete" indication.

- [ ] **TypeScript type for exit code** - The FFmpeg `exec()` return type is implicit. Consider adding explicit type annotation: `const exitCode: number = await this.ffmpeg.exec([...])` for clarity.

- [ ] **Test for log listener cleanup on success path** - Tests verify log listener cleanup on failure, but there's no explicit test for cleanup on success path. The code does clean up correctly, but a test would document the expectation.

- [ ] **Consistent error message format** - Exit code errors use different formats:
  - Frame extraction: `FFmpeg frame extraction failed with exit code ${exitCode}`
  - Video encoding: `FFmpeg video encoding failed with exit code ${exitCode}`

  Consider: `FFmpeg ${operation} failed with exit code ${exitCode}` for consistency.

### Approved Items

- [x] **FFmpeg exit code checking** - Critical fix. FFmpeg can fail silently (exit code 1) without throwing, causing confusing "no frames" errors. Checking exit code before proceeding is correct.

- [x] **Diagnostic logging** - Capturing FFmpeg stderr via `on('log')` before failure aids debugging codec issues without requiring users to understand FFmpeg.

- [x] **Log listener cleanup** - Both success and failure paths properly call `this.ffmpeg.off('log', logHandler)` to prevent memory leaks.

- [x] **Multi-video state structure** - `VideoState` interface and `createVideoState` factory are well-designed. Uses Map for O(1) lookups.

- [x] **URL revocation in removeVideo** - Properly revokes object URLs when removing a video to prevent memory leaks.

- [x] **Reset clears multi-video state** - The `reset()` action now revokes URLs for both legacy and multi-video segments before clearing state.

- [x] **TypeScript compilation passes** - `npx tsc --noEmit` succeeds with no errors.

- [x] **New tests for exit code handling** - Comprehensive tests verify:
  - Descriptive error when exit code is non-zero
  - Exit code value included in error message
  - Success when exit code is 0
  - Exit code checked on first exec (frame extraction), not just encoding

- [x] **`processFileInBackground` doesn't block** - Fire-and-forget pattern with `getState()` avoids blocking the UI during multi-file upload.

- [x] **File input `multiple` attribute** - Correctly added to allow selecting multiple files in the file picker.

## Test Results

```
Tests: 11 failed, 80 passed
```

Failing tests are all in `video-frame-pipeline.integration.test.ts` due to mock not returning exit code.

## Verdict

**NEEDS CHANGES**

The code quality is good and the features are useful, but:

1. **Tests must pass** - The integration test mock needs to return exit code 0 for success cases
2. **Branch name misleading** - Should be renamed to reflect actual changes
3. **One more required fix** - The unused state variable needs cleanup

After these fixes, the changes can be approved. The FFmpeg exit code handling is a valuable bug fix, and multi-video support is a solid foundation for parallel processing.
