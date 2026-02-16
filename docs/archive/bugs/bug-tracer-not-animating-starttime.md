# Bug: Tracer Overlay is Static Instead of Animating

**Status:** Fixed
**Priority:** P2
**Component:** ClipReview.tsx, TrajectoryEditor.tsx
**Date:** 2026-01-30

## Description

After generating trajectory, the entire tracer path appears at once instead of animating progressively as the ball travels through the air.

## Current Behavior (Before Fix)

- Generate trajectory
- Full tracer line appears immediately
- No progressive animation synced to video playback

## Expected Behavior

- Tracer should animate progressively as video plays
- Line should "draw" from origin toward landing as ball flies
- Animation timing should match configured flight_time parameter

## Root Cause

The trajectory timestamps were generated starting at 0 and ending at `flightTime` (e.g., 0 to 3.0 seconds), but these timestamps had no relationship to when the ball flight actually happens in the video segment timeline.

The animation code was correctly using `requestAnimationFrame` and reading `video.currentTime`, but when comparing `video.currentTime` (e.g., 2.5s into segment) against trajectory timestamps (0 to 3.0s), the math would immediately show the full trajectory.

## Resolution

Added a `startTimeOffset` parameter to `generateTrajectory()` that aligns trajectory timestamps with the video segment timeline:
- `startTimeOffset = strikeTime - startTime` (when ball is struck in segment)
- Trajectory timestamps now range from `startTimeOffset` to `startTimeOffset + flightTime`

This ensures the tracer animation starts when the ball is actually struck and progresses smoothly over the configured flight time.

## Files Changed

- `apps/browser/src/components/ClipReview.tsx`
- `apps/browser/src/components/TrajectoryEditor.tsx`
