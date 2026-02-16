# Auto-Approve High-Confidence Shots Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where high-confidence shots remain 'pending' and are excluded from export by auto-approving them at detection time.

**Architecture:** When segments are added to the processing store, high-confidence shots (>= 0.7) should be automatically marked as 'approved' since they skip the review queue. This ensures they are included when the export phase filters for approved shots.

**Tech Stack:** TypeScript, Zustand, Vitest

---

## Problem Summary

**Root Cause Chain:**
1. ClipReview.tsx line 92 filters shots for review: `segments.filter(s => s.confidence < 0.7 && s.approved === 'pending')`
2. High-confidence shots (>= 0.7) are excluded from review but remain `'pending'`
3. Export (line 376) filters for approved: `currentSegments.filter(s => s.approved === 'approved')`
4. Result: High-confidence shots silently discarded from export

**Fix:** In `processingStore.ts` line 107, auto-approve high-confidence shots when they are added:
```typescript
approved: segment.approved ?? (segment.confidence >= 0.7 ? 'approved' : 'pending'),
```

---

### Task 1: Write Failing Test for Auto-Approval

**Files:**
- Create: `apps/browser/src/stores/processingStore.test.ts`

**Step 1.1: Create the test file with failing test**

```typescript
/**
 * Processing Store Tests
 *
 * Tests for the Zustand processing store, particularly segment management
 * and the auto-approval logic for high-confidence shots.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useProcessingStore } from './processingStore'

describe('processingStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useProcessingStore.getState().reset()
  })

  describe('addSegment', () => {
    it('should auto-approve high-confidence segments (>= 0.7)', () => {
      const store = useProcessingStore.getState()

      // Create a mock blob and object URL
      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-high-conf'

      store.addSegment({
        id: 'segment-high-conf',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.75,  // High confidence - should auto-approve
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('approved')
    })

    it('should leave low-confidence segments as pending (< 0.7)', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-low-conf'

      store.addSegment({
        id: 'segment-low-conf',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.5,  // Low confidence - should remain pending
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('pending')
    })

    it('should leave boundary confidence (0.7) as approved', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-boundary'

      store.addSegment({
        id: 'segment-boundary',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.7,  // Exactly at threshold - should auto-approve
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('approved')
    })

    it('should respect explicitly passed approved status', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-explicit'

      // Explicitly pass 'rejected' even though confidence is high
      store.addSegment({
        id: 'segment-explicit',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        confidence: 0.9,
        approved: 'rejected',  // Explicit status should be preserved
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].approved).toBe('rejected')
    })

    it('should default confidence to 0.5 when not provided', () => {
      const store = useProcessingStore.getState()

      const mockBlob = new Blob(['test'], { type: 'video/webm' })
      const mockObjectUrl = 'blob:http://localhost/mock-no-conf'

      store.addSegment({
        id: 'segment-no-conf',
        strikeTime: 5.0,
        startTime: 3.0,
        endTime: 8.0,
        blob: mockBlob,
        objectUrl: mockObjectUrl,
        // No confidence provided - defaults to 0.5, so should be pending
      })

      const segments = useProcessingStore.getState().segments
      expect(segments).toHaveLength(1)
      expect(segments[0].confidence).toBe(0.5)
      expect(segments[0].approved).toBe('pending')
    })
  })
})
```

**Step 1.2: Run test to verify it fails**

Run: `cd apps/browser && npm test -- --run processingStore.test.ts`

Expected: FAIL - First test should fail with assertion error:
```
expect(received).toBe(expected)
Expected: "approved"
Received: "pending"
```

**Step 1.3: Commit the failing test**

```bash
git add apps/browser/src/stores/processingStore.test.ts
git commit -m "test(store): add failing tests for auto-approval of high-confidence shots

Tests verify that segments with confidence >= 0.7 should be auto-approved
when added to the store, rather than remaining 'pending'.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Implement Auto-Approval Logic

**Files:**
- Modify: `apps/browser/src/stores/processingStore.ts` (line 107)

**Step 2.1: Update addSegment to auto-approve high-confidence shots**

In `apps/browser/src/stores/processingStore.ts`, change line 107 from:

```typescript
approved: segment.approved ?? 'pending',
```

To:

```typescript
approved: segment.approved ?? ((segment.confidence ?? 0.5) >= 0.7 ? 'approved' : 'pending'),
```

Note: We use `(segment.confidence ?? 0.5)` to handle the case where confidence is not provided, matching the default on line 104.

**Step 2.2: Run tests to verify they pass**

Run: `cd apps/browser && npm test -- --run processingStore.test.ts`

Expected: PASS - All 5 tests should pass

**Step 2.3: Run full test suite to check for regressions**

Run: `cd apps/browser && npm test -- --run`

Expected: All tests pass. No regressions.

**Step 2.4: Commit the implementation**

```bash
git add apps/browser/src/stores/processingStore.ts
git commit -m "fix(store): auto-approve high-confidence shots at detection time

High-confidence shots (>= 0.7) were being excluded from review but
remained 'pending', causing them to be silently dropped from export.

Now segments with confidence >= 0.7 are automatically marked 'approved'
when added to the store, ensuring they are included in the export.

Fixes: no-export-after-review bug

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Manual Verification

**Step 3.1: Start the dev server**

Run: `cd apps/browser && npm run dev`

**Step 3.2: Test the fix manually**

1. Open browser to http://localhost:5173
2. Upload a golf video
3. Wait for processing to complete
4. Observe: If high-confidence shots were detected, they should now be counted in the export screen
5. Click "Export N Clips" button
6. Verify: Downloads should start for all approved clips (including auto-approved high-confidence ones)

**Step 3.3: Document verification evidence**

Take screenshot showing:
- Export button showing correct count of clips
- Browser downloads showing exported files

---

### Task 4: Update Bug Documentation

**Files:**
- Modify: `docs/bugs/bug-no-export-after-review.md`

**Step 4.1: Update the bug file to mark it resolved**

Update the file to include resolution details:

```markdown
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

## Resolution

Auto-approve high-confidence shots at detection time in `processingStore.ts`:

```typescript
// Line 107: Auto-approve high-confidence shots since they skip review
approved: segment.approved ?? ((segment.confidence ?? 0.5) >= 0.7 ? 'approved' : 'pending'),
```

## Test Coverage

- `apps/browser/src/stores/processingStore.test.ts` - Unit tests for auto-approval logic

## Files Modified

- `apps/browser/src/stores/processingStore.ts` - Added auto-approval logic
- `apps/browser/src/stores/processingStore.test.ts` - Added test coverage
```

**Step 4.2: Commit documentation update**

```bash
git add docs/bugs/bug-no-export-after-review.md
git commit -m "docs: mark no-export-after-review bug as resolved

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Write failing tests | `processingStore.test.ts` (new) |
| 2 | Implement auto-approval | `processingStore.ts` (line 107) |
| 3 | Manual verification | Dev server testing |
| 4 | Update bug docs | `bug-no-export-after-review.md` |

**Total estimated time:** 15-20 minutes

**Threshold constant:** The 0.7 threshold matches the existing logic in `ClipReview.tsx` line 92:
```typescript
const shotsNeedingReview = segments.filter(s => s.confidence < 0.7 && s.approved === 'pending')
```

Consider extracting this to a shared constant in a future refactor to keep both locations in sync.
