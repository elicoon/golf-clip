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

- `apps/browser/src/components/Scrubber.tsx` - Has extension UI (30s buffer)
- `apps/browser/src/components/ClipReview.tsx` - Passes videoDuration
- `apps/browser/src/lib/streaming-processor.ts` - Extracts fixed 20s segments (5s before, 15s after)

## Root Cause Analysis (2026-02-02)

The UI fix was applied (Scrubber supports 30s extension buffer), but the underlying architecture limits extension:

1. **Segment extraction is fixed**: `streaming-processor.ts` extracts 20s segments (5s before strike, 15s after)
2. **Blob contains only that 20s**: The video element can only play what's in the blob
3. **UI can't extend beyond blob**: Even with the UI fix, you can't extend past what's in the extracted segment

**To fully fix:**
- Option A: Extract larger segments initially (e.g., 60s instead of 20s) - wasteful for memory
- Option B: Re-extract from original file when user extends boundaries - complex, requires keeping original file reference
- Option C: Accept current 20s limit as "good enough" for golf shots

**Current state**: UI fix merged but doesn't help because underlying segment is only 20s.

## Fix (2026-02-02)

Changed segment extraction to 30s (10s before, 20s after) with default clip of 15s (5s before, 10s after).
This gives 5s extension room on each side. See commit in `streaming-processor.ts`.
