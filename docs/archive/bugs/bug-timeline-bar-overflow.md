# Bug: Timeline Bar Overflows on Shot Navigation

**Status:** Fixed
**Priority:** P2
**Component:** Scrubber.tsx
**Date:** 2026-02-01

## Description

On the first clip review, the video player bar is located in the right place. However, when advancing to the next clip review, the player bar moves significantly to the right, pushing it out of the viewable frame. On the third clip, it's out of frame on both left AND right.

## Root Cause

`timeToPosition()` was returning values outside 0-100% when segment times fell outside the calculated window bounds. Timeline handles and selection bar rendered outside the container.

## Resolution

1. Added `Math.max(0, Math.min(100, position))` clamping to `timeToPosition()` in Scrubber.tsx
2. Added `overflow: hidden` to `.scrubber` CSS class

## Files Changed

- `apps/browser/src/components/Scrubber.tsx`
- `apps/browser/src/styles/global.css`
