# Bug Analysis: Export May Call onComplete Twice

**Date:** 2026-02-01
**File:** `packages/frontend/src/components/ClipReview.tsx`
**Status:** Bug NOT confirmed in current code

---

## Summary

The reported bug states that a 1.5-second auto-close timer after export success is not stored or cleared, potentially causing `onComplete()` to be called twice if the user clicks "Done" before the timer fires.

**Finding:** After thorough analysis, **no such auto-close timer exists in the current codebase**. The export modal remains open until the user explicitly clicks the "Done" button.

---

## Code Analysis

### Export Modal Flow

The export modal is controlled by two state variables:
- `showExportModal` (boolean) - Controls modal visibility
- `exportProgress` (ExportProgress | null) - Tracks export status and data

**Relevant code locations:**

1. **Modal state initialization** (lines 57-58):
   ```typescript
   const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
   const [showExportModal, setShowExportModal] = useState(false)
   ```

2. **Export completion handler** (lines 634-639):
   ```typescript
   const handleExportComplete = () => {
     const exported = exportProgress?.exported || []
     setShowExportModal(false)
     setExportProgress(null)
     onComplete(exported)
   }
   ```

3. **Done button in modal** (lines 1127-1132):
   ```typescript
   <button
     onClick={handleExportComplete}
     className="btn-primary btn-large"
   >
     Done
   </button>
   ```

4. **Poll completion** (lines 614-617):
   ```typescript
   if (status.status === 'complete' || status.status === 'error') {
     setLoadingState('idle')
     // Keep modal open to show results
     return
   }
   ```

### Existing Timers in the File

I searched for all `setTimeout` usages. There are only three, none related to auto-closing the export modal:

| Location | Purpose |
|----------|---------|
| Line 220 | Auto-loop video playback (750ms pause before restart) |
| Line 249 | Auto-play clip on video load (100ms delay) |
| Line 856 | Auto-trigger trajectory generation after marking landing (200ms delay) |

---

## Conclusion

**The reported bug does not exist in the current codebase.**

The export modal:
1. Opens when `exportClips()` is called
2. Polls for status updates until complete
3. Shows results when export finishes
4. Remains open indefinitely until user clicks "Done"
5. `onComplete()` is called exactly once when "Done" is clicked

### Possible Explanations

1. **Planned feature not yet implemented:** The auto-close timer may have been planned but never added.
2. **Removed in a previous commit:** The timer may have existed and been removed (no evidence in recent commits).
3. **Different component:** The bug may exist in a different component not yet written.
4. **Future consideration:** This analysis documents that if an auto-close timer is added, it must:
   - Store the timer ID in a ref
   - Clear the timer when "Done" is clicked
   - Clear the timer on component unmount

---

## Recommended Pattern (If Timer Is Added)

If an auto-close feature is implemented in the future, here's the correct pattern to avoid double-calling `onComplete()`:

```typescript
// Add a ref to store the timer ID
const autoCloseTimerRef = useRef<number | null>(null)

// In the poll completion or useEffect when export completes
if (status.status === 'complete') {
  setLoadingState('idle')
  // Auto-close after 1.5 seconds
  autoCloseTimerRef.current = window.setTimeout(() => {
    handleExportComplete()
  }, 1500)
}

// Update handleExportComplete to clear the timer
const handleExportComplete = () => {
  // Clear the auto-close timer if it exists
  if (autoCloseTimerRef.current) {
    clearTimeout(autoCloseTimerRef.current)
    autoCloseTimerRef.current = null
  }
  const exported = exportProgress?.exported || []
  setShowExportModal(false)
  setExportProgress(null)
  onComplete(exported)
}

// Clean up on unmount (add to existing cleanup effect)
useEffect(() => {
  return () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current)
    }
  }
}, [])
```

---

## Files Investigated

| File | Relevant Lines |
|------|----------------|
| `packages/frontend/src/components/ClipReview.tsx` | 57-58, 536-632, 634-639, 1073-1159 |

---

## Verdict

**No fix needed** - the bug as described does not exist in the current implementation. The export modal has no auto-close timer, so there is no race condition between a timer and user click.

If this bug report was created in anticipation of adding an auto-close feature, the recommended pattern above should be followed to prevent the issue.
