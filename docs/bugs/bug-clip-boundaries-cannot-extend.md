# Bug: Clip Boundaries Cannot Be Extended Beyond Detected Range

**Status:** Fixed
**Priority:** Medium
**Component:** Scrubber.tsx, ClipReview.tsx
**Date:** 2026-02-01

## Description

The timeline scrubber only allows shortening clips, not extending them. When a shot is detected, the clip boundaries (start/end handles) are locked to the detected clip range. If the detection clips the shot too tightly (starts too late or ends too early), users cannot extend the boundaries to capture the full shot.

## Current Behavior

- Clip start/end handles can only be moved inward (making clip shorter)
- No buffer zone exists beyond the detected boundaries
- Users who need to capture more context before/after the shot are stuck

## Expected Behavior

- Allow extending clip boundaries up to ~5 seconds beyond the detected range on either side
- This provides flexibility when:
  - Detection starts slightly after the actual swing begins
  - Detection ends before the ball lands or the follow-through completes
  - User wants more lead-in or lead-out for context

## Technical Notes

The scrubber component likely constrains handles to `[clip_start, clip_end]` from the detected shot. Should allow `[clip_start - 5, clip_end + 5]` (clamped to video bounds).

## Acceptance Criteria

- [ ] User can drag start handle earlier (up to 5s before detected start, or video start)
- [ ] User can drag end handle later (up to 5s after detected end, or video end)
- [ ] Visual indication of the "extension zone" vs detected zone
- [ ] Extended boundaries are saved and used for export

## Files

- `apps/browser/src/components/Scrubber.tsx` - Shows full segment for extension
- `apps/browser/src/components/ClipReview.tsx` - Passes videoDuration
- `apps/browser/src/lib/streaming-processor.ts` - Extracts 30s segments

## Root Cause Analysis (2026-02-02)

Two issues were found:

1. **Segment extraction was asymmetric**: Originally extracted 20s segments (5s before, 15s after)
2. **Scrubber used percentage-based buffer**: The extension buffer was 25% of segment duration, which for short segments was less than the actual available room

## Fix (2026-02-02)

### Commit 1: Segment extraction (streaming-processor.ts)
Changed to symmetric 30s segments around impact:
- **Segment**: impact-15s to impact+15s (30s total)
- **Default clip**: impact-5s to impact+10s (15s)
- **Extension room**: 10s before clip start, 5s after clip end

### Commit 2: Scrubber display (Scrubber.tsx)
Changed scrubber to show full segment instead of percentage-based buffer:
- Window now spans 0 to videoDuration (full segment)
- User can extend clips to actual segment boundaries
- Removed artificial 25%-of-duration buffer calculation

### Timeline
| Keyframe | Time Relative to Impact |
|----------|------------------------|
| Segment start (selectable area begins) | -15s |
| Default clip start | -5s |
| Default clip end | +10s |
| Segment end (selectable area ends) | +15s |
