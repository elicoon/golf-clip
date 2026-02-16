# Bug: Export Uses Legacy Segments Instead of Multi-Video Segments

**Status:** Fixed
**Priority:** P1
**Component:** ClipReview.tsx (handleExport)
**Date:** 2026-02-02

## Description

When exporting clips from the multi-video upload flow, the export function fetched segments from the legacy `store.segments` array instead of `store.videos.get(activeVideoId).segments`. This caused exports to either:
1. Find 0 approved segments and immediately call `onComplete()` (skipping to "Review Complete" without downloading)
2. Export the wrong segments if legacy array had stale data

## Root Cause

In `handleExport`, line 430-431 originally read:

```typescript
const currentSegments = useProcessingStore.getState().segments
const approved = currentSegments.filter(s => s.approved === 'approved')
```

This only checked the legacy segments array, not the multi-video segments stored in the `videos` Map.

## Affected Flow

1. User uploads video via multi-video flow
2. Approves a shot (stored in `videos.get(activeVideoId).segments`)
3. Clicks "Export 1 Clip"
4. `handleExport` reads from legacy `segments` (empty)
5. Finds 0 approved → calls `onComplete()` immediately
6. User sees "Review Complete! 1 shots approved" but no download

## Fix

Updated `handleExport` to check multi-video segments first:

```typescript
const store = useProcessingStore.getState()
const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
const currentSegments = activeVid?.segments ?? store.segments
const approved = currentSegments.filter(s => s.approved === 'approved')
```

## Files

- `apps/browser/src/components/ClipReview.tsx` - handleExport function

## Related

- `bug-clipreview-legacy-segments.md` - Similar issue with segment reading during review
- The fix pattern is consistent: always check `activeVideo?.segments ?? legacySegments`

## Test Gap

- No tests for export with multi-video flow
- Need integration test: multi-video upload → approve → export → verify download triggered
