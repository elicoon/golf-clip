# WebCodecs V3 Export Pipeline - Completed

**Date:** 2026-02-02
**Status:** COMPLETE - E2E tested and working
**Branch:** `poc/ffmpeg-filter-export`

## Summary

Built and tested a WebCodecs-based video export pipeline (V3) that successfully exports 4K videos with tracer overlays. The V1 pipeline hung on 4K videos; V3 completes successfully.

## What Was Built

V3 pipeline uses WebCodecs API for hardware-accelerated encoding:
- Native browser video decoding via `<video>` element
- Canvas compositing for tracer overlay (same as preview)
- WebCodecs `VideoEncoder` for H.264 encoding
- `mp4-muxer` for MP4 container creation

## Issues Resolved

### 1. mp4-muxer Import Error
**Error:** `Failed to resolve import "mp4-muxer"`
**Fix:** Updated `vite.config.ts`:
```typescript
resolve: {
  preserveSymlinks: true,
},
optimizeDeps: {
  include: ['mp4-muxer'],
}
```

### 2. Codec Level Error for 4K
**Error:** `Cannot call 'encode' on a closed codec` (encoder rejected 4K frames)
**Root Cause:** AVC Level 3.1 (`avc1.42001f`) only supports up to 720p
**Fix:** Auto-select codec level based on resolution in `video-frame-pipeline-v3.ts`:
```typescript
const pixels = width * height
let codecLevel: string
if (pixels <= 921600) {
  codecLevel = 'avc1.42001f' // Level 3.1 - up to 720p
} else if (pixels <= 2088960) {
  codecLevel = 'avc1.640028' // Level 4.0 High - up to 1080p
} else {
  codecLevel = 'avc1.640033' // Level 5.1 High - up to 4K
}
```

## E2E Test Results

### 1080p Video
- 3.15s clip exported in **4.0 seconds**
- 31 trajectory points rendered correctly

### 4K Video (2160x3840 portrait)
- 517MB source video, 3 detected shots
- **Clip 1 (10s):** 280.9s export time
- **Clip 2 (15s):** 462.2s export time
- **Clip 3 (10s):** 407.9s export time
- All clips downloaded successfully with tracer overlay visible

## Performance Analysis

| Resolution | Export Speed | Notes |
|------------|--------------|-------|
| 1080p | ~1.3x realtime | Acceptable |
| 4K | ~28-46x realtime | Slow but functional |

The 4K bottleneck is frame-by-frame seeking (`video.currentTime` + wait for `seeked` event). This is inherent to the browser video element approach.

## Key Files

| File | Purpose |
|------|---------|
| `apps/browser/src/lib/video-frame-pipeline-v3.ts` | WebCodecs pipeline |
| `apps/browser/src/components/ClipReview.tsx` | "Export V3" button |
| `apps/browser/vite.config.ts` | Vite monorepo resolution config |

## Commits

- `3e4aff8` - feat(export): add WebCodecs V3 pipeline with hardware acceleration
- `0b387ca` - fix(export): use drawbox filter instead of drawline for FFmpeg WASM
- `0524a6b` - feat(export): add Export V2 button for POC testing
- `249c945` - feat(export): add V2 pipeline with FFmpeg filter approach
- `0ee39e0` - feat(export): add trajectory to FFmpeg filter converter

## Next Steps (Optional Optimization)

To improve 4K export speed:
1. **Video.requestVideoFrameCallback()** - May be faster than seek events
2. **MediaStreamTrackProcessor** - Direct frame access without seeking
3. **OffscreenCanvas + Worker** - Move compositing off main thread
4. **Batch seeking** - Decode multiple frames before encoding

## Conclusion

V3 WebCodecs pipeline is functional for all resolutions. The V1 hang on 4K is resolved. 4K export is slow (~5-8 minutes per 10-15s clip) but completes successfully, which is a significant improvement over hanging indefinitely.
