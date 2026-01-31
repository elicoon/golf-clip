# Multi-Video Upload with Queuing System - Scoping Document

**Date:** 2026-01-30
**Status:** Draft
**Author:** Claude (scoping task)

---

## 1. Current Architecture Overview

### How Single File Processing Works

The browser app currently processes one video at a time through a tightly coupled pipeline:

#### Components

1. **VideoDropzone.tsx** - UI component for file input
   - Accepts drag-and-drop or file picker selection
   - Validates file type (MP4, MOV, M4V) and size (max 2GB)
   - Takes only the first file: `e.dataTransfer.files[0]`
   - Directly calls `processVideoFile(file)` on valid input
   - Displays progress UI when `status === 'loading' || status === 'processing'`

2. **processingStore.ts** - Zustand global state
   - Single-file state model with flat structure:
     - `status`: `'idle' | 'loading' | 'processing' | 'ready' | 'error'`
     - `progress`: 0-100 (single progress value)
     - `fileName`: single file name
     - `fileDuration`: single duration
     - `strikes[]`: accumulated detections
     - `segments[]`: extracted video segments
   - No concept of multiple files or queue

3. **streaming-processor.ts** - Processing orchestrator
   - Pipeline phases:
     1. Load FFmpeg.wasm (~5% progress)
     2. Load Essentia.js (~10% progress)
     3. Read video metadata (~15% progress)
     4. Process audio in 30-second chunks (15-80% progress)
     5. Extract video segments for each strike (80-95% progress)
     6. Complete (100%)
   - Directly manipulates global store state
   - No support for processing multiple files

4. **ffmpeg-client.ts** - FFmpeg wrapper
   - Singleton FFmpeg instance (shared across operations)
   - Uses virtual filesystem with hardcoded filenames (`input.mp4`, `output.wav`)
   - Cleans up after each operation

5. **audio-detector.ts** - Essentia.js wrapper
   - Singleton Essentia instance
   - `unloadEssentia()` called in `finally` block after processing

#### Memory Characteristics

- FFmpeg.wasm: ~30MB base memory
- Video file loaded into FFmpeg virtual FS: up to 2GB
- Audio chunks: ~5MB per 30-second chunk (44.1kHz mono)
- Extracted segments: Variable (20-second clips)
- Object URLs created for each segment (not revoked until reset)

#### Key Limitation

The entire architecture assumes one file at a time. The store, processor, and UI all treat "the file" as singular.

---

## 2. Required Changes for Multi-File Support

### 2.1 UI Changes

#### Dropzone Modifications

| Change | Description | Effort |
|--------|-------------|--------|
| Accept multiple files | Change `files[0]` to iterate all files | Small |
| Multi-file input | Add `multiple` attribute to hidden file input | Trivial |
| Validation per file | Validate each file, collect errors | Small |
| Visual feedback | Show count of files selected | Small |

#### New: File Queue List Component

A new component showing queued files with per-file status:

```
+------------------------------------------+
| File Queue                               |
+------------------------------------------+
| [x] beach_video.mp4      Ready           |
| [>] driving_range.mov    Processing 45%  |
|     ████████░░░░░░░░░░                   |
| [ ] swing_analysis.mp4   Pending         |
| [ ] putting_practice.mp4 Pending         |
+------------------------------------------+
```

Features needed:
- File name with truncation
- Per-file status indicator (pending, processing, complete, error)
- Progress bar for active file
- Remove/cancel button per file
- Re-order capability (optional, nice-to-have)

Effort: **Medium** (new component with moderate complexity)

#### Results View Modifications

Current: Shows all segments in a flat grid
Needed: Group segments by source file

```
beach_video.mp4 - 3 shots found
  [Shot 1] [Shot 2] [Shot 3]

driving_range.mov - 5 shots found
  [Shot 1] [Shot 2] [Shot 3] [Shot 4] [Shot 5]
```

Effort: **Small-Medium** (restructure results layout)

### 2.2 State Management Changes

#### New Queue State Model

```typescript
interface QueuedFile {
  id: string                    // Unique identifier
  file: File                    // The actual File object
  status: 'pending' | 'processing' | 'complete' | 'error' | 'cancelled'
  progress: number              // 0-100 for this file
  progressMessage: string
  error: string | null
  strikes: StrikeDetection[]    // Results for this file
  segments: VideoSegment[]      // Extracted segments
  fileDuration: number | null
  addedAt: number               // Timestamp for ordering
}

interface MultiFileProcessingState {
  // Queue management
  queue: QueuedFile[]
  currentFileId: string | null  // ID of file being processed

  // Global state
  isProcessing: boolean         // Any file processing?

  // Actions
  addFiles: (files: File[]) => void
  removeFile: (id: string) => void
  cancelFile: (id: string) => void
  clearCompleted: () => void
  reorderQueue: (fromIndex: number, toIndex: number) => void

  // Per-file actions (for processor)
  setFileStatus: (id: string, status: QueuedFile['status']) => void
  setFileProgress: (id: string, progress: number, message?: string) => void
  setFileError: (id: string, error: string) => void
  addFileStrike: (id: string, strike: StrikeDetection) => void
  addFileSegment: (id: string, segment: VideoSegment) => void
  setFileDuration: (id: string, duration: number) => void

  // Queue processing
  processNext: () => void       // Start processing next pending file
  reset: () => void             // Clear everything
}
```

Effort: **Medium** (significant store refactor)

### 2.3 Processing Changes

#### Queue Processor

New orchestration layer that manages sequential processing:

```typescript
class QueueProcessor {
  private isRunning = false

  async processQueue() {
    if (this.isRunning) return
    this.isRunning = true

    while (true) {
      const nextFile = store.getNextPending()
      if (!nextFile) break

      try {
        await this.processFile(nextFile)
      } catch (error) {
        // Error already recorded in store
      }

      // Cleanup between files
      await this.cleanupAfterFile()
    }

    this.isRunning = false
  }

  private async processFile(queuedFile: QueuedFile) {
    // Adapt existing processVideoFile to work with queue
    // Use queuedFile.id for all store updates
  }

  private async cleanupAfterFile() {
    // Unload Essentia to free memory
    // FFmpeg can stay loaded (reusable)
    // Force GC if available
  }
}
```

#### Modifications to streaming-processor.ts

| Change | Description | Effort |
|--------|-------------|--------|
| Accept file ID parameter | Pass queue ID for store updates | Small |
| Use ID-specific store actions | `store.setFileProgress(id, ...)` instead of `store.setProgress(...)` | Medium |
| Fix FFmpeg filename conflicts | Use unique filenames or ensure sequential processing | Small |
| Expose cancellation | Check for cancel flag between phases | Medium |

#### Memory Management Between Files

Critical for processing multiple large videos:

1. **Revoke Object URLs** - Must revoke blob URLs from previous file's segments before processing next
2. **Unload Essentia** - Already done in `finally` block, but verify it frees memory
3. **Clear FFmpeg virtual FS** - Already done per operation
4. **Optional: Reload FFmpeg** - If memory leaks detected, reload WASM between files

Effort: **Medium** (requires careful testing)

---

## 3. Key Technical Considerations

### 3.1 Memory Management

**Challenge:** Browser memory limits (typically 2-4GB for a tab)

**Mitigations:**
- Process files sequentially (not parallel) - essential
- Aggressive cleanup between files
- Consider unloading FFmpeg.wasm between files if memory pressure detected
- Use `performance.measureUserAgentSpecificMemory()` if available to monitor
- Warn user if queue total size exceeds safe threshold

**Risk:** Medium - browsers vary in memory handling

### 3.2 Error Handling Per File

**Requirements:**
- Error in one file should not stop the queue
- Each file needs independent error state
- User should be able to retry failed files
- Detailed error messages per file

**Implementation:**
- Wrap `processFile` in try/catch
- Store error message on `QueuedFile.error`
- Update status to `'error'`
- Continue to next file in queue
- Provide "Retry" action for errored files

### 3.3 Cancellation

**Scenarios:**
- Cancel specific file (not yet started, or in progress)
- Cancel entire queue
- User navigates away mid-processing

**Challenges:**
- FFmpeg.exec() is not easily cancellable
- Essentia analysis blocks the main thread periodically
- Need to check cancellation flag between processing phases

**Implementation Options:**
1. **Cooperative cancellation:** Check `isCancelled` flag between phases (audio chunks, segments). Incomplete but practical.
2. **Web Worker isolation:** Run processing in worker, terminate worker to cancel. More complex but cleaner.

**Recommendation:** Start with cooperative cancellation (option 1). Good enough for MVP.

### 3.4 File Persistence

**Question:** What happens if user refreshes mid-queue?

**Options:**
1. **No persistence (simplest):** Queue lost on refresh. User must re-add files.
2. **IndexedDB persistence:** Store queue metadata (not files) and resume pending files.

**Recommendation:** Option 1 for initial implementation. Files are already local; re-adding is easy.

### 3.5 Duplicate Detection

**Question:** What if user adds the same file twice?

**Options:**
1. Allow duplicates (simplest)
2. Warn but allow
3. Prevent duplicates by name+size hash

**Recommendation:** Option 2 - Warn user but allow (they might have different files with same name).

### 3.6 Progress Reporting

**Consideration:** With multiple files, what does "overall progress" mean?

**Options:**
1. Show only per-file progress (current approach adapted)
2. Show both per-file and overall queue progress
3. Show file count: "Processing 2 of 5"

**Recommendation:** Option 3 with per-file progress bar. Simple and informative.

---

## 4. Complexity Estimate

### Component Breakdown

| Component | Effort | Notes |
|-----------|--------|-------|
| Store refactor | Medium | New queue model, many new actions |
| Queue processor | Medium | New orchestration logic |
| Dropzone changes | Small | Accept multiple, forward all |
| File queue UI | Medium | New component with status indicators |
| Results grouping | Small-Medium | Restructure layout |
| Memory management | Medium | Cleanup, monitoring |
| Error handling | Small | Already error-aware, extend per-file |
| Cancellation (basic) | Small-Medium | Cooperative between phases |
| Testing | Medium | Multiple scenarios, memory testing |

### Overall Estimate: **Medium-Large**

**Time estimate:** 2-4 days for an experienced developer familiar with the codebase

**Why Medium-Large (not Large):**
- Core processing logic doesn't change much
- No new external dependencies needed
- Sequential processing avoids concurrency complexity
- UI changes are incremental, not revolutionary

**Why not Small-Medium:**
- Store refactor touches many components
- Memory management needs careful testing
- New UI component (file queue list)
- Multiple edge cases (cancel, retry, errors)

---

## 5. Recommended Approach

### Phase 1: Foundation (Day 1)

1. **Refactor store** to queue-based model
   - Keep backward compatibility initially (single file still works)
   - Add queue array with per-file state
   - Add new actions for queue management

2. **Create QueueProcessor** class
   - Sequential processing loop
   - Hooks into existing `processVideoFile` logic
   - Memory cleanup between files

### Phase 2: UI (Day 2)

3. **Update VideoDropzone**
   - Accept multiple files
   - Add files to queue instead of processing immediately
   - Show queue count

4. **Create FileQueueList component**
   - Display queued files with status
   - Per-file progress bars
   - Remove/cancel buttons

5. **Update App.tsx**
   - Integrate queue list
   - Conditional rendering based on queue state

### Phase 3: Polish (Day 3)

6. **Group results by source file**
   - Segment cards show source file
   - Collapsible groups or tabs

7. **Error handling improvements**
   - Per-file error display
   - Retry failed files

8. **Cancellation**
   - Cancel pending files (easy)
   - Cancel in-progress file (cooperative)

### Phase 4: Testing & Hardening (Day 4)

9. **Memory testing**
   - Process 5+ large files in sequence
   - Monitor memory in DevTools
   - Fix any leaks

10. **Edge case testing**
    - Cancel mid-processing
    - Mix of successful and failed files
    - Very large files
    - Many small files

### Migration Strategy

- **No breaking changes** to external API
- Single file upload still works (queue of 1)
- Gradual rollout: feature flag if needed

---

## 6. Alternatives Considered

### Alternative A: Web Worker Processing

**Idea:** Move FFmpeg/Essentia processing to a Web Worker for true background processing.

**Pros:**
- Main thread stays responsive
- Cleaner cancellation (terminate worker)
- Better memory isolation

**Cons:**
- Significant refactor of processing code
- SharedArrayBuffer requirements for some operations
- Debugging more difficult
- FFmpeg.wasm worker compatibility untested

**Verdict:** Defer to future enhancement. Sequential processing on main thread is good enough for MVP.

### Alternative B: Parallel Processing

**Idea:** Process multiple files simultaneously.

**Pros:**
- Faster total processing time

**Cons:**
- Memory explosion (2GB file x N)
- FFmpeg singleton conflicts
- Much more complex state management
- Diminishing returns on typical hardware

**Verdict:** Not recommended. Sequential is safer and simpler.

### Alternative C: Server-Side Processing

**Idea:** Upload files to server for processing.

**Pros:**
- No browser memory limits
- More powerful hardware
- Could use GPU acceleration

**Cons:**
- Requires server infrastructure
- Upload time for large files
- Privacy concerns (user videos on server)
- Defeats "no upload required" selling point

**Verdict:** Out of scope. The browser-based approach is a key differentiator.

---

## 7. Open Questions

1. **Maximum queue size?** Should we limit to N files to prevent memory issues?
2. **Auto-start processing?** Should processing start immediately when files are added, or wait for user action?
3. **Queue persistence?** Is "lost on refresh" acceptable for v1?
4. **Download all?** Should there be a "download all segments" feature for batch processing?

---

## 8. Summary

Adding multi-video upload with a queuing system is a **medium-large** effort that primarily involves:

1. Refactoring the state store from single-file to queue-based model
2. Adding a queue processor for sequential file processing
3. Building a new file queue UI component
4. Careful memory management between files

The core processing logic (FFmpeg, Essentia, strike detection) remains largely unchanged. The main complexity is in state management and UI orchestration.

**Recommendation:** Proceed with phased implementation. Start with store refactor and queue processor, then iterate on UI. The feature adds significant value for users who record multiple rounds or sessions.
