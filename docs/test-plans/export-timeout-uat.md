# Export Timeout Bug - E2E UAT Checklist

> **Bug:** Defensive timeout in export `finally` block is never cleared
>
> **Status:** OPEN - Tests created, fix pending
>
> **Affected File:** `apps/browser/src/components/ClipReview.tsx` (lines 460-479)

---

## Bug Summary

### Root Cause

In `handleExport()`, a 10-second defensive timeout is set in the `finally` block to force-close a stuck export modal:

```typescript
} finally {
  // BUG: This timeout is NEVER cleared
  setTimeout(() => {
    setShowExportModal(currentShowModal => {
      if (currentShowModal && !exportCancelledRef.current) {
        console.warn('[ClipReview] Export modal stuck - forcing close after timeout')
        return false // Force close
      }
      return currentShowModal
    })
  }, 10000)
}
```

### Problems

1. **Timeout ID not stored** - The `setTimeout` return value is not saved to a ref
2. **Never cleared on success** - When export completes successfully, the timeout continues running
3. **Never cleared on cancel** - When user cancels export, the timeout continues running
4. **Stale timeout interference** - Old timeouts can fire during subsequent exports

### Symptoms

- Console warning appears 10 seconds after successful export completion
- Console warning appears 10 seconds after cancelled export
- Starting a new export within 10 seconds of a previous export may have the old timeout interfere

---

## Manual E2E Test Steps

### Prerequisites

1. Run the browser app locally: `cd apps/browser && npm run dev`
2. Have a test video file ready (any golf video with 1+ shots)
3. Open browser DevTools Console to monitor warnings

### Test 1: Successful Export - Stale Timeout

**Steps to reproduce:**

1. Open the app at `http://localhost:5173`
2. Upload a golf video
3. Wait for processing to complete and shots to be detected
4. Approve at least one shot
5. Click "Export Clips"
6. Wait for export to complete successfully (modal shows success)
7. Close the export modal (click "Done" or wait for auto-close)
8. **Keep the browser console open**
9. Wait 10 seconds from when export started

**Expected behavior (AFTER FIX):**
- No console warning appears after 10 seconds
- App remains stable

**Current buggy behavior:**
- Console shows: `[ClipReview] Export modal stuck - forcing close after timeout`
- This warning should NOT appear for a successful export

### Test 2: Cancelled Export - Stale Timeout

**Steps to reproduce:**

1. Open the app
2. Upload and process a video
3. Approve at least one shot
4. Click "Export Clips"
5. While export is in progress, click "Cancel"
6. Modal should close
7. **Keep the browser console open**
8. Wait 10 seconds from when export started

**Expected behavior (AFTER FIX):**
- No console warning appears
- User can start a new export without issues

**Current buggy behavior:**
- Console shows: `[ClipReview] Export modal stuck - forcing close after timeout`
- This warning should NOT appear for a cancelled export

### Test 3: Rapid Successive Exports - Stale Timeout Interference

**Steps to reproduce:**

1. Open the app
2. Upload and process a video
3. Approve at least one shot
4. Click "Export Clips"
5. Wait for export to complete
6. Quickly click "Export Clips" again (within 10 seconds)
7. Observe the second export's behavior
8. Wait for the 10-second mark from the FIRST export

**Expected behavior (AFTER FIX):**
- Second export runs independently
- No interference from first export's timeout
- No console warnings during normal operation

**Current buggy behavior:**
- First export's timeout may fire while second export is in progress
- Could cause unexpected modal state changes
- Console warning may appear during second export

### Test 4: Legitimate Stuck Export

**Steps to reproduce (harder to reproduce):**

1. This requires simulating a network failure or process hang
2. Start an export that hangs (e.g., disconnect network during export)
3. Wait 10 seconds

**Expected behavior:**
- Console warning SHOULD appear: `[ClipReview] Export modal stuck - forcing close after timeout`
- Modal should force-close
- This is the INTENDED behavior of the defensive timeout

---

## Console Log Verification

### What to look for in the console

```
// BAD - This appears when timeout fires inappropriately:
[ClipReview] Export modal stuck - forcing close after timeout

// EXPECTED - This should ONLY appear for genuinely stuck exports
```

### Timing Analysis

| Event | Expected Warning? |
|-------|------------------|
| Export succeeds at 2s | NO warning at 10s |
| Export cancelled at 3s | NO warning at 10s |
| Export hangs (no completion) | YES warning at 10s |
| Export errors at 1s | NO warning at 10s |

---

## Automated Test Coverage

### Unit Tests Created

File: `apps/browser/src/components/ClipReview.timeout.test.tsx`

| Test | Description | Status |
|------|-------------|--------|
| `should clear defensive timeout after successful export completion` | Verifies timeout is cleared on success via `clearTimeout` | **FAILS with bug** |
| `should clear defensive timeout after export is cancelled` | Verifies timeout is cleared on cancel | Passes (but incomplete fix) |
| `should not accumulate uncleaned timeouts with successive exports` | Verifies no timeout accumulation | **FAILS with bug** |
| `documents intended defensive timeout behavior` | Documents intended behavior | Passes |

### Timeout Tracking

The tests track `setTimeout` and `clearTimeout` calls for 10-second timeouts:
- **Bug behavior:** `timeoutIds.size = 1` after export completes (timeout never cleared)
- **Fixed behavior:** `timeoutIds.size = 0` after export completes (timeout was cleared)

### Running Tests

```bash
cd apps/browser
npm test -- --run ClipReview.timeout.test.tsx
```

### Expected Results

**Before fix:**
```
FAIL: should clear defensive timeout after successful export completion
  → expected 1 to be +0 // timeout ID still in set (not cleared)

FAIL: should not accumulate uncleaned timeouts with successive exports
  → expected 1 to be +0 // timeout ID still in set (not cleared)

9 passed, 2 failed
```

**After fix:**
- All 11 tests pass
- `timeoutIds.size` is 0 after export completes or is cancelled

---

## Fix Requirements

### Code Changes Needed

1. **Store timeout ID in a ref:**
```typescript
const defensiveTimeoutRef = useRef<number | null>(null)
```

2. **Modify finally block to store timeout:**
```typescript
} finally {
  defensiveTimeoutRef.current = setTimeout(() => {
    // ... existing code ...
  }, 10000)
}
```

3. **Clear timeout on successful completion (in success branch):**
```typescript
if (!exportCancelledRef.current) {
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  setExportComplete(true)
  // ... rest of success handling
}
```

4. **Clear timeout on cancel (in cancel handler):**
```typescript
onClick={() => {
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  exportCancelledRef.current = true
  setShowExportModal(false)
}}
```

5. **Clear timeout on component unmount:**
```typescript
useEffect(() => {
  return () => {
    if (defensiveTimeoutRef.current) {
      clearTimeout(defensiveTimeoutRef.current)
    }
  }
}, [])
```

6. **Clear previous timeout when starting new export:**
```typescript
const handleExport = useCallback(async () => {
  // Clear any existing defensive timeout from previous export
  if (defensiveTimeoutRef.current) {
    clearTimeout(defensiveTimeoutRef.current)
    defensiveTimeoutRef.current = null
  }
  // ... rest of export logic
})
```

---

## Verification Checklist

### After Implementing Fix

- [ ] All unit tests in `ClipReview.timeout.test.tsx` pass
- [ ] Manual Test 1 passes (no warning after successful export)
- [ ] Manual Test 2 passes (no warning after cancelled export)
- [ ] Manual Test 3 passes (no interference between exports)
- [ ] Manual Test 4 still works (warning appears for stuck exports)
- [ ] Existing export functionality unchanged (regression tests pass)
- [ ] No console warnings during normal export flow

### Browser Console Clean

After fix, normal export flow should produce NO `[ClipReview] Export modal stuck` warnings unless there's an actual stuck modal.

---

## Related Files

- **Bug location:** `apps/browser/src/components/ClipReview.tsx` (lines 460-479)
- **Unit tests:** `apps/browser/src/components/ClipReview.timeout.test.tsx`
- **Existing export tests:** `apps/browser/src/components/ClipReview.export.test.tsx`

---

## Priority

**Medium** - The bug causes console pollution and potential state issues but doesn't crash the app.

**Impact:**
- User confusion if they see console warnings
- Potential for export modal state issues in edge cases
- Minor memory/resource leak from uncleaned timeouts
