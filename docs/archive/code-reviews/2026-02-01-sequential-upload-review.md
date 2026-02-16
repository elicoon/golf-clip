# Code Review: Sequential Upload Fix

## Summary

This PR adds multi-video upload support, allowing users to upload multiple videos that process independently in parallel rather than waiting for all uploads to complete. The implementation adds a `Map<VideoId, VideoState>` pattern to the processing store and a new VideoQueue UI component.

## Changes Reviewed

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `apps/browser/src/stores/processingStore.ts` | +208 | Multi-video state tracking via Map |
| `apps/browser/src/lib/streaming-processor.ts` | +85 | Per-video state updates via videoId |
| `apps/browser/src/components/VideoDropzone.tsx` | +130/-89 | Multi-file drop/select, background processing |
| `apps/browser/src/components/VideoQueue.tsx` | +72 (new) | Queue UI component |
| `apps/browser/src/styles/global.css` | +88 | VideoQueue styles |
| `apps/browser/src/App.tsx` | +25 | VideoQueue integration, active video handling |
| `apps/browser/src/lib/video-frame-pipeline.ts` | +28 | FFmpeg exit code checking |
| `apps/browser/src/lib/video-frame-pipeline.test.ts` | +486 | Exit code handling tests |
| `apps/browser/src/lib/video-frame-pipeline.integration.test.ts` | +2 | Mock fix for exit code |
| `docs/implementation-logs/2026-02-01-sequential-upload-implementation.md` | +166 | Implementation documentation |

## Findings

### Issues (Must Fix)

- [ ] **Integration tests are broken**: The change to `video-frame-pipeline.ts` that checks FFmpeg exit codes causes 11 integration tests to fail. The error message shows `exit code undefined` because the mock in `video-frame-pipeline.integration.test.ts` only added `return 0` to one spot (line 156-160), but the existing mock's `exec` function at lines 125-158 needs to also return an exit code. The mock simulates progress events and creates frame files but then falls through without returning 0 for the success path.

  **Evidence**: Tests fail with "FFmpeg frame extraction failed with exit code undefined"

  **Fix needed**: Update the mock FFmpeg `exec` function to return `0` at the end of its execution path, not just in the frame extraction branch.

- [ ] **VideoDropzone tests fail with unhandled rejection**: The `processFileInBackground` function calls `useProcessingStore.getState()` outside of React context. In tests where the store is mocked differently, this causes `TypeError: useProcessingStore.getState is not a function`.

  **Evidence**: Test file `VideoDropzone.test.tsx` fails with unhandled rejections.

  **Root cause**: The function is defined at module level and accesses the store synchronously. When tests mock the store, the module-level function still references the original import.

### Suggestions (Nice to Have)

- [ ] **HEVC handling in multi-file mode is degraded**: When multiple files are dropped, HEVC videos are silently marked as errors instead of showing the transcode modal. While this simplifies the flow, it may confuse users who expect the same behavior as single-file upload. Consider adding a queue-level "X videos need transcoding" notification or restoring the modal for the first HEVC file encountered.

- [ ] **Memory leak potential with object URLs**: The `reset()` function correctly revokes object URLs, but `removeVideo()` only revokes URLs for the removed video's segments. If users repeatedly add/remove individual videos without calling `reset()`, there's no issue, but the pattern of creating object URLs in `addVideoSegment` should document this cleanup responsibility.

- [ ] **Consider using `immer` for immutable updates**: The multi-video state updates create many new Map instances with spread patterns. This is correct but verbose. Since Zustand supports immer, consider using it to simplify updates like:
  ```typescript
  // Current
  set((state) => {
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, progress })
    return { videos: newVideos }
  })
  // With immer
  set(produce((state) => {
    state.videos.get(id).progress = progress
  }))
  ```

- [ ] **VideoQueue component could show total progress**: Currently shows per-video progress. A "3/5 videos complete" summary would be useful for large batches.

### Approved Items

- [x] **TypeScript compilation passes**: `npx tsc --noEmit` reports no errors. The types are well-defined.

- [x] **Backward compatibility maintained**: The implementation preserves all legacy single-video functionality. `processVideoFile()` works without `videoId` parameter. Both legacy and multi-video `useEffect` hooks trigger view transitions.

- [x] **State isolation is correct**: Each video has independent `status`, `progress`, `error`, and `segments`. Errors in one video don't affect others.

- [x] **FFmpeg exit code checking is a good addition**: The changes to `video-frame-pipeline.ts` add proper error detection when FFmpeg fails silently (non-zero exit without throwing). The diagnostic logging of FFmpeg stderr is helpful for debugging codec issues.

- [x] **New tests for exit code handling are comprehensive**: The 4 new test blocks in `video-frame-pipeline.test.ts` cover:
  - Non-zero exit code throws descriptive error
  - Exit code value included in error message
  - Exit code 0 succeeds
  - Exit code checked for frame extraction specifically (not just encoding)

- [x] **VideoQueue UI is clean and functional**: Status icons, progress percentages, shot counts, and error states are all displayed appropriately. CSS follows existing design system variables.

- [x] **`generateVideoId()` produces unique IDs**: Uses timestamp + random string, which is sufficient for client-side uniqueness.

- [x] **Documentation is thorough**: The implementation log captures all changes, verification steps, and architectural notes.

## Test Results

```
TypeScript: PASS (no errors)
Build: PASS (3.16s)
Tests: 19 failed | 282 passed | 2 skipped

Failures breakdown:
- 11 failures in video-frame-pipeline.integration.test.ts (caused by this PR's exit code changes)
- 4 failures in VideoDropzone.test.tsx (caused by this PR's processFileInBackground changes)
- 2 failures in processingStore.test.ts (PRE-EXISTING - auto-approval logic)
- 2 failures in ClipReview.timeout.test.tsx (PRE-EXISTING - timeout clearing)
```

## Verdict

**NEEDS CHANGES**

The core implementation is solid and the architecture is well-designed. However, the PR introduces test regressions that must be fixed before merge:

1. **Fix integration test mock** to return exit code 0 from all `exec` code paths
2. **Fix VideoDropzone test isolation** for `processFileInBackground`

Once these test issues are resolved, this PR is ready to merge.
