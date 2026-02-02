# Bug: Export Defensive Timeout Not Cleared on Success

**Status:** Open
**Priority:** P3
**Component:** ClipReview.tsx - Export
**Date:** 2026-02-01

## Description

The 10-second defensive timeout in the export `finally` block runs unconditionally, even on successful exports. The timeout is never cleared when export completes normally.

## Current Behavior

```typescript
} finally {
  setTimeout(() => {
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

1. Export completes successfully
2. Modal auto-closes after 1.5s
3. 10-second timeout still runs in background
4. If user starts new export within 10 seconds, the old timeout could interfere

## Expected Behavior

The defensive timeout should be cleared when export completes successfully or is cancelled.

## Proposed Fix

Track the timeout ID and clear it on success:

```typescript
const defensiveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

// In handleExport:
try {
  // ... export logic
  if (!exportCancelledRef.current) {
    setExportComplete(true)
    // Clear defensive timeout on success
    if (defensiveTimeoutRef.current) {
      clearTimeout(defensiveTimeoutRef.current)
      defensiveTimeoutRef.current = null
    }
    setTimeout(() => {
      setShowExportModal(false)
      onComplete()
    }, 1500)
  }
} finally {
  defensiveTimeoutRef.current = setTimeout(() => { ... }, 10000)
}
```

## Files

- `apps/browser/src/components/ClipReview.tsx` - handleExport function

## Risk

Low - The functional state update in the timeout already guards against most issues. This is a cleanup improvement.
