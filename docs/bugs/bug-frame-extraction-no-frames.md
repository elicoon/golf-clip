# Bug: Frame Extraction Produces No Frames on Export

## Summary

Export fails with error "Frame extraction produced no frames. The video may be corrupted or in an unsupported format."

## Steps to Reproduce

1. Upload a video to the browser app
2. Process and detect shots
3. Review clips and attempt to export
4. Export fails with frame extraction error

## Expected Behavior

Export should successfully extract frames and produce the output clip.

## Actual Behavior

Modal displays:
- **Title:** "Export Failed"
- **Error:** "Frame extraction produced no frames. The video may be corrupted or in an unsupported format."

## Screenshot

![Export Failed Modal](../../assets/bug-screenshots/bug-frame-extraction-no-frames.png)

## Environment

- App: Browser (https://browser-seven-sigma.vercel.app)
- Browser: Unknown
- Video format: Unknown (likely HEVC/H.265 based on similar issues)

## Possible Causes

1. HEVC/H.265 video not supported by FFmpeg.wasm without transcoding
2. Video codec incompatibility with browser's FFmpeg.wasm build
3. Frame extraction command failing silently

## Related

- [bug-export-hangs.md](bug-export-hangs.md)
- [2026-02-01-hevc-transcoding-reset.md](2026-02-01-hevc-transcoding-reset.md)

## Status

**Fixed** - HEVC transcoding and proper error handling added in PR #9. E2E tests verify HEVC videos work.

## Priority

High - Blocks core export functionality
