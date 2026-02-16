# Session Handoff: Export with Tracer Hang Investigation

**Date:** 2026-02-02
**Status:** Investigation in progress

## Summary

Export with tracer overlay hangs indefinitely in `VideoFramePipeline.exportWithTracer()`. The export modal shows "Exporting Clips" with "Clip 1 of 1" but no progress.

## What Was Fixed This Session

1. **Multi-video segments not being read in ClipReview** - App skipped directly to "All shots reviewed! 0 shots approved" because ClipReview used legacy `segments` array instead of `videos.get(activeVideoId).segments`. Fixed by using pattern: `activeVideo?.segments ?? legacySegments`

2. **Export using wrong segments source** - `handleExport` also read from legacy segments. Fixed same way.

3. **UI improvements** - Moved transport controls and scrubber below video, moved review actions to header.

## Current Issue: Export Hangs

### Reproduction Steps
1. Upload a video (multi-video flow)
2. Wait for shot detection
3. Mark landing point to generate trajectory
4. Approve the shot
5. Click "Export 1 Clip"
6. Modal appears but hangs indefinitely

### Console Output (with logging added)
```
[Export] Loading FFmpeg...
[Export] FFmpeg loaded
[Export] Processing segment 1 of 1 {hasTrajectory: true, trajectoryPoints: 31, hasObjectUrl: true, hasBlob: true}
[Export] Building export config... {blobSize: X, trajectoryPoints: 31, ...}
[Export] Calling pipeline.exportWithTracer...
// HANGS HERE
```

### Logging Added
Logging has been added to pinpoint where the hang occurs:

**ClipReview.tsx** - `exportSegmentWithTracer` function:
- Logs when building export config
- Logs before/after `pipeline.exportWithTracer()` call
- Logs progress callbacks

**video-frame-pipeline.ts** - `exportWithTracer` method:
- Logs at function entry
- Logs config details
- Logs before/after HEVC check
- Logs before/after writing blob to FFmpeg filesystem

**ffmpeg-client.ts** - `isHevcCodec` function:
- Logs blob size
- Logs before/after writing to FFmpeg filesystem
- Logs before/after ffmpeg probe execution
- Logs result

### Suspected Hang Locations

1. **`isHevcCodec()` hanging** - The HEVC check writes the entire video blob to FFmpeg's virtual filesystem and runs a probe. For large files, this could take a long time or hang.

2. **`fetchFile(videoBlob)`** - Converting blob to Uint8Array for FFmpeg could hang on large files.

3. **`ffmpeg.writeFile()`** - Writing large file to WASM memory could fail silently.

4. **`ffmpeg.exec()` for probe** - The ffmpeg probe command could hang.

### Next Steps

1. **Run export and check console** - The new logging will show exactly where it hangs
2. **Test with smaller video** - See if file size is the issue
3. **Add timeout to isHevcCodec** - Wrap in Promise.race with timeout
4. **Consider skipping HEVC check** - If it's always hanging, may need different approach

### Files Modified This Session

- `apps/browser/src/components/ClipReview.tsx` - Multi-video segment support, logging
- `apps/browser/src/components/ReviewActions.tsx` - New header component
- `apps/browser/src/stores/reviewActionsStore.ts` - New store for header actions
- `apps/browser/src/App.tsx` - Header layout changes
- `apps/browser/src/lib/video-frame-pipeline.ts` - Added logging
- `apps/browser/src/lib/ffmpeg-client.ts` - Added logging to isHevcCodec

### Bug Docs Created

- `docs/bugs/bug-export-multivideo-segments.md` - Fixed
- `docs/bugs/bug-export-tracer-pipeline-hang.md` - Investigating
- `docs/bugs/bug-clipreview-legacy-segments.md` - Updated with related fix

### Key Pattern to Remember

When accessing segments anywhere in the codebase, always use:
```typescript
const store = useProcessingStore.getState()
const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
const segments = activeVid?.segments ?? store.segments
```

This ensures both legacy single-video and new multi-video flows work correctly.

## Commands to Continue Investigation

```bash
# Start dev server
cd apps/browser && npm run dev

# View console in browser
# 1. Open http://localhost:5173
# 2. Open DevTools (F12)
# 3. Upload video, approve shot, export
# 4. Check Console tab for [isHevcCodec] and [Pipeline] logs
```

## Test Video Location

User's test videos are iPhone MOV files. The segment blob is created from MediaRecorder during processing, so it should be WebM or MP4 depending on browser support.
