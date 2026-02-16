# Export Timeout Not Cleared Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the defensive timeout in export finally block that runs unconditionally and is never cleared on success.

**Architecture:** Add a ref to store the timeout ID, clear it on successful completion, on cancel, and on component unmount.

**Tech Stack:** React, TypeScript

---

## Background

### Root Cause Analysis (from debug report)

The 10-second defensive timeout in the export `finally` block runs unconditionally, even on successful exports:

```typescript
// apps/browser/src/components/ClipReview.tsx lines 460-479
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

**Problems:**
1. Timeout is never stored/tracked
2. Timeout is never cleared on success
3. Timeout is never cleared on cancel
4. Stale timeouts can interfere with rapid successive exports

---

## Task 1: Add Defensive Timeout Ref

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Add ref for timeout ID**

Find the other refs near the top of the component (around line 54) and add:

```typescript
const defensiveTimeoutRef = useRef<number | null>(null)
```

---

## Task 2: Store Timeout ID in Finally Block

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Update finally block to store timeout**

Find the finally block in `handleExport` (around line 460-479) and change from:

```typescript
} finally {
  setTimeout(() => {
    // ...
  }, 10000)
}
```

To:

```typescript
} finally {
  defensiveTimeoutRef.current = window.setTimeout(() => {
    setShowExportModal(currentShowModal => {
      if (currentShowModal && !exportCancelledRef.current) {
        console.warn('[ClipReview] Export modal stuck - forcing close after timeout')
        return false
      }
      return currentShowModal
    })
    defensiveTimeoutRef.current = null
  }, 10000)
}
```

---

## Task 3: Clear Timeout on Success

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Clear timeout before auto-close**

Find the success path in `handleExport` (around line 451-456):

```typescript
if (!exportCancelledRef.current) {
  setExportComplete(true)
  // Auto-close modal after showing success for 1.5 seconds
  setTimeout(() => {
    setShowExportModal(false)
    onComplete()
  }, 1500)
}
```

Add timeout clearing:

```typescript
if (!exportCancelledRef.current) {
  setExportComplete(true)
  // Clear defensive timeout - export succeeded
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

---

## Task 4: Clear Timeout on Cancel

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Find cancel handler**

Search for where `exportCancelledRef.current = true` is set (likely in modal cancel button onClick).

**Step 2: Add timeout clearing**

Add before setting `exportCancelledRef.current = true`:

```typescript
// Clear defensive timeout on cancel
if (defensiveTimeoutRef.current) {
  clearTimeout(defensiveTimeoutRef.current)
  defensiveTimeoutRef.current = null
}
exportCancelledRef.current = true
setShowExportModal(false)
```

---

## Task 5: Clear Timeout on Unmount

**Files:**
- Modify: `apps/browser/src/components/ClipReview.tsx`

**Step 1: Add cleanup effect**

Add a useEffect for cleanup (or add to existing cleanup effect if one exists):

```typescript
useEffect(() => {
  return () => {
    if (defensiveTimeoutRef.current) {
      clearTimeout(defensiveTimeoutRef.current)
    }
  }
}, [])
```

---

## Testing Verification

1. **Unit test:** Run existing tests with `vi.useFakeTimers()` to verify:
   - Timeout is cleared on success (no console.warn after 10s)
   - Timeout is cleared on cancel
   - Rapid successive exports don't have stale timeout interference

2. **Manual test:**
   - Complete export, open console, wait 10+ seconds
   - Verify no "Export modal stuck" warning appears
   - Complete export, immediately start new export
   - Verify no interference from old timeout

---

## Risk Assessment

**Risk Level:** Low
- Simple ref + clearTimeout pattern
- No architectural changes
- Existing functional state update provides baseline protection

**Potential Issues:**
- Need to verify all cancel paths clear the timeout
- TypeScript type for timeout ID (use `number` for browser)
