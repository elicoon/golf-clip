# Bug Analysis: Sequential Upload Blocks Processing

**Date:** 2026-02-01
**Reported Issue:** When multiple videos are uploaded, the system waits for ALL videos to finish uploading before starting to process any of them.
**Expected Behavior:** Processing should begin for each video as soon as its upload completes.

---

## Executive Summary

The bug is a **race condition combined with a stale closure issue** in `App.tsx`. The `handleVideoUploaded` callback intended to start processing immediately after each upload, but it only triggers for the **first** video due to the `isProcessing` guard. Subsequent videos are added to the queue but never trigger processing because `isProcessing` remains `true` from the first video.

However, the deeper architectural issue is that **the system was designed for sequential processing** (one video at a time), not parallel processing. The `onVideoUploaded` callback was added as an optimization attempt, but the underlying flow still waits for all uploads to complete before the user can interact with the UI.

---

## Code Flow Analysis

### 1. Upload Flow in `VideoDropzone.tsx`

**File:** `packages/frontend/src/components/VideoDropzone.tsx`
**Function:** `handleFiles` (lines 253-320)

```typescript
// Lines 288-300: Upload all files SEQUENTIALLY
const results: UploadedFile[] = []
for (let i = 0; i < validFiles.length; i++) {
  const result = await uploadSingleFile(validFiles[i], i)
  if (result) {
    results.push(result)

    // Notify parent immediately when each file completes
    if (onVideoUploaded) {
      onVideoUploaded(result)  // <-- This DOES fire per-file
    }
  }
}

// Lines 302-314: THEN notify parent of ALL files
setIsLoading(false)

if (results.length > 0) {
  onVideosSelected(results)  // <-- Called only after ALL uploads complete
  // ...
}
```

**Key Finding #1:** The `onVideoUploaded` callback IS being called per-file as each upload completes (line 296-298). This part is working correctly.

---

### 2. Processing Trigger in `App.tsx`

**File:** `packages/frontend/src/App.tsx`
**Function:** `handleVideoUploaded` (lines 86-102)

```typescript
const handleVideoUploaded = useCallback(async (file: UploadedFile) => {
  const queueItem = {
    filename: file.filename,
    path: file.path,
    size: file.size,
    status: 'pending' as const,
  }

  // Add to queue - returns true if this is the first video
  const isFirst = addVideoToQueue(queueItem)

  // If this is the first video and we're not already processing, start
  if (isFirst && !isProcessing) {
    setIsProcessing(true)
    await startProcessingVideo(file.path, 0)
  }
}, [addVideoToQueue, isProcessing, startProcessingVideo])
```

**Root Cause Identified (Location #1):**

The condition `if (isFirst && !isProcessing)` only allows processing to start for the **first** video. When the second video finishes uploading:
- `isFirst` returns `false` (because queue is not empty)
- Processing is never triggered for subsequent videos

This is **intentional design** for sequential processing, but it conflicts with the user expectation that processing could happen in parallel with uploads.

---

### 3. State Management in `appStore.ts`

**File:** `packages/frontend/src/stores/appStore.ts`
**Function:** `addVideoToQueue` (lines 118-127)

```typescript
addVideoToQueue: (video) => {
  const state = get()
  const isFirst = state.videoQueue.length === 0 && state.currentQueueIndex === 0

  set((state) => ({
    videoQueue: [...state.videoQueue, video],
  }))

  return isFirst
}
```

**Observation:** The `addVideoToQueue` function correctly returns whether this is the first video, but this logic only matters for the initial trigger.

---

### 4. The Actual Blocking Behavior

**File:** `packages/frontend/src/components/VideoDropzone.tsx`
**Lines 277-278 and 302:**

```typescript
setError(null)
setIsLoading(true)  // <-- UI enters loading state

// ... sequential uploads happen ...

setIsLoading(false)  // <-- Only exits loading AFTER ALL uploads complete
```

**Root Cause Identified (Location #2):**

The `isLoading` state blocks the entire dropzone UI until ALL uploads are complete. Even though `onVideoUploaded` fires per-file, the user cannot interact with the application because:

1. The dropzone shows "Uploading X files..." progress UI
2. The `isLoading` state only clears after the `for` loop completes (line 302)
3. `onVideosSelected` is called with ALL results after the loop (line 306)

**This is the primary perceived blocking behavior** - the UI does not transition to processing view until all uploads finish, even though processing of the first video has technically started in the background.

---

### 5. View State Never Changes Until All Uploads Complete

**File:** `packages/frontend/src/App.tsx`
**Lines 72 and 213-235:**

```typescript
// In startProcessingVideo (line 72):
setView('processing')

// In JSX (lines 213-235):
{view === 'home' && (
  <>
    <VideoDropzone ... />
    {isSubmitting && (
      <div className="submitting-overlay">...</div>
    )}
  </>
)}
```

**Key Finding #2:** When `startProcessingVideo` is called, it sets `view` to `'processing'`, which should hide the dropzone. HOWEVER:

- `startProcessingVideo` is called from within `handleVideoUploaded`
- `handleVideoUploaded` is called from within the `handleFiles` async loop
- The async loop is still running (uploading more files)
- React state updates may be batched

Even if `view` changes to `'processing'`, the dropzone's `handleFiles` function continues to run because it's an async function that was already started.

---

## Root Cause Summary

| Issue | Location | Description |
|-------|----------|-------------|
| **Primary** | `VideoDropzone.tsx:253-320` | `handleFiles` uploads files sequentially in a single async loop. The loop doesn't exit until ALL files are uploaded. |
| **Secondary** | `App.tsx:86-102` | `handleVideoUploaded` only triggers processing for the first video due to `isFirst && !isProcessing` guard. |
| **Tertiary** | `VideoDropzone.tsx:302` | `setIsLoading(false)` only called after loop completes, keeping UI in upload state. |

---

## Why It's Happening

The architecture was designed for **sequential video processing** (process one video completely before starting the next). The `onVideoUploaded` callback was added as an optimization to start processing earlier, but:

1. **The upload loop is synchronous-sequential** - It `await`s each upload before starting the next
2. **The UI state is coupled to the loop** - `isLoading` remains `true` until the loop finishes
3. **Processing only triggers once** - The first video triggers processing; subsequent videos just add to queue
4. **No parallel processing support** - The system processes one video at a time, waiting for review between videos

---

## What Needs to Change (Conceptually)

### Option A: True Parallel Processing (Complex)
- Upload all files in parallel (or stream them)
- Start processing each video independently as it completes
- Allow multiple jobs to process simultaneously
- Show a split UI with upload progress AND processing progress

**Complexity:** High - requires backend changes to support multiple concurrent jobs

### Option B: Parallel Upload + Sequential Processing (Medium)
- Upload files in parallel using `Promise.all` or similar
- Start processing the FIRST completed upload immediately
- Show upload progress and processing progress in the same view
- Queue remaining uploads as they complete

**Complexity:** Medium - frontend-only changes

### Option C: Decouple UI from Upload Loop (Simpler)
- Transition to processing view as soon as first video starts processing
- Continue uploads in background
- Show "X more videos uploading..." indicator in processing view
- Add uploads to queue as they complete

**Key Changes Required:**
1. `VideoDropzone.tsx`: Don't block on the for-loop. Fire `onVideoUploaded` per-file AND transition view early
2. `App.tsx`: Transition to processing view when first video starts, not when all uploads complete
3. `App.tsx`: Handle background uploads adding to queue while processing
4. New UI: Show upload progress indicator in processing/review views

---

## Files Affected

| File | Lines | Change Needed |
|------|-------|---------------|
| `packages/frontend/src/components/VideoDropzone.tsx` | 253-320 | Decouple UI state from upload loop |
| `packages/frontend/src/App.tsx` | 86-117 | Allow view transition while uploads continue |
| `packages/frontend/src/stores/appStore.ts` | 108-127 | May need upload tracking separate from video queue |

---

## Verification Steps for Any Fix

1. Select 3 videos (small files for quick test)
2. Verify: Processing view appears before all uploads complete
3. Verify: Remaining uploads continue in background
4. Verify: Queue shows correct count as uploads complete
5. Verify: No videos are lost if upload fails mid-batch
6. Verify: "New Video" reset properly cancels pending uploads
