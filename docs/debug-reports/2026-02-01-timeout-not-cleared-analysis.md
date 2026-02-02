# Debug Analysis: Export Defensive Timeout Not Cleared on Success

**Date:** 2026-02-01
**Status:** Analysis Complete
**File:** `apps/browser/src/components/ClipReview.tsx`

## Problem Summary

The 10-second defensive timeout in the export `finally` block runs unconditionally, even on successful exports. The timeout is never cleared when export completes normally.

## Code Location

**File:** `apps/browser/src/components/ClipReview.tsx`
**Function:** `handleExport` (lines 374-480)
**Defensive Timeout:** Lines 460-479

### Relevant Code Block

```typescript
// Lines 374-480 in handleExport:
const handleExport = useCallback(async () => {
  // ... setup code (lines 374-388) ...

  try {
    // ... export logic (lines 389-457) ...

    if (!exportCancelledRef.current) {
      setExportComplete(true)
      // Auto-close modal after showing success for 1.5 seconds
      setTimeout(() => {
        setShowExportModal(false)
        onComplete()
      }, 1500)
    }
  } catch (error) {
    setExportError(error instanceof Error ? error.message : 'An error occurred during export')
  } finally {
    // BUG: This timeout is set UNCONDITIONALLY in finally block
    // It is never cleared on success, cancel, or error
    setTimeout(() => {
      setShowExportModal(currentShowModal => {
        if (currentShowModal && !exportCancelledRef.current) {
          console.warn('[ClipReview] Export modal stuck - forcing close after timeout')
          return false // Force close
        }
        return currentShowModal
      })
    }, 10000)  // 10 second timeout
  }
}, [onComplete, exportSegmentWithTracer])
```

## Detailed Analysis

### When the Timeout is Set

The defensive timeout is set in the `finally` block, which means it executes in **all cases**:
1. **Success path:** Export completes normally, `setExportComplete(true)` is called, 1.5s auto-close timeout starts, AND the 10s defensive timeout also starts
2. **Error path:** `setExportError()` is called, AND the 10s defensive timeout starts
3. **Cancel path:** User clicks Cancel, `exportCancelledRef.current` is set to true, modal closes, AND the 10s defensive timeout starts
4. **HEVC error path:** Export aborts early and returns (line 440), but `finally` still runs

### When the Timeout Should Run

The defensive timeout should **only** run as a safety net for edge cases where the modal gets stuck. It should **not** run when:
- Export completes successfully (line 451-456)
- Export is cancelled by user (line 396 check + line 879 cancel handler)
- Export encounters an error (line 459)

### Current Behavior Timeline (Success Case)

```
T+0ms:     Export starts, modal opens
T+varies:  Downloads complete
T+varies:  setExportComplete(true) called
T+varies:  1.5s success timer starts
T+varies:  finally block runs -> 10s defensive timer starts
T+1500ms:  Success timer fires -> modal closes, onComplete() called
T+10000ms: Defensive timer fires -> setShowExportModal() called on already-closed modal
```

### Risk of Stale Timeouts

1. **Scenario 1: Rapid successive exports**
   - User completes export successfully at T=0
   - 1.5s later: modal closes, user starts new export
   - 10s from first export: stale timeout fires
   - If new export modal is open: it may be incorrectly closed
   - The functional update `currentShowModal => ...` provides SOME protection but not complete

2. **Scenario 2: Cancel then re-export**
   - User cancels export at T=0
   - `exportCancelledRef.current = true`
   - User immediately starts new export
   - `exportCancelledRef.current = false` (reset at line 387)
   - 10s from cancelled export: stale timeout fires
   - Since `exportCancelledRef.current` is now false, the modal could be force-closed

3. **Scenario 3: Memory/reference issues**
   - Multiple timeouts accumulating if user rapidly opens/closes export
   - Each `handleExport` call creates a new timeout via the `finally` block
   - Old timeouts reference old closures but setShowExportModal is stable

## Required Fix

### 1. Add a Timeout Ref

```typescript
// Add near line 54 with other refs
const defensiveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
```

### 2. Clear Timeout on Success

```typescript
// In the success path (around line 451)
if (!exportCancelledRef.current) {
  setExportComplete(true)
  // Clear defensive timeout on success - no longer needed
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  // Auto-close modal after showing success for 1.5 seconds
  setTimeout(() => {
    setShowExportModal(false)
    onComplete()
  }, 1500)
}
```

### 3. Clear Timeout on Cancel

```typescript
// When user clicks cancel (modal button onClick handlers)
onClick={() => {
  exportCancelledRef.current = true
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  setShowExportModal(false)
}}
```

### 4. Store Timeout ID in Finally Block

```typescript
} finally {
  // Store timeout ID so it can be cleared if export completes normally
  defensiveTimeoutRef.current = setTimeout(() => {
    setShowExportModal(currentShowModal => {
      if (currentShowModal && !exportCancelledRef.current) {
        console.warn('[ClipReview] Export modal stuck - forcing close after timeout')
        return false
      }
      return currentShowModal
    })
  }, 10000)
}
```

### 5. Clear on Component Unmount (Optional but Recommended)

```typescript
// Add cleanup in an existing useEffect or new one
useEffect(() => {
  return () => {
    if (defensiveTimeoutRef.current) {
      clearTimeout(defensiveTimeoutRef.current)
    }
  }
}, [])
```

## Files Affected

- `apps/browser/src/components/ClipReview.tsx` - Primary fix location

## Risk Assessment

**Current Risk Level:** Low
- The functional state update `currentShowModal => ...` provides some protection
- The `exportCancelledRef.current` check filters out cancelled exports
- However, rapid successive exports or cancel-then-export could still cause issues

**Fix Complexity:** Low
- Add 1 ref
- Add 3-4 clearTimeout calls
- No architectural changes needed

## Additional Notes

1. The bug was already documented in `docs/bugs/bug-export-timeout-not-cleared.md`
2. There are TWO ClipReview.tsx files in the codebase:
   - `packages/frontend/src/components/ClipReview.tsx` - Does NOT have this bug (uses polling instead)
   - `apps/browser/src/components/ClipReview.tsx` - HAS the bug (uses finally block timeout)
3. The two files have diverged significantly in implementation approach
