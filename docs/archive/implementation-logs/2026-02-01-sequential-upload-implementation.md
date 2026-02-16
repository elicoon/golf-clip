# Sequential Upload Bug Fix Implementation Log

**Date:** 2026-02-01
**Branch:** `fix/sequential-upload-processing`
**Status:** Complete

## Summary

Implemented the fix for the sequential upload bug where multiple video uploads would wait for ALL files to complete before processing starts. Users can now upload multiple videos that process independently and in parallel.

## Changes Made

### Task 1: Multi-Video State in processingStore.ts

**File:** `apps/browser/src/stores/processingStore.ts`

Added:
- `VideoId` type for unique video identification
- `VideoState` interface tracking per-video:
  - `id`, `fileName`, `fileDuration`
  - `status` ('pending' | 'loading' | 'processing' | 'ready' | 'error')
  - `error`, `progress`, `progressMessage`
  - `strikes`, `segments`, `currentSegmentIndex`
- `createVideoState()` factory function
- `videos: Map<VideoId, VideoState>` for multi-video tracking
- `activeVideoId` for currently displayed video
- Multi-video actions:
  - `addVideo`, `removeVideo`, `setActiveVideo`
  - `updateVideoState`, `setVideoProgress`, `setVideoStatus`, `setVideoError`
  - `addVideoStrike`, `addVideoSegment`, `setVideoFileInfo`
  - `updateVideoSegment`, `approveVideoSegment`, `rejectVideoSegment`
  - `getVideo`
- Updated `reset()` to clean up multi-video state and revoke object URLs

**Commit:** `feat(store): add multi-video state tracking`

### Task 2: Per-Video State Updates in streaming-processor.ts

**File:** `apps/browser/src/lib/streaming-processor.ts`

Modified `processVideoFile()`:
- Added optional `videoId?: string` parameter
- Created helper functions that dispatch to either per-video or legacy global state:
  - `updateProgress()` - uses `setVideoProgress` or `setProgress`
  - `updateStatus()` - uses `setVideoStatus` or `setStatus`
  - `addStrike()` - uses `addVideoStrike` or `addStrike`
  - `addSegment()` - uses `addVideoSegment` or `addSegment`
  - `setFileInfo()` - uses `setVideoFileInfo` or `setFileInfo`
  - `setError()` - uses `setVideoError` or `setError`
- Maintains full backward compatibility when `videoId` is not provided

**Commit:** `feat(processor): support per-video state updates via videoId`

### Task 3: Multi-File Support in VideoDropzone.tsx

**File:** `apps/browser/src/components/VideoDropzone.tsx`

Added:
- `generateVideoId()` helper function
- `processFileInBackground()` async function that:
  - Adds video to store immediately with 'pending' status
  - Checks codec (marks HEVC as error instead of showing modal)
  - Processes video with `videoId` for independent tracking
  - Handles errors per-video

Modified:
- Added `multiple` attribute to file input
- Updated `handleDrop()` to process all dropped files without blocking
- Updated `handleFileInputChange()` to process all selected files without blocking
- Removed blocking `await` calls - files process in parallel

**Commit:** `feat(dropzone): support multiple file uploads without blocking`

### Task 4: VideoQueue UI Component

**New File:** `apps/browser/src/components/VideoQueue.tsx`

Created component showing:
- List of all videos being processed
- Status icon per video (pending, loading, processing, ready, error)
- Progress percentage during processing
- Shot count when ready
- Error indicator when failed
- Click to switch active video

**File:** `apps/browser/src/styles/global.css`

Added styles:
- `.video-queue` container
- `.queue-item` with status-based styling
- Active item highlighting
- Progress and error text styling
- Pulse animation for processing state

**File:** `apps/browser/src/App.tsx`

Updated:
- Import `VideoQueue` component
- Destructure `videos`, `activeVideoId` from store
- Calculate `activeVideo` and `hasVideos`
- Show "New Video" button when videos exist
- Render `VideoQueue` when `hasVideos`
- Auto-transition to review when active video is ready
- Use active video's segments for export count

**Commits:**
- `feat(ui): add VideoQueue component for multi-video tracking`
- `feat(ui): add VideoQueue styles and update App for multi-video`

## Verification

### TypeScript Compilation
```
npx tsc --noEmit
# No errors
```

### Build
```
npm run build
# Success - built in 3.16s
```

### Tests
- 4 failing tests are pre-existing issues unrelated to this implementation:
  - 2 in `processingStore.test.ts` (confidence auto-approval logic)
  - 2 in `ClipReview.timeout.test.tsx` (timeout clearing bug)
- All other tests pass (243 total)

## Architecture Notes

### Backward Compatibility
The implementation maintains full backward compatibility:
- Legacy single-video flow still works via global state
- `processVideoFile()` works without `videoId` parameter
- Both legacy and multi-video effects trigger view transitions

### HEVC Handling
In multi-file mode, HEVC videos are marked as errors instead of showing a modal:
- Simplifies the flow for batch uploads
- User sees error in queue and can handle individually
- Single-file HEVC modal flow could be restored if needed

### State Isolation
Each video has completely independent state:
- Progress doesn't affect other videos
- Errors are contained to the failing video
- Segments are stored per-video

## Files Changed

| File | Changes |
|------|---------|
| `apps/browser/src/stores/processingStore.ts` | +205 lines |
| `apps/browser/src/lib/streaming-processor.ts` | +68 -17 lines |
| `apps/browser/src/components/VideoDropzone.tsx` | +71 -59 lines |
| `apps/browser/src/components/VideoQueue.tsx` | +72 lines (new) |
| `apps/browser/src/styles/global.css` | +84 lines |
| `apps/browser/src/App.tsx` | +28 -5 lines |

## Next Steps

1. Manual testing with actual video files
2. Consider restoring single-file HEVC modal flow
3. Add ability to remove individual videos from queue
4. Add progress persistence across page refreshes
