# Export Timeout Cleanup Fix - Actual Implementation

**Date:** 2026-02-01
**Branch:** `fix/export-timeout-cleanup`
**Status:** Complete

## Problem

The 10-second defensive timeout in the export `finally` block was never stored in a ref and never cleared. This caused:
1. Resource leak (timeout stays in event loop)
2. Potential race conditions
3. Stale timeouts from previous exports could interfere with subsequent exports
4. Tests failing expecting proper timeout cleanup

## Solution

Added proper timeout lifecycle management:

### 1. Added Ref to Store Timeout ID
```typescript
const defensiveTimeoutRef = useRef<number | null>(null)
```

### 2. Store Timeout ID in Finally Block
```typescript
defensiveTimeoutRef.current = window.setTimeout(() => {
  // ... defensive timeout logic
  defensiveTimeoutRef.current = null  // Clear after running
}, 10000)
```

### 3. Clear Timeout on Success (Auto-Close)
The auto-close setTimeout (1.5s after success) now clears the defensive timeout:
```typescript
setTimeout(() => {
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  setShowExportModal(false)
  onComplete()
}, 1500)
```

### 4. Clear Timeout on Cancel (Both Cancel Buttons)
```typescript
onClick={() => {
  exportCancelledRef.current = true
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  setShowExportModal(false)
}}
```

### 5. Clear Timeout on Done Button Click (Both Done Buttons)
```typescript
onClick={() => {
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  setShowExportModal(false)
  onComplete()
}}
```

### 6. Cleanup on Component Unmount
```typescript
useEffect(() => {
  return () => {
    if (defensiveTimeoutRef.current) {
      clearTimeout(defensiveTimeoutRef.current)
    }
  }
}, [])
```

### 7. Clear Before Setting New Timeout in Finally
The finally block now clears any existing timeout before setting a new one:
```typescript
finally {
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  // Only set defensive timeout if not cancelled
  if (!exportCancelledRef.current) {
    defensiveTimeoutRef.current = window.setTimeout(...)
  }
}
```

## Files Changed

- `apps/browser/src/components/ClipReview.tsx`
  - Added `defensiveTimeoutRef` ref
  - Added cleanup useEffect
  - Updated finally block to store and clear timeout
  - Updated auto-close timeout to clear defensive timeout
  - Updated both Cancel buttons to clear timeout
  - Updated both Done buttons to clear timeout

## Verification

- TypeScript check passes: `npx tsc --noEmit`
- All 11 ClipReview timeout tests pass
- All 125 ClipReview tests pass (no regressions)

## Key Insight

The original implementation had the clearing logic in the wrong place. Since `finally` always runs AFTER `try`, we can't clear the timeout in the `try` block before it's set. Instead, we need to clear the timeout:
1. When the modal auto-closes on success (1.5s timeout callback)
2. When user clicks Cancel
3. When user clicks Done
4. When component unmounts
5. Before setting a new defensive timeout in finally (prevents accumulation)
