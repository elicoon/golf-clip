# Code Review: Export Timeout Cleanup Fix

## Summary

The branch `fix/export-timeout-cleanup` currently points to the same commit as `master` (a8868ce) - there are **no changes to review**. The related export timeout fix was previously merged in commit `c0068b1`, but it introduces a new bug: the defensive timeout is never stored or cleared, causing resource leaks. Tests in `ClipReview.timeout.test.tsx` explicitly document this bug and are **designed to fail** until a fix is implemented.

## Changes Reviewed

**Branch state:** No diff from master (branch was created from HEAD after merge)

**Related merged commit (c0068b1):**
- `apps/browser/src/components/ClipReview.tsx` - Added 10-second defensive timeout in `finally` block
- `apps/browser/src/lib/video-frame-pipeline.ts` - Added fallback progress interval during extraction
- `apps/browser/src/lib/video-frame-pipeline.test.ts` - Added tests for progress fallback
- `apps/browser/src/styles/global.css` - Added indeterminate progress bar animation

## Findings

### Issues (Must Fix)

- [ ] **No changes on branch**: The branch `fix/export-timeout-cleanup` has no commits ahead of master. The branch was created from HEAD after the previous merge and contains no fix for the timeout cleanup bug.

- [ ] **Timeout ID never stored (in merged code)**: In `ClipReview.tsx` lines 460-479, the defensive timeout is set with `setTimeout()` but the returned ID is never stored in a ref:
  ```typescript
  // CURRENT (BUGGY):
  finally {
    setTimeout(() => {
      // ... force close logic
    }, 10000)  // ID is discarded!
  }
  ```

- [ ] **Timeout never cleared on success/cancel**: Without storing the timeout ID, it cannot be cleared when:
  - Export completes successfully (modal closes via auto-close)
  - User clicks "Done" button
  - User cancels export
  - Component unmounts

- [ ] **Failing tests document the bug**: `ClipReview.timeout.test.tsx` has 2 failing tests that explicitly verify the timeout cleanup requirement:
  - `should clear defensive timeout after successful export completion` - **FAILS**
  - `should not accumulate uncleaned timeouts with successive exports` - **FAILS**

### Suggestions (Nice to Have)

- [ ] **Store timeout in ref**: Create `defensiveTimeoutRef = useRef<NodeJS.Timeout | null>(null)` and store the timeout ID
- [ ] **Clear on completion**: Add `clearTimeout(defensiveTimeoutRef.current)` in the success path before `setExportComplete(true)`
- [ ] **Clear on cancel**: Clear timeout when `exportCancelledRef.current` is set
- [ ] **Clear on unmount**: Add cleanup in a `useEffect` return function
- [ ] **Clear previous on new export**: At start of `handleExport`, clear any existing defensive timeout

### Approved Items

- [x] **Fallback progress interval**: The `video-frame-pipeline.ts` change correctly uses `setInterval` for fallback progress and properly clears it with `clearInterval(fallbackInterval)` on both success and error paths
- [x] **Progress reporting order**: The encoding phase now correctly reports 100% before reading result and reports completion before cleanup
- [x] **Indeterminate progress UI**: CSS animation for indeterminate state is clean
- [x] **Test coverage for progress**: New tests verify progress fallback and 100% completion

## Test Results

```
TypeScript: PASS (no errors)

Tests:
- video-frame-pipeline.test.ts: 8 tests PASS
- ClipReview.timeout.test.tsx: 11 tests, 2 FAILED
  - FAIL: should clear defensive timeout after successful export completion
  - FAIL: should not accumulate uncleaned timeouts with successive exports
- processingStore.test.ts: 5 tests, 2 FAILED (unrelated - auto-approval logic)
```

## Required Fix

The fix should:

1. Add a ref to store the defensive timeout ID:
```typescript
const defensiveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
```

2. Store the timeout ID when setting it:
```typescript
finally {
  defensiveTimeoutRef.current = setTimeout(() => {
    // ... existing logic
  }, 10000)
}
```

3. Clear timeout in all exit paths:
```typescript
// On success (before setExportComplete):
if (defensiveTimeoutRef.current) {
  clearTimeout(defensiveTimeoutRef.current)
  defensiveTimeoutRef.current = null
}

// On cancel:
// Add similar cleanup to cancel handler

// On unmount (in useEffect):
return () => {
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
  }
}
```

4. Clear previous timeout when starting new export:
```typescript
// At start of handleExport:
if (defensiveTimeoutRef.current) {
  clearTimeout(defensiveTimeoutRef.current)
  defensiveTimeoutRef.current = null
}
```

## Verdict

**BLOCKED** - No changes to review. The branch needs commits that implement the timeout cleanup fix. The merged code (c0068b1) introduces a resource leak that must be addressed.

---

**Reviewed by:** Claude Opus 4.5
**Date:** 2026-02-01
**Branch:** fix/export-timeout-cleanup
**Base:** master (a8868ce)
