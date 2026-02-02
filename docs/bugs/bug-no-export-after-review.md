# Bug: No Download/Export Option After Review Complete

**Status:** Resolved
**Priority:** P1
**Component:** processingStore.ts
**Date:** 2026-01-30
**Resolved:** 2026-02-01

## Description

After approving the last shot, the review complete screen shows but no export happens. The user sees "All shots have been reviewed!" but cannot download their clips.

## Root Cause

High-confidence shots (>= 0.7) were excluded from the review queue (ClipReview.tsx line 92) but remained in 'pending' status. The export function (line 376) only exports 'approved' shots, so high-confidence shots were silently discarded.

**Root Cause Chain:**
1. ClipReview.tsx line 92 filters shots for review: `segments.filter(s => s.confidence < 0.7 && s.approved === 'pending')`
2. High-confidence shots (>= 0.7) are excluded from review but remain `'pending'`
3. Export (line 376) filters for approved: `currentSegments.filter(s => s.approved === 'approved')`
4. Result: High-confidence shots silently discarded from export

## Resolution

Auto-approve high-confidence shots at detection time in `processingStore.ts`:

```typescript
// Line 161: Auto-approve high-confidence shots since they skip review
approved: segment.approved ?? ((segment.confidence ?? 0.5) >= 0.7 ? 'approved' : 'pending'),
```

This ensures high-confidence shots are marked as 'approved' when added to the store, so they are included in the export without requiring manual review.

## Test Coverage

- `apps/browser/src/stores/processingStore.test.ts` - Unit tests for auto-approval logic
- `apps/browser/src/components/ClipReview.export.test.tsx` - Integration tests for export with mixed confidence shots

## Files Modified

- `apps/browser/src/stores/processingStore.ts` - Added auto-approval logic
- `apps/browser/src/stores/processingStore.test.ts` - Added test coverage (new file)
- `apps/browser/src/components/ClipReview.export.test.tsx` - Updated tests to reflect fixed behavior
