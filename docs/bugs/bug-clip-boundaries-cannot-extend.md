# Bug: Clip Boundaries Cannot Be Extended Beyond Detected Range

**Status:** Open
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

- `packages/frontend/src/components/Scrubber.tsx` - Handle constraints
- `packages/frontend/src/components/ClipReview.tsx` - Clip boundary state
