# Bug: Sequential Upload Blocks Processing

**Status:** Fixed
**Priority:** High
**Component:** VideoDropzone.tsx, appStore.ts
**Date:** 2026-01-29
**Fixed:** 2026-02-02

## Description

When multiple videos are uploaded, the system waits for ALL videos to finish uploading before starting to process any of them. Processing should begin for each video as soon as its upload completes.

## Current Behavior

1. User selects 5 videos
2. All 5 videos upload sequentially
3. Only after ALL uploads complete does processing begin

## Expected Behavior

1. User selects 5 videos
2. Video 1 upload completes -> Processing for video 1 starts immediately
3. Video 2 upload completes -> Processing for video 2 starts immediately (or queues)
4. And so on...

## Technical Notes

- Need to decouple upload completion from batch processing start
- May need to track per-video state (uploading, uploaded, processing, complete)
- Consider parallel upload + sequential processing, or parallel both

## Files

- `apps/browser/src/components/VideoDropzone.tsx`
- `apps/browser/src/stores/processingStore.ts`

## Resolution

Fixed on 2026-02-02. Upload and processing are now decoupled so that processing begins for each video as soon as its upload completes.
