// apps/browser/src/components/VideoDropzone.tsx
import { useCallback, useState, useRef } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { processVideoFile } from '../lib/streaming-processor'
import { loadFFmpeg, detectVideoCodec, transcodeHevcToH264, estimateTranscodeTime } from '../lib/ffmpeg-client'
import { HevcTranscodeModal, HevcTranscodeModalState, initialHevcTranscodeModalState } from './HevcTranscodeModal'

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v']
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.m4v']
const MAX_FILE_SIZE_GB = 2 // Browser has lower limit due to memory constraints

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

export function VideoDropzone() {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCheckingCodec, setIsCheckingCodec] = useState(false)
  const [hevcWarning, setHevcWarning] = useState<HevcWarningState>(initialHevcState)
  const { status, progress, progressMessage, fileName, setStatus } = useProcessingStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  const transcodeAbortRef = useRef<AbortController | null>(null)

  const validateFile = (file: File): string | null => {
    const hasValidType = ACCEPTED_TYPES.includes(file.type)
    const hasValidExtension = ACCEPTED_EXTENSIONS.some(ext =>
      file.name.toLowerCase().endsWith(ext)
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

  const handleFile = useCallback(async (file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)

    // Check codec before processing
    setIsCheckingCodec(true)
    try {
      await loadFFmpeg()
      const codecInfo = await detectVideoCodec(file)

      if (codecInfo.isHevc) {
        // Calculate file info for modal
        const fileSizeMB = Math.round(file.size / (1024 * 1024))
        const { formatted: estimatedTime } = estimateTranscodeTime(fileSizeMB)

        setHevcWarning({
          show: true,
          file,
          codec: codecInfo.codec.toUpperCase(),
          fileSizeMB,
          estimatedTime,
          isTranscoding: false,
          transcodeProgress: 0,
          transcodeStartTime: null,
          // Required by base HevcTranscodeModalState but not used in VideoDropzone context
          segmentIndex: 0,
          segmentBlob: null,
        })
        setIsCheckingCodec(false)
        return
      }

      // Codec is playable, proceed with processing
      await processVideoFile(file)
    } catch {
      // If codec detection fails, try processing anyway
      await processVideoFile(file)
    } finally {
      setIsCheckingCodec(false)
    }
  }, [])

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

    const file = e.dataTransfer.files[0]
    if (!file) {
      setError('No file detected. Please try again.')
      return
    }

    handleFile(file)
  }, [handleFile])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFile(file)
    }
    e.target.value = ''
  }, [handleFile])

  const handleFileSelect = () => {
    fileInputRef.current?.click()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleFileSelect()
    }
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

  // Show progress view when loading/processing
  if (status === 'loading' || status === 'processing') {
    return (
      <div className="dropzone">
        <div className="dropzone-content">
          <div className="upload-progress-container">
            <div className="upload-progress-text">
              <span className="spinner" />
              {progressMessage || 'Processing...'}
            </div>
            <div className="upload-progress-bar">
              <div
                className="upload-progress-fill"
                style={{ width: `${progress}%` }}
              />
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
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label="Drop zone for video files"
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
          <p className="dropzone-hint-secondary">Processing happens in your browser - no upload required</p>

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
        fileInfo={hevcWarning.show ? { codec: hevcWarning.codec, fileSizeMB: hevcWarning.fileSizeMB } : undefined}
        showTip={true}
        cancelLabel="Upload Different Video"
        startLabel="Start Transcoding"
        onStartTranscode={handleTranscode}
        onCancel={handleCancelHevc}
      />
    </>
  )
}
