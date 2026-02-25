// apps/browser/src/components/VideoDropzone.tsx
import { useCallback, useState, useRef, useEffect } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { processVideoFile } from '../lib/streaming-processor'
import { loadFFmpeg, detectVideoCodec, transcodeHevcToH264 } from '../lib/ffmpeg-client'
import {
  HevcTranscodeModal,
  HevcTranscodeModalState,
  initialHevcTranscodeModalState,
} from './HevcTranscodeModal'

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v']
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.m4v']
const MAX_FILE_SIZE_GB = 2 // Browser has lower limit due to memory constraints

/** Generate unique video ID */
function generateVideoId(): string {
  return `video-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/** Extended state for VideoDropzone HEVC modal (includes file info for display) */
interface HevcWarningState extends HevcTranscodeModalState {
  file: File | null
  codec: string
  fileSizeMB: number
}

const initialHevcState: HevcWarningState = {
  ...initialHevcTranscodeModalState,
  file: null,
  codec: '',
  fileSizeMB: 0,
}

/** Store actions needed for background processing */
interface BackgroundProcessingActions {
  addVideo: (id: string, fileName: string) => void
  setVideoError: (id: string, error: string) => void
}

/**
 * Process a single file in the background without blocking.
 * Adds video to store immediately, then starts processing.
 *
 * @param file - The video file to process
 * @param videoId - Unique identifier for this video
 * @param storeActions - Store actions (defaults to real store, can be injected for testing)
 */
async function processFileInBackground(
  file: File,
  videoId: string,
  storeActions?: BackgroundProcessingActions,
) {
  // Get store actions - use injected actions if provided (for testing), otherwise get from real store
  const actions = storeActions ?? useProcessingStore.getState()

  // Add video to store immediately with 'pending' status
  actions.addVideo(videoId, file.name)

  try {
    // Check codec before processing
    await loadFFmpeg()
    const codecInfo = await detectVideoCodec(file)

    if (codecInfo.isHevc) {
      // For HEVC in multi-file mode, mark as error (user can handle individually)
      actions.setVideoError(videoId, `HEVC codec detected - needs transcoding`)
      return
    }

    // Process the video
    await processVideoFile(file, videoId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    actions.setVideoError(videoId, message)
  }
}

export function VideoDropzone() {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCheckingCodec] = useState(false) // Kept for legacy progress view - set via per-video state now
  const [hevcWarning, setHevcWarning] = useState<HevcWarningState>(initialHevcState)
  const {
    status: globalStatus,
    progress: globalProgress,
    progressMessage: globalProgressMessage,
    fileName: globalFileName,
    setStatus,
    videos,
  } = useProcessingStore()

  // Bridge per-video state to progress display: find first actively processing video
  const activeProcessingVideo = (() => {
    if (!videos || !(videos instanceof Map)) return null
    for (const [, v] of videos) {
      if (v.status === 'pending' || v.status === 'loading' || v.status === 'processing') return v
    }
    return null
  })()
  const status = activeProcessingVideo?.status ?? globalStatus
  const progress = activeProcessingVideo?.progress ?? globalProgress
  const progressMessage = activeProcessingVideo?.progressMessage ?? globalProgressMessage
  const fileName = activeProcessingVideo?.fileName ?? globalFileName
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  const transcodeAbortRef = useRef<AbortController | null>(null)

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  const validateFile = (file: File): string | null => {
    const hasValidType = ACCEPTED_TYPES.includes(file.type)
    const hasValidExtension = ACCEPTED_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext),
    )

    if (!hasValidType && !hasValidExtension) {
      return 'Please select a video file (MP4, MOV, M4V)'
    }

    const fileSizeGB = file.size / (1024 * 1024 * 1024)
    if (fileSizeGB > MAX_FILE_SIZE_GB) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE_GB}GB for browser processing`
    }

    return null
  }

  const handleTranscode = useCallback(async () => {
    if (!hevcWarning.file) return

    const file = hevcWarning.file
    const videoId = (hevcWarning as HevcWarningState & { videoId?: string }).videoId

    // Create abort controller for cancellation
    transcodeAbortRef.current = new AbortController()

    // Update state to show transcoding progress in modal
    setHevcWarning((prev) => ({
      ...prev,
      isTranscoding: true,
      transcodeProgress: 0,
      transcodeStartTime: Date.now(),
    }))

    try {
      const h264Blob = await transcodeHevcToH264(
        file,
        (percent) => {
          setHevcWarning((prev) => ({
            ...prev,
            transcodeProgress: percent,
          }))
        },
        transcodeAbortRef.current.signal,
      )

      // Create a File from the blob to pass to processVideoFile
      const h264File = new File([h264Blob], file.name.replace(/\.[^.]+$/, '_h264.mp4'), {
        type: 'video/mp4',
      })

      // Close modal and process the transcoded file
      setHevcWarning(initialHevcState)
      await processVideoFile(h264File, videoId)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled - reset to initial modal state
        setHevcWarning((prev) => ({
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
  }, [hevcWarning, setStatus])

  const handleCancelHevc = useCallback(() => {
    if (hevcWarning.isTranscoding) {
      // During transcoding: just abort, let the catch handler reset the modal state
      transcodeAbortRef.current?.abort()
    } else {
      // Before transcoding started: close the modal entirely
      transcodeAbortRef.current?.abort()
      setHevcWarning(initialHevcState)
    }
  }, [hevcWarning.isTranscoding])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
  }, [])

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

    // Process each file - don't await, let them run in parallel
    const skippedFiles: string[] = []
    let validCount = 0
    for (const file of files) {
      const validationError = validateFile(file)
      if (validationError) {
        skippedFiles.push(file.name)
        continue
      }

      validCount++
      const videoId = generateVideoId()
      // Fire and forget - don't block
      processFileInBackground(file, videoId)
    }

    // Show error for invalid files
    if (skippedFiles.length > 0 && validCount === 0) {
      setError('Unsupported file type. Please select a video file (MP4, MOV, M4V).')
    } else if (skippedFiles.length > 0) {
      setError(`Skipped ${skippedFiles.length} unsupported file(s): ${skippedFiles.join(', ')}`)
    }
  }, [])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setError(null)

    // Process each file - don't await
    const skippedFiles: string[] = []
    let validCount = 0
    for (const file of files) {
      const validationError = validateFile(file)
      if (validationError) {
        skippedFiles.push(file.name)
        continue
      }

      validCount++
      const videoId = generateVideoId()
      processFileInBackground(file, videoId)
    }

    // Show error for invalid files
    if (skippedFiles.length > 0 && validCount === 0) {
      setError('Unsupported file type. Please select a video file (MP4, MOV, M4V).')
    } else if (skippedFiles.length > 0) {
      setError(`Skipped ${skippedFiles.length} unsupported file(s): ${skippedFiles.join(', ')}`)
    }

    e.target.value = ''
  }, [])

  const handleFileSelect = () => {
    fileInputRef.current?.click()
  }

  // Show checking codec state
  if (isCheckingCodec) {
    return (
      <div className="dropzone">
        <div className="dropzone-content">
          <div className="upload-progress-container">
            <div className="upload-progress-text">
              <span className="spinner" />
              Checking video format...
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show progress view when pending/loading/processing
  if (status === 'pending' || status === 'loading' || status === 'processing') {
    return (
      <div className="dropzone">
        <div className="dropzone-content">
          <div className="upload-progress-container">
            <div className="upload-progress-text">
              <span className="spinner" />
              {progressMessage || 'Processing...'}
            </div>
            <div className="upload-progress-bar">
              <div className="upload-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="upload-progress-percent">{progress}%</div>
            {fileName && <p className="dropzone-hint">{fileName}</p>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className={`dropzone ${isDragging ? 'dropzone-active' : ''} ${error ? 'dropzone-has-error' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="dropzone-content">
          <div className="dropzone-icon" aria-hidden="true">
            {isDragging ? '📥' : '🎬'}
          </div>
          <h2>{isDragging ? 'Drop it here!' : 'Drop your golf video here'}</h2>
          <p>or</p>
          <button onClick={handleFileSelect} className="btn-primary">
            Select File
          </button>
          <p className="dropzone-hint">Supports MP4, MOV, M4V (up to {MAX_FILE_SIZE_GB}GB)</p>
          <p className="dropzone-hint-secondary">
            Processing happens in your browser - no upload required
          </p>

          {error && (
            <div className="dropzone-error" role="alert">
              <span className="error-icon">⚠</span>
              {error}
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v"
          multiple
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          aria-hidden="true"
        />
      </div>

      {/* HEVC Warning Modal */}
      <HevcTranscodeModal
        state={hevcWarning}
        title="Unsupported Video Format"
        description="This video uses an unsupported codec and needs to be converted."
        fileInfo={
          hevcWarning.show
            ? { codec: hevcWarning.codec, fileSizeMB: hevcWarning.fileSizeMB }
            : undefined
        }
        showTip={true}
        cancelLabel="Upload Different Video"
        startLabel="Start Transcoding"
        onStartTranscode={handleTranscode}
        onCancel={handleCancelHevc}
      />
    </>
  )
}
