# Bug: Offline Export Timeout Handling

**Date:** 2026-02-05
**Status:** not started
**Severity:** Medium
**Component:** Browser Export Pipeline (FFmpeg fallback)

## Problem

The offline export option (FFmpeg-WASM fallback for users without hardware acceleration) can timeout on longer clips. Currently there's no graceful handling of this scenario.

## Context

- Offline export runs at ~10-15x realtime (10s clip = 2-3 min export)
- Longer clips (30s+) could take 5-10+ minutes
- Browser may timeout or user may lose patience
- No progress indication specific to FFmpeg processing
- No ability to resume or chunk the work

## Desired Behavior

1. **Progress indication** - Show realistic time estimate and progress bar
2. **Timeout prevention** - Keep browser alive during long operations
3. **Chunked processing** - Break long clips into smaller segments if needed
4. **Graceful failure** - Clear error message if timeout occurs, with suggestions
5. **Consider Web Worker** - Move FFmpeg processing to worker thread to prevent UI blocking

## Related

- Export options panel shows warning: "May timeout on longer clips"
- Cloud processing option (coming soon) would be the recommended alternative for long clips

## Files

- `apps/browser/src/lib/ffmpeg-client.ts` - FFmpeg WASM wrapper
- `apps/browser/src/lib/video-frame-pipeline.ts` - V1 pipeline using FFmpeg
- `apps/browser/src/lib/video-frame-pipeline-v2.ts` - V2 pipeline
- `apps/browser/src/components/ClipReview.tsx` - Export UI
