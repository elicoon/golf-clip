# Bug: Trajectory Adjust Marker Appears in Wrong Location

**Status:** Fixed
**Priority:** P2
**Component:** TrajectoryEditor.tsx
**Date:** 2026-01-30

## Description

The trajectory adjustment marker/handle doesn't match where the ball will actually land. When clicking on the video to place a marker, it appears offset from the click location.

## Root Cause

The TrajectoryEditor component was using the video element's bounding rect for coordinate transformations, but the video element uses `object-fit: contain` which creates letterboxing when the video's aspect ratio doesn't match the container's aspect ratio. Click coordinates were being normalized relative to the full container (including black bars), causing markers to appear offset from where the user clicked on the actual video content.

## Resolution

Updated `TrajectoryEditor.tsx` in both `apps/browser/src/components/` and `packages/frontend/src/components/` to:

1. Calculate `videoContentBounds` - the actual rendered video area within the container, accounting for letterboxing
2. Uses `video.videoWidth` and `video.videoHeight` to get intrinsic video dimensions
3. Compares video aspect ratio to container aspect ratio
4. Calculates offset and size of the actual video content area
5. Updated `toCanvas()` helper to convert normalized coordinates using video content bounds
6. Updated click handler to convert screen coordinates relative to video content area

## Files Changed

- `apps/browser/src/components/TrajectoryEditor.tsx`
- `packages/frontend/src/components/TrajectoryEditor.tsx`
