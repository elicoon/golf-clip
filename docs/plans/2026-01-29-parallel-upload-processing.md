# Parallel Upload Processing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Start processing videos immediately as each upload completes, rather than waiting for all uploads to finish.

**Architecture:** Add a per-file callback to VideoDropzone that fires as each upload completes. App.tsx maintains a processing queue that starts processing as files arrive, allowing parallel uploads with sequential processing.

**Tech Stack:** React, TypeScript, Zustand state management

---

## Current Flow (Blocking)

```
User drops 3 videos
     |
     v
VideoDropzone: Upload video 1... (wait)
                Upload video 2... (wait)
                Upload video 3... (wait)
     |
     v (only after ALL complete)
App: onVideosSelected([all 3 files])
     |
     v
Start processing video 1
```

## New Flow (Streaming)

```
User drops 3 videos
     |
     v
VideoDropzone: Upload video 1 ---> App: onVideoUploaded(file1)
               Upload video 2             |
               Upload video 3             v
                    |             Start processing file1
                    v
               onVideoUploaded(file2) --> Queue file2
               onVideoUploaded(file3) --> Queue file3
```

---

## Implementation Tasks

### Task 1: Add New Callback Prop to VideoDropzone

**Files:**
- Modify: `packages/frontend/src/components/VideoDropzone.tsx:13-17`
- Modify: `packages/frontend/src/components/VideoDropzone.tsx:31`

**Step 1: Update VideoDropzoneProps interface**

```typescript
// Line 13-17: Update interface
interface VideoDropzoneProps {
  onVideosSelected: (files: UploadedFile[]) => void
  onVideoSelected?: (filePath: string) => void
  onVideoUploaded?: (file: UploadedFile) => void  // NEW: fires per-file
}
```

**Step 2: Update component destructuring**

```typescript
// Line 31: Update destructuring
export function VideoDropzone({
  onVideosSelected,
  onVideoSelected,
  onVideoUploaded  // NEW
}: VideoDropzoneProps) {
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/frontend && npm run build`
Expected: Compiles without errors

---

### Task 2: Call onVideoUploaded After Each Upload Completes

**Files:**
- Modify: `packages/frontend/src/components/VideoDropzone.tsx:286-313`

**Step 1: Update the upload loop**

Modify `handleFiles()` to call `onVideoUploaded` immediately after each successful upload.

```typescript
// Lines 286-313: Modify the upload loop in handleFiles
const handleFiles = useCallback(async (files: File[]) => {
  // ... validation code stays the same (lines 252-284) ...

  // Upload all files (sequentially to avoid overwhelming the server)
  const results: UploadedFile[] = []
  for (let i = 0; i < validFiles.length; i++) {
    const result = await uploadSingleFile(validFiles[i], i)
    if (result) {
      results.push(result)

      // NEW: Notify parent immediately when each file completes
      if (onVideoUploaded) {
        onVideoUploaded(result)
      }
    }
  }

  setIsLoading(false)

  // Still call onVideosSelected for backward compatibility
  // This now serves as "all uploads complete" signal
  if (results.length > 0) {
    onVideosSelected(results)
    // ... rest of backward compat code ...
  }
  // ... rest of function ...
}, [onVideosSelected, onVideoSelected, onVideoUploaded])  // Add onVideoUploaded to deps
```

**Step 2: Verify callback fires per-file**

Run: Manual test - add console.log in App.tsx `handleVideoUploaded`, drop 2 files
Expected: Console shows 2 separate log entries as files complete

---

### Task 3: Add addVideoToQueue Action to Zustand Store

**Files:**
- Modify: `packages/frontend/src/stores/appStore.ts:57-81`
- Modify: `packages/frontend/src/stores/appStore.ts:107-135`

**Step 1: Add interface for new action**

```typescript
// Add to AppState interface (around line 73-80)
interface AppState {
  // ... existing properties ...

  // NEW: Add single video to queue, returns true if this is first video
  addVideoToQueue: (video: QueuedVideo) => boolean
}
```

**Step 2: Add implementation**

```typescript
// Add implementation (after addToQueue around line 115)
addVideoToQueue: (video) => {
  const state = get()
  const isFirst = state.videoQueue.length === 0 && state.currentQueueIndex === 0

  set((state) => ({
    videoQueue: [...state.videoQueue, video],
  }))

  return isFirst
},
```

**Step 3: Verify action works**

Run: Manual test with console.log showing return values
Expected: First call returns true, subsequent calls return false

---

### Task 4: Update App.tsx to Handle Streaming Uploads

**Files:**
- Modify: `packages/frontend/src/App.tsx:22-40`
- Modify: `packages/frontend/src/App.tsx:84-99`
- Modify: `packages/frontend/src/App.tsx:190-196`

**Step 1: Update store destructuring**

```typescript
// Line 22-34: Update store destructuring
const {
  currentJob,
  setCurrentJob,
  setShots,
  videoQueue,
  currentQueueIndex,
  setVideoQueue,
  updateQueueItem,
  advanceQueue,
  clearQueue,
  getQueueStats,
  addVideoToQueue,  // NEW
} = useAppStore()

// Add new state to track if we're actively processing
const [isProcessing, setIsProcessing] = useState(false)
```

**Step 2: Add handleVideoUploaded callback**

```typescript
// Add around line 100, before handleVideosSelected
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

**Step 3: Modify handleVideosSelected for backward compatibility**

```typescript
// Modify handleVideosSelected for backward compatibility
const handleVideosSelected = useCallback(async (files: UploadedFile[]) => {
  // Only start processing if we haven't already via onVideoUploaded
  if (videoQueue.length === 0 && files.length > 0) {
    const queueItems = files.map(file => ({
      filename: file.filename,
      path: file.path,
      size: file.size,
      status: 'pending' as const,
    }))
    setVideoQueue(queueItems)
    await startProcessingVideo(queueItems[0].path, 0)
  }
}, [setVideoQueue, startProcessingVideo, videoQueue.length])
```

**Step 4: Update VideoDropzone in render**

```typescript
// Update VideoDropzone in render (around line 192-195)
<VideoDropzone
  onVideosSelected={handleVideosSelected}
  onVideoSelected={handleVideoSelected}
  onVideoUploaded={handleVideoUploaded}  // NEW
/>
```

**Step 5: Verify processing starts after first upload**

Run: Drop 2 videos, watch network tab and console
Expected: Processing starts after first upload completes, not after both

---

### Task 5: Handle Processing Completion and Queue Advancement

**Files:**
- Modify: `packages/frontend/src/App.tsx:110-130`
- Modify: `packages/frontend/src/App.tsx:138-146`
- Modify: `packages/frontend/src/App.tsx:151-158`

**Step 1: Modify handleProcessingComplete**

```typescript
// Modify handleProcessingComplete (around line 110-130)
const handleProcessingComplete = useCallback((needsReview: boolean, totalShots: number) => {
  updateQueueItem(currentQueueIndex, { status: 'complete' })

  if (totalShots > 0) {
    setView('review')
    setIsProcessing(false)  // NEW: Pause while in review
  } else if (currentQueueIndex < videoQueue.length - 1) {
    const nextIndex = currentQueueIndex + 1
    advanceQueue()
    setShots([])
    startProcessingVideo(videoQueue[nextIndex].path, nextIndex)
  } else {
    setIsProcessing(false)  // NEW: Done
    setView('complete')
  }
}, [currentQueueIndex, videoQueue, updateQueueItem, advanceQueue, setShots, startProcessingVideo])
```

**Step 2: Modify handleNextVideo**

```typescript
// Modify handleNextVideo (around line 138-146)
const handleNextVideo = useCallback(() => {
  const nextIndex = currentQueueIndex + 1
  if (nextIndex < videoQueue.length) {
    setIsProcessing(true)  // NEW: Resume processing
    advanceQueue()
    setShots([])
    setExportedClips([])
    startProcessingVideo(videoQueue[nextIndex].path, nextIndex)
  }
}, [currentQueueIndex, videoQueue, advanceQueue, setShots, startProcessingVideo])
```

**Step 3: Modify handleReset**

```typescript
// Modify handleReset (around line 151-158)
const handleReset = useCallback(() => {
  setCurrentJob(null)
  setShots([])
  setError(null)
  setExportedClips([])
  clearQueue()
  setIsProcessing(false)  // NEW
  setView('home')
}, [setCurrentJob, setShots, clearQueue])
```

---

### Task 6: Add Visual Feedback for Queue Building

**Files:**
- Modify: `packages/frontend/src/App.tsx:214-233`

**Step 1: Add dynamic queue status**

```typescript
// Add inside processing view section around line 214-233
{videoQueue.length > 1 && (
  <div className="queue-status">
    Processing video 1 of {videoQueue.length}
    {videoQueue.filter(v => v.status === 'pending').length > 0 &&
      ` (+${videoQueue.filter(v => v.status === 'pending').length} queued)`
    }
  </div>
)}
```

---

### Task 7: Final Testing and Commit

**Step 1: Run full test suite**

Run: `cd packages/frontend && npm run build`
Expected: Build succeeds

**Step 2: Manual testing checklist**

- [ ] Drop 2 videos, verify processing starts after first upload
- [ ] Drop 3 videos, verify queue count updates dynamically
- [ ] Single video upload works as before
- [ ] Reset button clears queue and processing state

**Step 3: Commit changes**

```bash
git add packages/frontend/src/components/VideoDropzone.tsx
git add packages/frontend/src/stores/appStore.ts
git add packages/frontend/src/App.tsx
git commit -m "feat: start processing videos immediately as each upload completes

- Add onVideoUploaded callback to VideoDropzone that fires per-file
- Add addVideoToQueue action to Zustand store
- Update App.tsx to start processing on first upload, queue subsequent
- Maintain backward compatibility with onVideosSelected

Fixes: Sequential upload blocks processing bug"
```

---

## Summary of File Changes

| File | Lines Changed | Description |
|------|---------------|-------------|
| `packages/frontend/src/components/VideoDropzone.tsx` | ~10 | Add callback prop, call it per-upload |
| `packages/frontend/src/stores/appStore.ts` | ~10 | Add `addVideoToQueue` action |
| `packages/frontend/src/App.tsx` | ~30 | Handle streaming uploads, manage processing state |

---

## Testing Strategy

Since there are no existing frontend tests, testing will be manual:

1. **Basic Streaming Upload**: Drop 2 videos, verify processing starts after first upload (not both)
2. **Queue Building**: Drop 3 videos, verify queue count updates dynamically
3. **Fallback Compatibility**: Single video upload works as before
4. **Error Handling**: Disconnect network after first upload, verify first processes normally

**Commands**:
```bash
cd /Users/ecoon/golf-clip/packages/frontend && npm run dev
cd /Users/ecoon/golf-clip/apps/desktop && uvicorn backend.main:app --port 8420
```
