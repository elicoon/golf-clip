# Bug: Export Blocks Next Clip Review

**Status:** Fixed
**Priority:** High
**Component:** ClipReview.tsx, appStore.ts
**Date:** 2026-01-29

## Description

When user accepts a clip and it starts exporting, the UI blocks until export completes before allowing review of the next clip. Export should happen in background while user continues reviewing.

## Current Behavior

1. User reviews shot 1, clicks "Accept"
2. Export starts for shot 1
3. UI blocks/waits for export to complete
4. Only then can user review shot 2

## Expected Behavior

1. User reviews shot 1, clicks "Accept"
2. Export queues/starts in background for shot 1
3. Immediately advance to shot 2 review
4. User can review all shots without waiting
5. Final "Export Complete" screen only shows after all shots reviewed AND all exports completed

## Technical Notes

- Need to decouple "accept shot" from "wait for export"
- Track export jobs separately from review state
- Only transition to ExportComplete view when both conditions met

## Resolution

Implemented background export queue that allows review to continue while exports process in parallel. Export completion is tracked separately from review state.
