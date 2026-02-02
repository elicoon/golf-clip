# Bug: Export Creates .webm File - Format Unclear to User

**Status:** Fixed
**Priority:** P3
**Component:** ClipReview.tsx - Export
**Date:** 2026-01-30

## Description

Export produces a .webm file which may be unfamiliar to users. While WebM is a valid format, MP4 is more universally recognized and supported.

## Current Behavior

1. Export clip
2. Download is a .webm file
3. User may not know what WebM is or how to use it

## Expected Behavior

Either:
- Default to MP4 for better compatibility
- Add format selector in export dialog
- Add tooltip explaining WebM format

## Technical Notes

Options to consider:
1. Add format selector in export dialog (WebM, MP4)
2. Default to MP4 for better compatibility
3. Add tooltip explaining what WebM is and that it's playable in browsers
4. Note: MP4 encoding may require additional FFmpeg configuration

## Files

- `apps/browser/src/components/ClipReview.tsx` - Export functionality
- `apps/browser/src/lib/ffmpeg-client.ts` - Encoding options

## Resolution

The export functionality now defaults to MP4 format. Code verification in ClipReview.tsx shows:
- Line 409: `outputPath` uses `.mp4` extension for clips without trajectory
- Line 418: `outputPath` uses `.mp4` extension for clips with trajectory overlay
- Line 809: UI displays "All clips export as .mp4" to inform users of the format

MP4 provides better cross-platform compatibility than WebM and is universally recognized by users and media players.

## Verification

Manual code inspection confirmed the `.mp4` extension is used in all export code paths. The UI now clearly communicates the export format to users.
