# Bug: ClipReview Uses Legacy Segments Array Instead of Multi-Video Segments

**Status:** Fixed
**Priority:** P1
**Component:** ClipReview.tsx
**Date:** 2026-02-02

## Description

ClipReview component used the legacy `segments` array from the store instead of accessing segments via `videos.get(activeVideoId).segments`, causing the app to skip directly from upload to the "All shots reviewed! 0 shots approved" screen when using the multi-video upload flow.

## Root Cause

In `ClipReview.tsx` line 21, the component only destructured the legacy single-video `segments` from the store:

```typescript
const { segments, updateSegment, approveSegment, rejectSegment } = useAppStore()
```

However, when using the multi-video upload flow, segments are stored per-video in the `videos` Map at `videos.get(id).segments`. The legacy `segments` array remains empty, so the component immediately showed "All shots reviewed! 0 shots approved".

## Affected Flow

1. User uploads video(s) via multi-video upload
2. Processing completes, segments stored in `videos.get(videoId).segments`
3. ClipReview mounts and reads from legacy `segments` (empty array)
4. Component calculates `currentIndex >= segments.length` as `0 >= 0` = true
5. Shows "All shots reviewed!" immediately with 0 approved shots

## Fix

Updated ClipReview to support both legacy and multi-video flows:

1. Read segments from active video when available, falling back to legacy:
```typescript
const activeVideo = activeVideoId ? videos.get(activeVideoId) : undefined
const effectiveSegments = activeVideo?.segments ?? legacySegments
```

2. Created wrapper functions that route segment updates to either multi-video or legacy store actions based on `activeVideoId`:
```typescript
const handleUpdateSegment = (index: number, updates: Partial<Segment>) => {
  if (activeVideoId) {
    updateVideoSegment(activeVideoId, index, updates)
  } else {
    updateSegment(index, updates)
  }
}
```

Similar wrappers were added for `approveSegment` and `rejectSegment`.

## Files

- `apps/browser/src/components/ClipReview.tsx` - Segment reading and update logic

## Risk

High - This bug completely broke the review flow for multi-video uploads, making the feature unusable.

## Test Gap

- No integration tests covering the multi-video upload -> review flow
- Unit tests for ClipReview only tested with legacy segments array
- Missing test: "segments from videos Map are displayed when activeVideoId is set"

## Resolution

The fix ensures backward compatibility with the legacy single-video flow while properly supporting the new multi-video architecture. Both flows now correctly display and update segments through their respective store paths.

## Related Fix

The same pattern was applied to `handleExport` which also needed to read from multi-video segments. See `bug-export-multivideo-segments.md`.
