# Bug: Export May Call onComplete Twice

**Status:** Open
**Priority:** P3
**Component:** ClipReview.tsx - Export
**Date:** 2026-02-01

## Description

The 1.5-second auto-close timer after export success is not stored or cleared. If user clicks "Done" before the timer fires, `onComplete()` may be called twice.

## Current Behavior

```typescript
if (!exportCancelledRef.current) {
  setExportComplete(true)
  // Auto-close modal after showing success for 1.5 seconds
  setTimeout(() => {
    setShowExportModal(false)
    onComplete()  // Called by timer
  }, 1500)
}
```

And the Done button handler also calls `onComplete()`:

```typescript
// Done button onClick
setShowExportModal(false)
onComplete()  // Called by button click
```

## Scenario

1. Export completes successfully
2. Success state shows with "Done" button
3. User clicks "Done" immediately (within 1.5s)
4. `onComplete()` is called (from button click)
5. 1.5s later, timer fires and calls `onComplete()` again

## Expected Behavior

`onComplete()` should only be called once, regardless of whether user waits for auto-close or clicks Done.

## Proposed Fix

Track the auto-close timer and clear it when Done is clicked:

```typescript
const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null)

// On success:
autoCloseTimerRef.current = setTimeout(() => {
  setShowExportModal(false)
  onComplete()
}, 1500)

// Done button handler:
const handleDone = () => {
  if (autoCloseTimerRef.current) {
    clearTimeout(autoCloseTimerRef.current)
    autoCloseTimerRef.current = null
  }
  setShowExportModal(false)
  onComplete()
}
```

## Files

- `apps/browser/src/components/ClipReview.tsx` - handleExport and Done button

## Risk

Low-medium - Could cause unexpected behavior in parent component if it doesn't handle duplicate calls gracefully.

## Test Gap

The existing test only verifies `onComplete` is called once immediately after clicking Done. It doesn't advance timers to check if it's called again:

```typescript
it('should allow manual close via Done button before auto-close', async () => {
  // ...
  fireEvent.click(doneButton)
  expect(onComplete).toHaveBeenCalledTimes(1)
  // Missing: vi.advanceTimersByTimeAsync(1600) to verify no second call
})
```
