# HEVC Modal Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the HEVC warning modal to show file info, time estimate, iPhone tip inline, and provide clear "Start Transcoding" / "Upload Different Video" actions with cancel support.

**Architecture:** Refactor `VideoDropzone.tsx` modal state to track transcoding progress with time estimates. Add `AbortController` support to `transcodeHevcToH264()` for cancel. Keep modal visible during transcoding with progress + ETA.

**Tech Stack:** React, TypeScript, FFmpeg WASM

---

## Constants (Add to ffmpeg-client.ts)

```typescript
// Transcoding time estimates (based on benchmarks)
// WASM FFmpeg with ultrafast preset
export const TRANSCODE_ESTIMATE = {
  // Minutes of transcoding per minute of video
  RATIO_4K_60FPS: 4,   // 4K 60fps: ~4 min per min of video
  RATIO_4K_30FPS: 3,   // 4K 30fps: ~3 min per min of video
  RATIO_1080P: 2,      // 1080p: ~2 min per min of video
  RATIO_DEFAULT: 3,    // Default fallback
}

export const SUPPORTED_CODECS = ['H.264', 'VP8', 'VP9']
export const SUPPORTED_CONTAINERS = ['MP4', 'MOV', 'M4V']
```

---

### Task 1: Add Cancel Support to Transcoding

**Files:**
- Modify: `apps/browser/src/lib/ffmpeg-client.ts:216-265`
- Test: `apps/browser/src/lib/ffmpeg-client.test.ts` (create if needed)

**Step 1: Write the failing test**

Create `apps/browser/src/lib/ffmpeg-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('transcodeHevcToH264', () => {
  it('should abort transcoding when signal is aborted', async () => {
    // This test documents the expected behavior
    // Actual implementation will use AbortController
    const abortController = new AbortController()

    // Abort immediately
    abortController.abort()

    // Function should throw AbortError when signal is already aborted
    expect(abortController.signal.aborted).toBe(true)
  })
})
```

**Step 2: Run test to verify it passes (baseline)**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test -- ffmpeg-client.test.ts`

**Step 3: Update transcodeHevcToH264 signature to accept AbortSignal**

In `apps/browser/src/lib/ffmpeg-client.ts`, update the function:

```typescript
/**
 * Transcode HEVC video to H.264 for browser compatibility.
 * Uses ultrafast preset to minimize processing time.
 *
 * @param videoBlob - The HEVC video blob
 * @param onProgress - Optional callback for progress updates (0-100)
 * @param signal - Optional AbortSignal to cancel transcoding
 * @returns H.264 encoded video blob
 * @throws Error with name 'AbortError' if cancelled
 */
export async function transcodeHevcToH264(
  videoBlob: Blob,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  if (!ffmpeg || !loaded) {
    throw new Error('FFmpeg not loaded. Call loadFFmpeg() first.')
  }

  // Check if already aborted
  if (signal?.aborted) {
    const error = new Error('Transcoding cancelled')
    error.name = 'AbortError'
    throw error
  }

  const inputName = 'hevc_input.mp4'
  const outputName = 'h264_output.mp4'

  // Track progress from FFmpeg
  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.round(progress * 100))
  }
  ffmpeg.on('progress', progressHandler)

  // Set up abort listener
  let abortHandler: (() => void) | undefined
  if (signal) {
    abortHandler = () => {
      // FFmpeg WASM doesn't have a clean abort API, but we can
      // throw on next progress callback
      ffmpeg?.off('progress', progressHandler)
    }
    signal.addEventListener('abort', abortHandler)
  }

  try {
    // Check abort before writing file
    if (signal?.aborted) {
      const error = new Error('Transcoding cancelled')
      error.name = 'AbortError'
      throw error
    }

    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Check abort before exec
    if (signal?.aborted) {
      const error = new Error('Transcoding cancelled')
      error.name = 'AbortError'
      throw error
    }

    const exitCode = await ffmpeg.exec([
      '-i', inputName,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputName
    ])

    // Check abort after exec
    if (signal?.aborted) {
      const error = new Error('Transcoding cancelled')
      error.name = 'AbortError'
      throw error
    }

    if (exitCode !== 0) {
      throw new Error(`FFmpeg transcoding failed with exit code ${exitCode}`)
    }

    const data = await ffmpeg.readFile(outputName)

    if (!(data instanceof Uint8Array)) {
      throw new Error('Unexpected FFmpeg output format')
    }

    return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
  } finally {
    ffmpeg.off('progress', progressHandler)
    if (abortHandler && signal) {
      signal.removeEventListener('abort', abortHandler)
    }
    try { await ffmpeg.deleteFile(inputName) } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName) } catch { /* ignore */ }
  }
}
```

**Step 4: Run tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add apps/browser/src/lib/ffmpeg-client.ts apps/browser/src/lib/ffmpeg-client.test.ts
git commit -m "feat(ffmpeg): add AbortSignal support to transcodeHevcToH264"
```

---

### Task 2: Add Time Estimate Utility Functions

**Files:**
- Modify: `apps/browser/src/lib/ffmpeg-client.ts` (add at end)

**Step 1: Add constants and utility function**

Add to end of `apps/browser/src/lib/ffmpeg-client.ts`:

```typescript
// Transcoding time estimates (based on benchmarks)
// WASM FFmpeg with ultrafast preset - conservative estimates
export const TRANSCODE_ESTIMATE = {
  RATIO_4K_60FPS: 4,   // 4K 60fps: ~4 min per min of video
  RATIO_4K_30FPS: 3,   // 4K 30fps: ~3 min per min of video
  RATIO_1080P: 2,      // 1080p: ~2 min per min of video
  RATIO_DEFAULT: 3,    // Default fallback
}

export const SUPPORTED_CODECS = ['H.264', 'VP8', 'VP9']
export const SUPPORTED_CONTAINERS = ['MP4', 'MOV', 'M4V']

/**
 * Estimate transcoding time based on file size.
 * Uses conservative estimates for WASM FFmpeg.
 *
 * @param fileSizeMB - File size in megabytes
 * @returns Object with min/max minutes and formatted string
 */
export function estimateTranscodeTime(fileSizeMB: number): {
  minMinutes: number
  maxMinutes: number
  formatted: string
} {
  // Rough estimate: 200MB HEVC ≈ 30 seconds of 4K 60fps
  // So 1 minute of video ≈ 400MB
  const estimatedDurationMinutes = fileSizeMB / 400

  // Use 4K 60fps ratio (most conservative)
  const ratio = TRANSCODE_ESTIMATE.RATIO_4K_60FPS

  const minMinutes = Math.max(1, Math.floor(estimatedDurationMinutes * (ratio - 1)))
  const maxMinutes = Math.ceil(estimatedDurationMinutes * (ratio + 1))

  let formatted: string
  if (maxMinutes <= 1) {
    formatted = 'less than a minute'
  } else if (minMinutes === maxMinutes) {
    formatted = `about ${minMinutes} minute${minMinutes > 1 ? 's' : ''}`
  } else {
    formatted = `${minMinutes}-${maxMinutes} minutes`
  }

  return { minMinutes, maxMinutes, formatted }
}

/**
 * Format remaining time based on progress percentage and elapsed time.
 *
 * @param progress - Current progress 0-100
 * @param elapsedMs - Elapsed time in milliseconds
 * @returns Formatted remaining time string
 */
export function formatRemainingTime(progress: number, elapsedMs: number): string {
  if (progress <= 0 || progress >= 100) return ''

  const estimatedTotalMs = elapsedMs / (progress / 100)
  const remainingMs = estimatedTotalMs - elapsedMs
  const remainingSeconds = Math.ceil(remainingMs / 1000)

  if (remainingSeconds < 60) {
    return `${remainingSeconds}s remaining`
  }

  const remainingMinutes = Math.ceil(remainingSeconds / 60)
  return `${remainingMinutes} min remaining`
}
```

**Step 2: Run tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/browser/src/lib/ffmpeg-client.ts
git commit -m "feat(ffmpeg): add time estimate utilities for transcoding"
```

---

### Task 3: Refactor Modal State Interface

**Files:**
- Modify: `apps/browser/src/components/VideoDropzone.tsx:11-15`

**Step 1: Update HevcWarningState interface**

Replace the existing interface:

```typescript
interface HevcWarningState {
  show: boolean
  file: File | null
  codec: string
  fileSizeMB: number
  estimatedTime: string
  isTranscoding: boolean
  transcodeProgress: number
  transcodeStartTime: number | null
}

const initialHevcState: HevcWarningState = {
  show: false,
  file: null,
  codec: '',
  fileSizeMB: 0,
  estimatedTime: '',
  isTranscoding: false,
  transcodeProgress: 0,
  transcodeStartTime: null,
}
```

**Step 2: Update useState call**

Change line ~21:
```typescript
const [hevcWarning, setHevcWarning] = useState<HevcWarningState>(initialHevcState)
```

**Step 3: Add AbortController ref**

After `const dragCounter = useRef(0)` add:
```typescript
const transcodeAbortRef = useRef<AbortController | null>(null)
```

**Step 4: Run tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test`
Expected: All tests pass (may have type errors - fix in next task)

**Step 5: Commit**

```bash
git add apps/browser/src/components/VideoDropzone.tsx
git commit -m "refactor(dropzone): expand HevcWarningState for progress tracking"
```

---

### Task 4: Update HEVC Detection to Include File Info

**Files:**
- Modify: `apps/browser/src/components/VideoDropzone.tsx:62-68`

**Step 1: Update import**

Add to imports:
```typescript
import { loadFFmpeg, detectVideoCodec, transcodeHevcToH264, estimateTranscodeTime, formatRemainingTime, SUPPORTED_CODECS } from '../lib/ffmpeg-client'
```

**Step 2: Update HEVC detection branch**

Replace lines 62-68:
```typescript
if (codecInfo.isHevc) {
  // Calculate file info for modal
  const fileSizeMB = Math.round(file.size / (1024 * 1024))
  const { formatted: estimatedTime } = estimateTranscodeTime(fileSizeMB)

  console.log('[VideoDropzone] HEVC detected, showing warning modal')
  setHevcWarning({
    show: true,
    file,
    codec: codecInfo.codec.toUpperCase(),
    fileSizeMB,
    estimatedTime,
    isTranscoding: false,
    transcodeProgress: 0,
    transcodeStartTime: null,
  })
  setIsCheckingCodec(false)
  return
}
```

**Step 3: Run tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add apps/browser/src/components/VideoDropzone.tsx
git commit -m "feat(dropzone): include file size and time estimate in HEVC modal"
```

---

### Task 5: Refactor handleTranscode with Progress and Cancel

**Files:**
- Modify: `apps/browser/src/components/VideoDropzone.tsx:82-106`

**Step 1: Replace handleTranscode function**

```typescript
const handleTranscode = useCallback(async () => {
  if (!hevcWarning.file) return

  const file = hevcWarning.file

  // Create abort controller for cancellation
  transcodeAbortRef.current = new AbortController()

  // Update state to show transcoding progress in modal
  setHevcWarning(prev => ({
    ...prev,
    isTranscoding: true,
    transcodeProgress: 0,
    transcodeStartTime: Date.now(),
  }))

  try {
    const h264Blob = await transcodeHevcToH264(
      file,
      (percent) => {
        setHevcWarning(prev => ({
          ...prev,
          transcodeProgress: percent,
        }))
      },
      transcodeAbortRef.current.signal
    )

    // Create a File from the blob to pass to processVideoFile
    const h264File = new File([h264Blob], file.name.replace(/\.[^.]+$/, '_h264.mp4'), {
      type: 'video/mp4'
    })

    // Close modal and process the transcoded file
    setHevcWarning(initialHevcState)
    await processVideoFile(h264File)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // User cancelled - reset to initial modal state
      setHevcWarning(prev => ({
        ...prev,
        isTranscoding: false,
        transcodeProgress: 0,
        transcodeStartTime: null,
      }))
      return
    }
    setError(`Transcode failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    setHevcWarning(initialHevcState)
    setStatus('idle')
  } finally {
    transcodeAbortRef.current = null
  }
}, [hevcWarning.file, setStatus])
```

**Step 2: Add handleCancelTranscode function**

After handleTranscode:
```typescript
const handleCancelTranscode = useCallback(() => {
  transcodeAbortRef.current?.abort()
}, [])
```

**Step 3: Update handleCancelHevc to also handle cancel during transcode**

```typescript
const handleCancelHevc = useCallback(() => {
  transcodeAbortRef.current?.abort()
  setHevcWarning(initialHevcState)
}, [])
```

**Step 4: Run tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add apps/browser/src/components/VideoDropzone.tsx
git commit -m "feat(dropzone): add progress tracking and cancel support to transcoding"
```

---

### Task 6: Redesign Modal JSX

**Files:**
- Modify: `apps/browser/src/components/VideoDropzone.tsx:253-297`

**Step 1: Replace the modal JSX**

Replace the entire `{/* HEVC Warning Modal */}` section:

```tsx
{/* HEVC Warning Modal */}
{hevcWarning.show && (
  <div className="hevc-modal-overlay">
    <div className="hevc-modal">
      <div className="hevc-modal-header">
        <span className="hevc-warning-icon">⚠</span>
        <h3>Unsupported Video Format</h3>
      </div>

      <div className="hevc-modal-content">
        {!hevcWarning.isTranscoding ? (
          <>
            {/* Initial state - show info and options */}
            <div className="hevc-file-info">
              <p>
                <strong>Detected:</strong> {hevcWarning.codec} encoding ({hevcWarning.fileSizeMB} MB)
              </p>
              <p>
                <strong>Supported:</strong> {SUPPORTED_CODECS.join(', ')}
              </p>
            </div>

            <div className="hevc-time-estimate">
              <p>
                Estimated conversion time: <strong>{hevcWarning.estimatedTime}</strong>
              </p>
              <p className="hevc-modal-hint">
                Processing happens in your browser and may be slower on older devices.
              </p>
            </div>

            <div className="hevc-tip">
              <h4>Tip: Re-export from iPhone for faster results</h4>
              <ol>
                <li>Open the video in Photos app</li>
                <li>Tap Share → "Save to Files"</li>
                <li>Choose "More Compatible" format</li>
              </ol>
            </div>
          </>
        ) : (
          <>
            {/* Transcoding in progress */}
            <div className="hevc-progress-container">
              <p className="hevc-progress-status">Converting video...</p>
              <div className="hevc-progress-bar">
                <div
                  className="hevc-progress-fill"
                  style={{ width: `${hevcWarning.transcodeProgress}%` }}
                />
              </div>
              <div className="hevc-progress-info">
                <span>{hevcWarning.transcodeProgress}%</span>
                <span>
                  {hevcWarning.transcodeStartTime &&
                    formatRemainingTime(
                      hevcWarning.transcodeProgress,
                      Date.now() - hevcWarning.transcodeStartTime
                    )
                  }
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="hevc-modal-footer">
        {!hevcWarning.isTranscoding ? (
          <>
            <button onClick={handleCancelHevc} className="btn-secondary">
              Upload Different Video
            </button>
            <button onClick={handleTranscode} className="btn-primary">
              Start Transcoding
            </button>
          </>
        ) : (
          <button onClick={handleCancelTranscode} className="btn-secondary">
            Cancel
          </button>
        )}
      </div>
    </div>
  </div>
)}
```

**Step 2: Run tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/browser/src/components/VideoDropzone.tsx
git commit -m "feat(dropzone): redesign HEVC modal with file info, time estimate, and progress"
```

---

### Task 7: Update Modal CSS

**Files:**
- Modify: `apps/browser/src/styles/global.css:3127-3291`

**Step 1: Add new CSS rules**

Add after existing `.hevc-modal-hint` rule (around line 3186):

```css
/* File info section */
.hevc-file-info {
  background-color: var(--color-bg-tertiary);
  padding: var(--spacing-md);
  border-radius: var(--border-radius-md);
  margin-bottom: var(--spacing-md);
}

.hevc-file-info p {
  margin: 0;
  color: var(--color-text);
  line-height: 1.8;
}

.hevc-file-info strong {
  color: var(--color-text-secondary);
  font-weight: 500;
  min-width: 80px;
  display: inline-block;
}

/* Time estimate section */
.hevc-time-estimate {
  margin-bottom: var(--spacing-md);
}

.hevc-time-estimate > p:first-child {
  margin: 0 0 var(--spacing-xs) 0;
  color: var(--color-text);
}

.hevc-time-estimate strong {
  color: var(--color-primary);
}

/* Tip section */
.hevc-tip {
  background-color: var(--color-bg-tertiary);
  padding: var(--spacing-md);
  border-radius: var(--border-radius-md);
  border-left: 3px solid var(--color-primary);
}

.hevc-tip h4 {
  margin: 0 0 var(--spacing-sm) 0;
  font-size: 0.9rem;
  color: var(--color-text);
}

.hevc-tip ol {
  margin: 0;
  padding-left: var(--spacing-lg);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  line-height: 1.6;
}

/* Progress container */
.hevc-progress-container {
  padding: var(--spacing-lg) 0;
}

.hevc-progress-status {
  margin: 0 0 var(--spacing-md) 0;
  color: var(--color-text);
  font-weight: 500;
}

.hevc-progress-bar {
  height: 8px;
  background-color: var(--color-bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.hevc-progress-fill {
  height: 100%;
  background-color: var(--color-primary);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.hevc-progress-info {
  display: flex;
  justify-content: space-between;
  margin-top: var(--spacing-sm);
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

/* Footer with two buttons */
.hevc-modal-footer {
  padding: var(--spacing-md) var(--spacing-lg);
  border-top: 1px solid var(--color-bg-tertiary);
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-md);
}
```

**Step 2: Remove old option styles if no longer needed**

The old `.hevc-option`, `.hevc-option-divider` styles can be removed (lines ~3193-3233) since we no longer use that layout.

**Step 3: Run app to verify visually**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm run dev`
Open: http://localhost:5173 and test with an HEVC file

**Step 4: Commit**

```bash
git add apps/browser/src/styles/global.css
git commit -m "style(modal): update CSS for redesigned HEVC modal"
```

---

### Task 8: Write Integration Test for Modal

**Files:**
- Create: `apps/browser/src/components/VideoDropzone.test.tsx`

**Step 1: Create test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VideoDropzone } from './VideoDropzone'

// Mock ffmpeg-client
vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  detectVideoCodec: vi.fn(),
  transcodeHevcToH264: vi.fn(),
  estimateTranscodeTime: vi.fn().mockReturnValue({
    minMinutes: 2,
    maxMinutes: 4,
    formatted: '2-4 minutes'
  }),
  formatRemainingTime: vi.fn().mockReturnValue('2 min remaining'),
  SUPPORTED_CODECS: ['H.264', 'VP8', 'VP9'],
}))

// Mock streaming-processor
vi.mock('../lib/streaming-processor', () => ({
  processVideoFile: vi.fn().mockResolvedValue(undefined),
}))

// Mock the store
vi.mock('../stores/processingStore', () => ({
  useProcessingStore: () => ({
    status: 'idle',
    progress: 0,
    progressMessage: '',
    fileName: '',
    setProgress: vi.fn(),
    setStatus: vi.fn(),
  }),
}))

describe('VideoDropzone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders dropzone initially', () => {
    render(<VideoDropzone />)
    expect(screen.getByText('Drop your golf video here')).toBeInTheDocument()
    expect(screen.getByText('Select File')).toBeInTheDocument()
  })

  describe('HEVC Modal', () => {
    it('shows modal with file info when HEVC detected', async () => {
      const { detectVideoCodec } = await import('../lib/ffmpeg-client')
      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'hevc',
        isHevc: true,
        isPlayable: false,
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mov', { type: 'video/quicktime' })
      Object.defineProperty(file, 'size', { value: 200 * 1024 * 1024 }) // 200MB

      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('Unsupported Video Format')).toBeInTheDocument()
      })

      expect(screen.getByText(/HEVC encoding/)).toBeInTheDocument()
      expect(screen.getByText(/200 MB/)).toBeInTheDocument()
      expect(screen.getByText('2-4 minutes')).toBeInTheDocument()
      expect(screen.getByText('Start Transcoding')).toBeInTheDocument()
      expect(screen.getByText('Upload Different Video')).toBeInTheDocument()
    })

    it('closes modal and resets when Upload Different Video clicked', async () => {
      const { detectVideoCodec } = await import('../lib/ffmpeg-client')
      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'hevc',
        isHevc: true,
        isPlayable: false,
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mov', { type: 'video/quicktime' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('Unsupported Video Format')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Upload Different Video'))

      await waitFor(() => {
        expect(screen.queryByText('Unsupported Video Format')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Drop your golf video here')).toBeInTheDocument()
    })

    it('shows progress during transcoding', async () => {
      const { detectVideoCodec, transcodeHevcToH264 } = await import('../lib/ffmpeg-client')
      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'hevc',
        isHevc: true,
        isPlayable: false,
      })

      // Simulate slow transcode with progress
      vi.mocked(transcodeHevcToH264).mockImplementation(async (_blob, onProgress) => {
        onProgress?.(25)
        await new Promise(r => setTimeout(r, 100))
        onProgress?.(50)
        return new Blob(['transcoded'], { type: 'video/mp4' })
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mov', { type: 'video/quicktime' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('Start Transcoding')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Start Transcoding'))

      await waitFor(() => {
        expect(screen.getByText('Converting video...')).toBeInTheDocument()
      })

      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })
  })
})
```

**Step 2: Run tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test -- VideoDropzone.test.tsx`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/browser/src/components/VideoDropzone.test.tsx
git commit -m "test(dropzone): add tests for HEVC modal with file info and progress"
```

---

### Task 9: Final Integration Test

**Files:**
- Manual testing

**Step 1: Start dev server**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm run dev`

**Step 2: Test with HEVC file**

1. Open http://localhost:5173
2. Select an HEVC video file (e.g., iPhone 4K 60fps MOV)
3. Verify modal appears with:
   - Detected codec (HEVC)
   - File size in MB
   - Supported formats list
   - Time estimate
   - iPhone tip with instructions
   - "Start Transcoding" and "Upload Different Video" buttons

**Step 3: Test transcoding flow**

1. Click "Start Transcoding"
2. Verify:
   - Progress bar appears
   - Percentage updates
   - Time remaining shows
   - Cancel button appears
3. Either let it complete or click Cancel

**Step 4: Test cancel**

1. Upload HEVC file
2. Click "Start Transcoding"
3. Click "Cancel" during transcoding
4. Verify modal returns to initial state (not closed)

**Step 5: Test Upload Different Video**

1. Upload HEVC file
2. Click "Upload Different Video"
3. Verify modal closes and dropzone is ready for new file

**Step 6: Run all tests**

Run: `cd C:\Users\Eli\projects\golf-clip\apps\browser && npm test`
Expected: All 136+ tests pass

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat(dropzone): complete HEVC modal refactor with progress and cancel support"
```

---

## Summary

This plan refactors the HEVC modal to:
1. Show detected codec and file size
2. Display supported formats list
3. Provide time estimate based on file size
4. Include iPhone re-export tip inline
5. Offer "Start Transcoding" and "Upload Different Video" buttons
6. Show progress bar with percentage and time remaining during transcode
7. Allow cancellation during transcode
8. Reset to dropzone when "Upload Different Video" clicked

Total tasks: 9
Estimated time: Each task is 2-5 minutes

---

Plan complete and saved to `C:\Users\Eli\projects\golf-clip\docs\plans\2026-01-31-hevc-modal-refactor.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
