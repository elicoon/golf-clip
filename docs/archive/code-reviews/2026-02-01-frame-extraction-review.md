# Code Review: Frame Extraction Fix

## Summary

This PR adds FFmpeg exit code checking for frame extraction and video encoding, along with diagnostic logging to help debug codec-related failures. The fix addresses a bug where FFmpeg failures (e.g., HEVC decode errors) would silently produce no output, leading to a generic "no frames produced" error instead of a descriptive one mentioning the actual cause.

## Changes Reviewed

| File | Changes |
|------|---------|
| `apps/browser/src/lib/video-frame-pipeline.ts` | +28 -5 lines - Core fix for exit code checking and logging |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | +486 lines - New unit tests for exit code handling |
| `apps/browser/src/lib/video-frame-pipeline.integration.test.ts` | +2 lines - Mock exec returns exit code |
| `docs/implementation-logs/2026-02-01-sequential-upload-implementation.md` | +166 lines - Unrelated implementation log |

## Findings

### Issues (Must Fix)

- [ ] **Integration tests failing**: The integration tests in `video-frame-pipeline.integration.test.ts` fail because the `createMockFFmpeg` function's `exec` mock doesn't return an exit code. The fix in line 159 adds `return 0` but only inside the `if (args.includes('image2'))` block. When `exec` is called for encoding (second call), it returns `undefined` because there's no return statement for that code path. This causes tests to fail with "exit code undefined".

  **Location**: `apps/browser/src/lib/video-frame-pipeline.integration.test.ts`, line 125-159

  **Fix needed**: The mock's `exec` function should always return `0` at the end (after the if block), not just for image2 calls.

- [ ] **Test expectation mismatch**: The test `should propagate FFmpeg readFile errors` (line 370-384) expects the error message "Frame extraction produced no frames" but now receives "FFmpeg frame extraction failed with exit code undefined" because the new exit code check runs before the readFile call that would throw. The test expectation needs to be updated or the mock needs to return a non-zero exit code when `failOnReadFile` is true.

### Suggestions (Nice to Have)

- [ ] **Unrelated documentation file**: The file `docs/implementation-logs/2026-02-01-sequential-upload-implementation.md` describes a different feature (sequential upload) and appears to be accidentally included in this branch. Consider removing it or moving to the appropriate branch.

- [ ] **Consider including FFmpeg logs in error message**: Currently the FFmpeg logs are only written to `console.error`. For better user experience, consider including relevant log snippets in the thrown error message itself, especially for codec-related failures like HEVC detection.

- [ ] **Exit code type safety**: The exit code check `exitCode !== 0` works but FFmpeg.exec() returns `Promise<number>`. Consider adding explicit typing or a comment noting that exit codes should always be checked.

### Approved Items

- [x] **Exit code check implementation**: The core fix correctly checks the return value of `ffmpeg.exec()` and throws a descriptive error with the exit code value. This is the right approach for detecting codec failures.

- [x] **Log listener lifecycle management**: The `ffmpeg.on('log', logHandler)` and corresponding `ffmpeg.off('log', logHandler)` are properly paired in both success and error paths, preventing memory leaks.

- [x] **Diagnostic logging**: Capturing FFmpeg's stderr output via the log listener provides valuable debugging information for codec issues.

- [x] **New unit tests**: The 4 new test suites (`FFmpeg exit code handling`, `HEVC codec integration`, `Diagnostic Logging`) comprehensively cover:
  - Non-zero exit code detection
  - Error message contains exit code value
  - Success path with exit code 0
  - Exit code checked on first exec call (frame extraction), not just encoding
  - HevcExportError is catchable by type
  - HEVC detection happens before frame extraction (fail fast)
  - Log capture and listener cleanup

- [x] **TypeScript passes**: `npx tsc --noEmit` completes with no errors.

- [x] **Backward compatibility**: The changes are additive and don't break the existing API contract.

## Test Results

```
TypeScript: PASS (no errors)

Unit Tests:
- 282 passed
- 19 failed (11 in integration tests, 4 in VideoDropzone tests due to unrelated issue)
- 2 skipped
```

**Integration test failures** are all related to the mock not returning exit codes properly:
- "should complete full export pipeline and return MP4 blob"
- "should report progress in correct phase sequence"
- "should report frame progress during compositing"
- "should use correct quality settings for each preset"
- "should cleanup temporary files after export"
- "should handle markers in export"
- "should propagate FFmpeg readFile errors"
- "should handle very short duration"
- "should handle empty trajectory"
- "should handle single point trajectory"
- "should use default fps when not specified"

## Verdict

**NEEDS CHANGES**

The implementation logic is correct and well-tested with the new unit tests. However, the integration test mock needs to be fixed to always return an exit code from `exec()`. Once the mock is updated to return `0` at the end of the function (after all conditional blocks), the integration tests should pass.

### Required Changes Before Merge

1. Fix `createMockFFmpeg` in `video-frame-pipeline.integration.test.ts`:
   ```typescript
   exec: vi.fn(async (args: string[]) => {
     if (options.failOnExec) {
       throw new Error('FFmpeg exec failed')
     }
     // ... existing code ...
     if (args.includes('image2')) {
       // ... existing frame creation code ...
     }
     return 0  // Always return success exit code
   }),
   ```

2. Update or remove the test expectation in `should propagate FFmpeg readFile errors` to account for the new error message format.
