# Code Review: 2026-01-25 Agent Changes

## Overview
Review of uncommitted changes for multi-video upload, auto-loop functionality, two-pass encoding, and detection improvements.

**Files Reviewed:**
- Backend: `routes.py`, `schemas.py`, `color_family.py`, `early_tracker.py`, `clips.py`, `tracer.py`
- Frontend: `App.tsx`, `ClipReview.tsx`, `TrajectoryEditor.tsx`, `VideoDropzone.tsx`, `appStore.ts`
- Tests: `test_trajectory_generate_sse.py`
- Styles: `global.css`

---

## Critical Issues (Must Fix)

### 1. Security: Missing File Extension Validation in Batch Upload
**File:** `/Users/ecoon/golf-clip/src/backend/api/routes.py`
**Line:** 177-180

**Issue:** The filename is not sanitized beyond extension check. A malicious filename like `../../../etc/passwd.mp4` could potentially cause path traversal issues when combined with the upload directory.

**Current Code:**
```python
safe_filename = f"{unique_id}_{filename}"
file_path = _UPLOAD_DIR / safe_filename
```

**Recommendation:** Sanitize the filename to remove path separators and special characters:
```python
import re
# Sanitize filename to prevent path traversal
clean_filename = re.sub(r'[^\w\-_\. ]', '', Path(filename).name)
if not clean_filename:
    clean_filename = "video"
safe_filename = f"{unique_id}_{clean_filename}"
```

---

### 2. Bug: Race Condition in EventSource Cleanup
**File:** `/Users/ecoon/golf-clip/src/frontend/src/components/ClipReview.tsx`
**Line:** 500-505

**Issue:** The comment references `generateTrajectorySSE` which was removed, but `eventSourceRef.current` is still used. If `generateTrajectoryWithConfig` is called rapidly, there's a potential race where the old EventSource could fire events after being "closed" if the close() doesn't complete before the callback fires.

**Current Code:**
```typescript
// Note: Legacy generateTrajectorySSE was removed as it was replaced by
// generateTrajectoryWithConfig which uses the full configuration options
```

**Recommendation:** Add a flag to track whether results should be ignored:
```typescript
const generationIdRef = useRef(0)

const generateTrajectoryWithConfig = useCallback(() => {
  const currentGenId = ++generationIdRef.current
  // ... in event handlers, check:
  if (generationIdRef.current !== currentGenId) return // stale
  // ... proceed with update
}, [])
```

---

### 3. Bug: Timeout Not Cleaned Up on Component Unmount
**File:** `/Users/ecoon/golf-clip/src/frontend/src/components/ClipReview.tsx`
**Line:** 176-195

**Issue:** The auto-play effect creates a timeout (`startAutoPlay`) but uses a different cleanup pattern than the loop timeout. Both should be refs for proper cleanup.

**Current Code:**
```typescript
useEffect(() => {
  const startAutoPlay = setTimeout(() => {
    // ...
  }, 100)
  return () => clearTimeout(startAutoPlay)
}, [videoLoaded, currentShot?.id, autoLoopEnabled])
```

**Recommendation:** This is actually correctly handled with the local variable and cleanup, so this is a false positive. However, the pattern is inconsistent with `loopPauseTimeoutRef`. Consider unifying the approach:
```typescript
const autoPlayTimeoutRef = useRef<number | null>(null)
// Use ref consistently for both timeouts
```

---

### 4. Bug: Memory Leak in VideoDropzone XHR Handlers
**File:** `/Users/ecoon/golf-clip/src/frontend/src/components/VideoDropzone.tsx`
**Line:** 75-110

**Issue:** The Promise returned by `uploadSingleFile` captures the `setUploadStates` function, but there's no abort mechanism. If the component unmounts during upload, the state updates will fail silently or cause React warnings.

**Current Code:**
```typescript
const uploadSingleFile = async (file: File, index: number): Promise<UploadedFile | null> => {
  // ... XHR without cleanup
}
```

**Recommendation:** Add an AbortController or track mounted state:
```typescript
const abortControllerRef = useRef<AbortController | null>(null)

useEffect(() => {
  return () => {
    abortControllerRef.current?.abort()
  }
}, [])

// In uploadSingleFile, check if aborted before state updates
```

---

## Warnings (Should Fix)

### 5. Potential Null Pointer in advanceQueue
**File:** `/Users/ecoon/golf-clip/src/frontend/src/stores/appStore.ts`
**Line:** 125-127

**Issue:** `advanceQueue` doesn't return anything meaningful when called at the end of the queue, and callers might not check bounds properly.

**Current Code:**
```typescript
advanceQueue: () => set((state) => ({
  currentQueueIndex: Math.min(state.currentQueueIndex + 1, state.videoQueue.length),
})),
```

**Issue Detail:** When `currentQueueIndex + 1 === videoQueue.length`, the index will equal `length` (out of bounds for array access). The `getCurrentQueueVideo` handles this, but direct array access in `App.tsx` could fail.

**Recommendation:** Use `videoQueue.length - 1` as the max:
```typescript
advanceQueue: () => set((state) => ({
  currentQueueIndex: Math.min(state.currentQueueIndex + 1, state.videoQueue.length - 1),
})),
```

Or ensure all callers check `hasMoreVideos` before calling (which App.tsx does).

---

### 6. Missing Error Boundary for Queue Operations
**File:** `/Users/ecoon/golf-clip/src/frontend/src/App.tsx`
**Line:** 90-105

**Issue:** `handleVideosSelected` calls `startProcessingVideo` which can throw, but there's no try-catch wrapping the entire flow.

**Current Code:**
```typescript
const handleVideosSelected = useCallback(async (files: UploadedFile[]) => {
  // ...
  if (queueItems.length > 0) {
    await startProcessingVideo(queueItems[0].path, 0)
  }
}, [setVideoQueue, startProcessingVideo])
```

**Recommendation:** Add error handling:
```typescript
const handleVideosSelected = useCallback(async (files: UploadedFile[]) => {
  try {
    // ...
    if (queueItems.length > 0) {
      await startProcessingVideo(queueItems[0].path, 0)
    }
  } catch (err) {
    setError({
      message: 'Failed to start video queue',
      details: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}, [setVideoQueue, startProcessingVideo])
```

---

### 7. Color Detection Thresholds May Be Too Permissive
**File:** `/Users/ecoon/golf-clip/src/backend/detection/color_family.py`
**Line:** 53-68

**Issue:** The expanded thresholds for white ball detection (`saturation < 50`, `value > 140`) may increase false positives on bright background elements like clouds, white shirts, or glare.

**Current Code:**
```python
if saturation < 50 and value > 140:
    return ColorFamily.WHITE
# ...
if value > 220 and saturation < 80:
    return ColorFamily.WHITE
```

**Recommendation:** Consider adding additional constraints or making these configurable:
- Add a minimum value floor for the gray/shadow case
- Consider the context (is it moving? is it round-shaped?)
- Log when these expanded thresholds are used for debugging

---

### 8. Hardcoded Brightness Thresholds
**File:** `/Users/ecoon/golf-clip/src/backend/detection/early_tracker.py`
**Line:** 191-193

**Issue:** New class constants for white ball detection are hardcoded and not configurable:

```python
WHITE_BALL_MIN_BRIGHTNESS = 120
WHITE_BALL_BOOST_THRESHOLD = 180
```

**Recommendation:** Make these configurable via constructor parameters or settings:
```python
def __init__(
    self,
    # ...
    white_ball_min_brightness: int = 120,
    white_ball_boost_threshold: int = 180,
):
```

---

### 9. Unused Variable Warning Suppression Pattern
**File:** `/Users/ecoon/golf-clip/src/frontend/src/components/TrajectoryEditor.tsx`
**Line:** 33-36

**Issue:** The `_supportsFilter` variable is created and then suppressed with `void`. This is dead code if it's truly not needed.

**Current Code:**
```typescript
const _supportsFilter = (() => {
  // ...
})()
void _supportsFilter // suppress unused warning
```

**Recommendation:** Either use the variable (it was intended for Safari compatibility) or remove it entirely:
```typescript
// Option 1: Remove if not needed
// Option 2: Use it in a conditional rendering path for Safari fallbacks
```

---

### 10. Passlog Cleanup in Error Path
**File:** `/Users/ecoon/golf-clip/src/backend/processing/clips.py`
**Line:** 616-623

**Issue:** In `_export_two_pass`, if `_run_pass_one` throws before `_run_pass_two`, the passlog directory will still be cleaned up (good), but if `_cleanup_passlog` itself fails, the error is logged but swallowed.

**Recommendation:** Consider adding the passlog directory to a list of temp directories to clean up on process exit, or document that manual cleanup may be needed.

---

## Suggestions (Nice to Have)

### 11. Type Safety for Queue Status
**File:** `/Users/ecoon/golf-clip/src/frontend/src/stores/appStore.ts`
**Line:** 52-53

**Suggestion:** The status type is inline. Consider extracting to a shared type:
```typescript
type QueueItemStatus = 'pending' | 'processing' | 'complete' | 'error'

interface QueuedVideo {
  status: QueueItemStatus
  // ...
}
```

---

### 12. CSS Class Naming Inconsistency
**File:** `/Users/ecoon/golf-clip/src/frontend/src/styles/global.css`
**Line:** 2361

**Issue:** The class `.queue-item-error .queue-item-error-text` uses a different pattern than the actual HTML which uses `.queue-item-error span.queue-item-error`.

**Recommendation:** Align CSS selectors with actual component markup.

---

### 13. Consider Debouncing Auto-Loop
**File:** `/Users/ecoon/golf-clip/src/frontend/src/components/ClipReview.tsx`
**Line:** 156-172

**Suggestion:** The 750ms pause before loop restart is fixed. Consider making it configurable or adding a "pause on hover" feature.

---

### 14. Early Detection Stats Not Persisted
**File:** `/Users/ecoon/golf-clip/src/frontend/src/components/ClipReview.tsx`
**Line:** 78

**Issue:** `earlyDetectionStats` is reset when shot changes but the debug UI might flash previous values briefly.

**Recommendation:** Clear stats immediately when starting new generation:
```typescript
const generateTrajectoryWithConfig = useCallback(() => {
  setEarlyDetectionStats(null) // Clear immediately
  // ...
}, [])
```

---

### 15. Test Coverage for New Features
**File:** `/Users/ecoon/golf-clip/src/backend/tests/test_trajectory_generate_sse.py`

**Suggestion:** The tests were updated to mock `EarlyBallTracker`, but there are no dedicated tests for:
- Batch upload endpoint
- Two-pass encoding
- Color family threshold changes

**Recommendation:** Add test files:
- `test_batch_upload.py`
- `test_two_pass_encoding.py`
- `test_color_family.py`

---

### 16. Documentation for New Features
**Suggestion:** The following new features lack documentation in `CLAUDE.md`:
- Batch upload API endpoint
- Two-pass encoding options
- Auto-loop functionality
- Queue management in frontend

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 4 | Security/bug issues that should be fixed before merge |
| Warning | 6 | Issues that could cause problems in edge cases |
| Suggestion | 6 | Improvements for maintainability and robustness |

**Overall Assessment:** The changes add valuable multi-video and quality encoding features. The main concerns are:
1. Path traversal risk in batch upload (security)
2. Race conditions in EventSource handling (reliability)
3. Missing abort/cleanup for upload XHRs (memory/React warnings)
4. Off-by-one potential in queue index management (edge case bug)

Recommend addressing critical issues before committing.
