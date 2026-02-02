# Bug: Missing Video Control Buttons

**Status:** Fixed
**Priority:** P2
**Component:** ClipReview.tsx
**Date:** 2026-02-01

## Description

Below the video player bar, there is only a play button. Missing: pause, advance 1 frame, go back 1 frame, skip to end, go back to start.

## Previous State

Only Play/Pause button existed. Keyboard shortcuts for frame stepping were available but not clickable buttons.

## Resolution

Added new `.video-transport-controls` section with 5 buttons:
- Skip to clip start (`skipToStart()`)
- Step back 1 frame (`stepFrameBackward()`)
- Play/Pause (`togglePlayPause()`)
- Step forward 1 frame (`stepFrameForward()`)
- Skip to clip end (`skipToEnd()`)

## Files Changed

- `apps/browser/src/components/ClipReview.tsx`
- `apps/browser/src/styles/global.css`
