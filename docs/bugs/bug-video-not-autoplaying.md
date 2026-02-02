# Bug: Video Does Not Autoplay After Loading

**Status:** Fixed
**Priority:** P1
**Component:** ClipReview.tsx
**Date:** 2026-01-30

## Description

After video loads in ClipReview, it remains paused instead of autoplaying. This was reported as a regression.

## Current Behavior (Before Fix)

- Video loads successfully
- Video remains paused
- User must manually click play

## Expected Behavior

Video should autoplay when entering clip review mode.

## Root Cause

The browser app's ClipReview.tsx never had autoplay implemented. The feature existed only in the desktop/Electron version but was never ported to the browser version.

## Resolution

1. Added `handleVideoCanPlay` callback that triggers on video's `onCanPlay` event
2. Added `muted` and `playsInline` attributes to video element (required for browser autoplay policies)
3. Used `seeked` event to wait for seek completion before playing (avoids race with auto-loop)
4. Added `lastSeekTimeRef` to prevent auto-loop from immediately pausing after initial seek
5. Handle edge case where video is already near target time (no seek needed)

## Verification

Video now autoplays when entering review mode.

## Files Changed

- `apps/browser/src/components/ClipReview.tsx`
