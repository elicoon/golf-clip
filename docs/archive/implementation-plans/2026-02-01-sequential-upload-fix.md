# Sequential Upload Blocks Bug Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where multiple video uploads wait for ALL files to complete before processing starts, allowing users to upload multiple videos that process independently.

**Architecture:** Refactor from a single global processing state to a per-video state model using a Map. Each video gets a unique ID and tracks its own status, progress, and segments. The `streaming-processor` accepts a `videoId` parameter and updates only that video's state. Files are accepted immediately and queued for processing without blocking.

**Tech Stack:** React, Zustand, TypeScript, FFmpeg.wasm

---

## Background

### Current Broken Behavior

1. **Input missing `multiple`**: Only one file can be selected at a time
2. **Only `files[0]` used**: `handleDrop` and `handleFileInputChange` ignore additional files
3. **Blocking `await`**: `handleFile()` awaits `processVideoFile()`, blocking subsequent file handling
4. **Single global status**: Store has one `status`, `progress`, `fileName` - cannot track multiple videos

### Target Behavior

1. User can select/drop multiple files at once
2. Each file immediately appears in a queue with "pending" status
3. Processing starts for the first file without blocking file acceptance
4. Each video has independent status/progress tracking
5. UI shows all videos with their individual states

---

## Task 1: Add Multi-Video State to Store

**Files:**
- Modify: `apps/browser/src/stores/processingStore.ts`

### Step 1: Define new types for per-video state

Add these new interfaces above the existing `ProcessingState` interface:

```typescript
/** Unique identifier for each video being processed */
export type VideoId = string

/** Per-video processing state */
export interface VideoState {
  id: VideoId
  fileName: string
  fileDuration: number | null
  status: 'pending' | 'loading' | 'processing' | 'ready' | 'error'
  error: string | null
  progress: number
  progressMessage: string
  strikes: StrikeDetection[]
  segments: VideoSegment[]
  currentSegmentIndex: number
}

/** Creates a new VideoState with default values */
export function createVideoState(id: VideoId, fileName: string): VideoState {
  return {
    id,
    fileName,
    fileDuration: null,
    status: 'pending',
    error: null,
    progress: 0,
    progressMessage: '',
    strikes: [],
    segments: [],
    currentSegmentIndex: 0,
  }
}
```

### Step 2: Add multi-video tracking to store state

Add these properties to the `ProcessingState` interface (keep existing properties for backward compatibility):

```typescript
interface ProcessingState {
  // ... existing properties ...

  // Multi-video support
  videos: Map<VideoId, VideoState>
  activeVideoId: VideoId | null  // Currently displayed video

  // Multi-video actions
  addVideo: (id: VideoId, fileName: string) => void
  removeVideo: (id: VideoId) => void
  setActiveVideo: (id: VideoId | null) => void
  updateVideoState: (id: VideoId, updates: Partial<VideoState>) => void
  setVideoProgress: (id: VideoId, progress: number, message?: string) => void
  setVideoStatus: (id: VideoId, status: VideoState['status']) => void
  setVideoError: (id: VideoId, error: string | null) => void
  addVideoStrike: (id: VideoId, strike: StrikeDetection) => void
  addVideoSegment: (id: VideoId, segment: Omit<VideoSegment, 'confidence' | 'clipStart' | 'clipEnd' | 'approved'> & Partial<Pick<VideoSegment, 'confidence' | 'clipStart' | 'clipEnd' | 'approved'>>) => void
  setVideoFileInfo: (id: VideoId, duration: number) => void
  updateVideoSegment: (id: VideoId, segmentId: string, updates: Partial<VideoSegment>) => void
  approveVideoSegment: (id: VideoId, segmentId: string) => void
  rejectVideoSegment: (id: VideoId, segmentId: string) => void
  getVideo: (id: VideoId) => VideoState | undefined
}
```

### Step 3: Implement multi-video actions in store

Add these implementations to the `create<ProcessingState>()` call:

```typescript
export const useProcessingStore = create<ProcessingState>((set, get) => ({
  // ... existing state initialization ...

  // Multi-video state
  videos: new Map<VideoId, VideoState>(),
  activeVideoId: null,

  // Multi-video actions
  addVideo: (id, fileName) => set((state) => {
    const newVideos = new Map(state.videos)
    newVideos.set(id, createVideoState(id, fileName))
    return {
      videos: newVideos,
      // If this is the first video, make it active
      activeVideoId: state.activeVideoId ?? id
    }
  }),

  removeVideo: (id) => set((state) => {
    const video = state.videos.get(id)
    if (video) {
      // Revoke object URLs for this video's segments
      video.segments.forEach(seg => URL.revokeObjectURL(seg.objectUrl))
    }
    const newVideos = new Map(state.videos)
    newVideos.delete(id)
    return {
      videos: newVideos,
      activeVideoId: state.activeVideoId === id
        ? (newVideos.keys().next().value ?? null)
        : state.activeVideoId
    }
  }),

  setActiveVideo: (id) => set({ activeVideoId: id }),

  updateVideoState: (id, updates) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, ...updates })
    return { videos: newVideos }
  }),

  setVideoProgress: (id, progress, message) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, progress, progressMessage: message ?? '' })
    return { videos: newVideos }
  }),

  setVideoStatus: (id, status) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, status })
    return { videos: newVideos }
  }),

  setVideoError: (id, error) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, error, status: error ? 'error' : video.status })
    return { videos: newVideos }
  }),

  addVideoStrike: (id, strike) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, strikes: [...video.strikes, strike] })
    return { videos: newVideos }
  }),

  addVideoSegment: (id, segment) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    const fullSegment: VideoSegment = {
      ...segment,
      confidence: segment.confidence ?? 0.5,
      clipStart: segment.clipStart ?? segment.startTime,
      clipEnd: segment.clipEnd ?? segment.endTime,
      approved: segment.approved ?? 'pending',
    }
    newVideos.set(id, { ...video, segments: [...video.segments, fullSegment] })
    return { videos: newVideos }
  }),

  setVideoFileInfo: (id, duration) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, fileDuration: duration })
    return { videos: newVideos }
  }),

  updateVideoSegment: (id, segmentId, updates) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, {
      ...video,
      segments: video.segments.map(seg =>
        seg.id === segmentId ? { ...seg, ...updates } : seg
      )
    })
    return { videos: newVideos }
  }),

  approveVideoSegment: (id, segmentId) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, {
      ...video,
      segments: video.segments.map(seg =>
        seg.id === segmentId ? { ...seg, approved: 'approved' } : seg
      )
    })
    return { videos: newVideos }
  }),

  rejectVideoSegment: (id, segmentId) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, {
      ...video,
      segments: video.segments.map(seg =>
        seg.id === segmentId ? { ...seg, approved: 'rejected' } : seg
      )
    })
    return { videos: newVideos }
  }),

  getVideo: (id) => get().videos.get(id),

  // Update reset to also clear multi-video state
  reset: () => {
    const state = useProcessingStore.getState()
    // Revoke URLs for legacy segments
    state.segments.forEach(seg => URL.revokeObjectURL(seg.objectUrl))
    // Revoke URLs for multi-video segments
    state.videos.forEach(video => {
      video.segments.forEach(seg => URL.revokeObjectURL(seg.objectUrl))
    })
    set({
      status: 'idle',
      error: null,
      progress: 0,
      progressMessage: '',
      strikes: [],
      segments: [],
      currentSegmentIndex: 0,
      fileName: null,
      fileDuration: null,
      videos: new Map(),
      activeVideoId: null,
    })
  },
}))
```

### Step 4: Run type check to verify compilation

Run: `cd apps/browser && npm run typecheck`
Expected: Should compile without errors (may have errors in other files that will be fixed in subsequent tasks)

### Step 5: Commit

```bash
git add apps/browser/src/stores/processingStore.ts
git commit -m "feat(store): add multi-video state tracking

Add VideoState interface and Map<VideoId, VideoState> to track
multiple videos independently. Each video has its own status,
progress, strikes, and segments.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Update Streaming Processor for Per-Video State

**Files:**
- Modify: `apps/browser/src/lib/streaming-processor.ts`

### Step 1: Add videoId parameter to processVideoFile

Update the function signature and add videoId-aware state updates:

```typescript
/**
 * Process a video file to detect golf strikes and extract segments.
 *
 * @param file - The video file to process
 * @param videoId - Optional unique identifier for multi-video tracking
 * @param callbacks - Optional callbacks for progress and events
 * @returns Array of detected strikes
 */
export async function processVideoFile(
  file: File,
  videoId?: string,
  callbacks: ProcessingCallbacks = {}
): Promise<StrikeDetection[]> {
  const store = useProcessingStore.getState()

  // Helper to update state - uses videoId if provided, otherwise legacy global state
  const updateProgress = (progress: number, message: string) => {
    if (videoId) {
      store.setVideoProgress(videoId, progress, message)
    } else {
      store.setProgress(progress, message)
    }
    callbacks.onProgress?.(progress, message)
  }

  const updateStatus = (status: 'loading' | 'processing' | 'ready' | 'error') => {
    if (videoId) {
      store.setVideoStatus(videoId, status)
    } else {
      store.setStatus(status)
    }
  }

  const addStrike = (strike: StrikeDetection) => {
    if (videoId) {
      store.addVideoStrike(videoId, strike)
    } else {
      store.addStrike(strike)
    }
    callbacks.onStrikeDetected?.(strike)
  }

  const addSegment = (segment: Parameters<typeof store.addSegment>[0]) => {
    if (videoId) {
      store.addVideoSegment(videoId, segment)
    } else {
      store.addSegment(segment)
    }
  }

  const setFileInfo = (name: string, duration: number) => {
    if (videoId) {
      store.setVideoFileInfo(videoId, duration)
    } else {
      store.setFileInfo(name, duration)
    }
  }

  const setError = (error: string) => {
    if (videoId) {
      store.setVideoError(videoId, error)
    } else {
      store.setError(error)
    }
  }

  try {
    // Phase 1: Initialize
    updateStatus('loading')
    updateProgress(5, 'Loading FFmpeg...')
    await loadFFmpeg()

    updateProgress(8, 'Preparing video...')

    updateProgress(42, 'Loading audio analyzer...')
    await loadEssentia()

    // Phase 2: Get video metadata
    updateProgress(45, 'Reading video metadata...')
    const duration = await getVideoDuration(file)
    setFileInfo(file.name, duration)

    // Phase 3: Process audio in chunks
    updateStatus('processing')
    const allStrikes: StrikeDetection[] = []
    const numChunks = Math.ceil(duration / AUDIO_CHUNK_DURATION)

    for (let i = 0; i < numChunks; i++) {
      const chunkStart = i * AUDIO_CHUNK_DURATION
      const chunkEnd = Math.min((i + 1) * AUDIO_CHUNK_DURATION, duration)
      const chunkDuration = chunkEnd - chunkStart

      const progressPercent = 50 + (i / numChunks) * 35
      updateProgress(progressPercent, `Analyzing audio chunk ${i + 1}/${numChunks}...`)

      const audioData = await extractAudioFromSegment(file, chunkStart, chunkDuration)
      const chunkStrikes = await detectStrikes(audioData, SAMPLE_RATE)

      for (const strike of chunkStrikes) {
        const adjustedStrike = {
          ...strike,
          timestamp: strike.timestamp + chunkStart
        }
        allStrikes.push(adjustedStrike)
        addStrike(adjustedStrike)
      }
    }

    // Phase 4: Extract video segments for each strike using FFmpeg
    updateProgress(88, 'Extracting video segments...')

    for (let i = 0; i < allStrikes.length; i++) {
      const strike = allStrikes[i]

      const segmentStart = Math.max(0, strike.timestamp - 5)
      const segmentEnd = Math.min(duration, strike.timestamp + 15)
      const segmentDuration = segmentEnd - segmentStart

      const segmentBlob = await extractVideoSegment(file, segmentStart, segmentDuration)

      const isPlayable = await validateSegmentPlayability(segmentBlob)
      if (!isPlayable) {
        console.warn(`[streaming-processor] Segment ${i + 1} may not be playable (codec issue).`)
      }

      addSegment({
        id: `segment-${i}`,
        strikeTime: strike.timestamp,
        startTime: segmentStart,
        endTime: segmentEnd,
        blob: segmentBlob,
        objectUrl: URL.createObjectURL(segmentBlob),
      })
      callbacks.onSegmentReady?.(segmentBlob, strike.timestamp)

      const segmentProgress = 88 + ((i + 1) / allStrikes.length) * 10
      updateProgress(segmentProgress, `Extracting segment ${i + 1}/${allStrikes.length}...`)
    }

    // Complete
    updateProgress(100, 'Processing complete!')
    updateStatus('ready')
    callbacks.onComplete?.(allStrikes)

    return allStrikes

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    setError(err.message)
    callbacks.onError?.(err)
    throw err
  } finally {
    unloadEssentia()
  }
}
```

### Step 2: Run type check

Run: `cd apps/browser && npm run typecheck`
Expected: Should compile without errors

### Step 3: Commit

```bash
git add apps/browser/src/lib/streaming-processor.ts
git commit -m "feat(processor): support per-video state updates via videoId

processVideoFile now accepts optional videoId parameter. When
provided, updates go to the video-specific state in the store
instead of the global state. Maintains backward compatibility.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update VideoDropzone for Multi-File Support

**Files:**
- Modify: `apps/browser/src/components/VideoDropzone.tsx`

### Step 1: Add `multiple` attribute to file input

Locate the `<input>` element (around line 314) and add the `multiple` attribute:

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept=".mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v"
  multiple  // ADD THIS LINE
  onChange={handleFileInputChange}
  style={{ display: 'none' }}
  aria-hidden="true"
/>
```

### Step 2: Add video ID generation utility

Add at the top of the file, after the imports:

```typescript
/** Generate unique video ID */
function generateVideoId(): string {
  return `video-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}
```

### Step 3: Create non-blocking file processor

Add a new function that processes a file without blocking:

```typescript
/**
 * Process a single file in the background without blocking.
 * Adds video to store immediately, then starts processing.
 */
async function processFileInBackground(
  file: File,
  videoId: string,
  store: ReturnType<typeof useProcessingStore.getState>
) {
  // Add video to store immediately with 'pending' status
  store.addVideo(videoId, file.name)

  try {
    // Check codec before processing
    await loadFFmpeg()
    const codecInfo = await detectVideoCodec(file)

    if (codecInfo.isHevc) {
      // For HEVC in multi-file mode, mark as error (user can handle individually)
      store.setVideoError(videoId, `HEVC codec detected - needs transcoding`)
      return
    }

    // Process the video
    await processVideoFile(file, videoId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    store.setVideoError(videoId, message)
  }
}
```

### Step 4: Update handleDrop to process all files

Replace the existing `handleDrop` function:

```typescript
const handleDrop = useCallback((e: React.DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  setIsDragging(false)
  dragCounter.current = 0
  setError(null)

  const files = Array.from(e.dataTransfer.files)
  if (files.length === 0) {
    setError('No file detected. Please try again.')
    return
  }

  const store = useProcessingStore.getState()

  // Process each file - don't await, let them run in parallel
  for (const file of files) {
    const validationError = validateFile(file)
    if (validationError) {
      // For multi-file, show error but continue with valid files
      console.warn(`Skipping ${file.name}: ${validationError}`)
      continue
    }

    const videoId = generateVideoId()
    // Fire and forget - don't block
    processFileInBackground(file, videoId, store)
  }
}, [])
```

### Step 5: Update handleFileInputChange to process all files

Replace the existing `handleFileInputChange` function:

```typescript
const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files || [])
  if (files.length === 0) return

  const store = useProcessingStore.getState()

  // Process each file - don't await
  for (const file of files) {
    const validationError = validateFile(file)
    if (validationError) {
      console.warn(`Skipping ${file.name}: ${validationError}`)
      continue
    }

    const videoId = generateVideoId()
    processFileInBackground(file, videoId, store)
  }

  e.target.value = ''
}, [])
```

### Step 6: Keep single-file handleFile for HEVC modal flow

The existing `handleFile` function should remain for the single-file HEVC modal workflow. Update it to also use multi-video store when not showing HEVC modal:

```typescript
const handleFile = useCallback(async (file: File) => {
  const validationError = validateFile(file)
  if (validationError) {
    setError(validationError)
    return
  }

  setError(null)
  const store = useProcessingStore.getState()
  const videoId = generateVideoId()

  // Add video immediately
  store.addVideo(videoId, file.name)

  // Check codec before processing
  setIsCheckingCodec(true)
  try {
    await loadFFmpeg()
    const codecInfo = await detectVideoCodec(file)

    if (codecInfo.isHevc) {
      // Store videoId for HEVC flow
      const fileSizeMB = Math.round(file.size / (1024 * 1024))
      const { formatted: estimatedTime } = estimateTranscodeTime(fileSizeMB)

      let fileBlob: Blob
      try {
        fileBlob = new Blob([await file.arrayBuffer()], { type: file.type })
      } catch {
        fileBlob = file
      }

      setHevcWarning({
        show: true,
        file,
        fileBlob,
        codec: codecInfo.codec.toUpperCase(),
        fileSizeMB,
        estimatedTime,
        isTranscoding: false,
        transcodeProgress: 0,
        transcodeStartTime: null,
        segmentIndex: 0,
        segmentBlob: null,
      })
      // Store the videoId for later use after transcode
      // We'll need to add this to hevcWarning state
      setIsCheckingCodec(false)
      return
    }

    // Codec is playable, proceed with processing
    await processVideoFile(file, videoId)
  } catch {
    // If codec detection fails, try processing anyway
    await processVideoFile(file, videoId)
  } finally {
    setIsCheckingCodec(false)
  }
}, [])
```

### Step 7: Run tests to verify multi-file behavior

Run: `cd apps/browser && npm test -- --run VideoDropzone`
Expected: The multi-file tests should now pass:
- `file input should have multiple attribute for multi-file selection`
- `should process all files when multiple files are selected via input`
- `should process all files when multiple files are dropped`
- `should start processing first file immediately without blocking`

### Step 8: Commit

```bash
git add apps/browser/src/components/VideoDropzone.tsx
git commit -m "feat(dropzone): support multiple file uploads without blocking

- Add 'multiple' attribute to file input
- Process all dropped/selected files instead of just first
- Don't await processing - let files process in parallel
- Each file gets unique videoId for independent tracking

Fixes: sequential-upload-blocks bug

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Video Queue UI Component

**Files:**
- Create: `apps/browser/src/components/VideoQueue.tsx`
- Modify: `apps/browser/src/App.tsx`

### Step 1: Create VideoQueue component

```tsx
// apps/browser/src/components/VideoQueue.tsx
import { useProcessingStore, VideoState } from '../stores/processingStore'

interface VideoQueueItemProps {
  video: VideoState
  isActive: boolean
  onClick: () => void
}

function VideoQueueItem({ video, isActive, onClick }: VideoQueueItemProps) {
  const statusIcon = {
    pending: '⏳',
    loading: '⏳',
    processing: '⚙️',
    ready: '✓',
    error: '✗',
  }[video.status]

  const statusClass = {
    pending: 'queue-item-pending',
    loading: 'queue-item-loading',
    processing: 'queue-item-processing',
    ready: 'queue-item-ready',
    error: 'queue-item-error',
  }[video.status]

  return (
    <button
      className={`queue-item ${statusClass} ${isActive ? 'queue-item-active' : ''}`}
      onClick={onClick}
      title={video.fileName}
    >
      <span className="queue-item-icon">{statusIcon}</span>
      <span className="queue-item-name">{video.fileName}</span>
      {(video.status === 'loading' || video.status === 'processing') && (
        <span className="queue-item-progress">{video.progress}%</span>
      )}
      {video.status === 'ready' && (
        <span className="queue-item-count">{video.segments.length} shots</span>
      )}
    </button>
  )
}

export function VideoQueue() {
  const { videos, activeVideoId, setActiveVideo } = useProcessingStore()

  const videoList = Array.from(videos.values())

  if (videoList.length === 0) {
    return null
  }

  return (
    <div className="video-queue">
      <h3 className="video-queue-title">Videos ({videoList.length})</h3>
      <div className="video-queue-list">
        {videoList.map((video) => (
          <VideoQueueItem
            key={video.id}
            video={video}
            isActive={video.id === activeVideoId}
            onClick={() => setActiveVideo(video.id)}
          />
        ))}
      </div>
    </div>
  )
}
```

### Step 2: Add VideoQueue styles

Add to `apps/browser/src/styles/global.css`:

```css
/* Video Queue */
.video-queue {
  background: var(--surface);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.video-queue-title {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 0.5rem 0;
}

.video-queue-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.queue-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-size: 0.875rem;
  transition: all 0.15s ease;
}

.queue-item:hover {
  background: var(--surface-hover);
}

.queue-item-active {
  border-color: var(--primary);
  background: var(--primary-light);
}

.queue-item-icon {
  flex-shrink: 0;
}

.queue-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-item-progress,
.queue-item-count {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.queue-item-ready .queue-item-icon {
  color: var(--success);
}

.queue-item-error .queue-item-icon {
  color: var(--error);
}

.queue-item-processing .queue-item-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

### Step 3: Update App.tsx to show VideoQueue

Update App.tsx to conditionally show the queue and handle multi-video state:

```tsx
// apps/browser/src/App.tsx
import { useState, useEffect } from 'react'
import { VideoDropzone } from './components/VideoDropzone'
import { ClipReview } from './components/ClipReview'
import { VideoQueue } from './components/VideoQueue'
import { useProcessingStore } from './stores/processingStore'

type AppView = 'upload' | 'review' | 'export'

export default function App() {
  const { status, segments, error, reset, videos, activeVideoId } = useProcessingStore()
  const [view, setView] = useState<AppView>('upload')

  // Get active video state
  const activeVideo = activeVideoId ? videos.get(activeVideoId) : undefined
  const hasVideos = videos.size > 0

  const handleReviewComplete = () => {
    setView('export')
  }

  const handleReset = () => {
    reset()
    setView('upload')
  }

  // Auto-transition to review when a video is ready
  useEffect(() => {
    if (activeVideo?.status === 'ready' && view === 'upload' && activeVideo.segments.length > 0) {
      setView('review')
    }
  }, [activeVideo?.status, view, activeVideo?.segments.length])

  // Also support legacy single-video flow
  useEffect(() => {
    if (status === 'ready' && view === 'upload' && segments.length > 0) {
      setView('review')
    }
  }, [status, view, segments.length])

  return (
    <div className="app">
      <header className="app-header">
        <h1>GolfClip</h1>
        <div className="header-actions">
          {(view !== 'upload' || hasVideos) && (
            <button onClick={handleReset} className="btn-secondary">
              New Video
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {/* Show queue when there are multiple videos */}
        {hasVideos && <VideoQueue />}

        {error && (
          <div className="app-error">
            <h3>Error</h3>
            <p>{error}</p>
            <button onClick={handleReset} className="btn-secondary">
              Try Again
            </button>
          </div>
        )}

        {view === 'upload' && !error && (
          <VideoDropzone />
        )}

        {view === 'review' && (
          <ClipReview onComplete={handleReviewComplete} />
        )}

        {view === 'export' && (
          <div className="export-complete">
            <div className="review-complete-icon">✓</div>
            <h2>Review Complete!</h2>
            <p className="export-message">
              {(activeVideo?.segments || segments).filter(s => s.approved === 'approved').length} shots approved
            </p>
            <button onClick={handleReset} className="btn-primary btn-large">
              Process Another Video
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
```

### Step 4: Run dev server and verify UI

Run: `cd apps/browser && npm run dev`
Expected:
- Dropzone appears
- Selecting multiple files shows them in a queue
- Each video shows individual progress
- Clicking a video in queue makes it active

### Step 5: Commit

```bash
git add apps/browser/src/components/VideoQueue.tsx apps/browser/src/styles/global.css apps/browser/src/App.tsx
git commit -m "feat(ui): add VideoQueue component for multi-video tracking

- New VideoQueue component shows all processing videos
- Each video displays status, progress, and shot count
- Click to switch active video
- App.tsx updated to show queue when videos present

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Run Full Test Suite and Verify

**Files:**
- Test: `apps/browser/src/components/VideoDropzone.test.tsx`

### Step 1: Run all VideoDropzone tests

Run: `cd apps/browser && npm test -- --run`
Expected: All tests pass, including the multi-file tests

### Step 2: Run type check

Run: `cd apps/browser && npm run typecheck`
Expected: No type errors

### Step 3: Run build

Run: `cd apps/browser && npm run build`
Expected: Build succeeds

### Step 4: Manual verification

1. Open dev server: `cd apps/browser && npm run dev`
2. Drop multiple video files at once
3. Verify:
   - All files appear in queue immediately
   - First file starts processing without waiting
   - Progress shows independently for each video
   - Clicking queue item switches active video
   - When video is ready, review view shows its segments

### Step 5: Final commit

```bash
git add -A
git commit -m "test: verify multi-file upload fix

All tests pass. Manual verification complete.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This implementation plan fixes the sequential-upload-blocks bug through these changes:

1. **Store refactor**: Added `Map<VideoId, VideoState>` to track multiple videos independently
2. **Processor update**: `processVideoFile` accepts optional `videoId` to update per-video state
3. **Dropzone update**: Added `multiple` attribute, process all files without blocking `await`
4. **New UI**: `VideoQueue` component shows all videos with status and allows switching

Each task is self-contained with clear steps, exact code, and verification commands.
