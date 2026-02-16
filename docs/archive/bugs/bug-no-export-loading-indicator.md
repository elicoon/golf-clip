# Bug: No Loading Indicator During Export

**Status:** Fixed
**Priority:** P2
**Component:** ClipReview.tsx - Export UI
**Date:** 2026-01-31

## Description

When clicking "Export 1 Clip", the export process starts (console shows "Export progress: extracting 0%") but there is no visible UI feedback. The screen remains static with no progress bar, spinner, or status message.

## Current Behavior (Before Fix)

1. Click "Export 1 Clip"
2. No visible progress indicator
3. Console shows export is running
4. Users don't know if export is working

## Expected Behavior

A visible progress indicator showing:
- Current phase (extracting, compositing, encoding)
- Percentage complete

## Impact

Users have no idea if export is working, stuck, or failed. They might click the button multiple times or navigate away.

## Resolution

Added export progress UI that displays:
- Current export phase
- Percentage completion
- Visual progress bar

## Files Changed

- `apps/browser/src/components/ClipReview.tsx`
- `apps/browser/src/styles/global.css`
