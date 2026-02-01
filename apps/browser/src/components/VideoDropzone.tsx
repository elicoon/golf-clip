// apps/browser/src/components/VideoDropzone.tsx
import { useCallback, useState, useRef } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { processVideoFile } from '../lib/streaming-processor'
import { loadFFmpeg, detectVideoCodec, transcodeHevcToH264, estimateTranscodeTime, formatRemainingTime, SUPPORTED_CODECS } from '../lib/ffmpeg-client'

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v']
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.m4v']
const MAX_FILE_SIZE_GB = 2 // Browser has lower limit due to memory constraints

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

export function VideoDropzone() {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCheckingCodec, setIsCheckingCodec] = useState(false)
  const [hevcWarning, setHevcWarning] = useState<HevcWarningState>(initialHevcState)
  const { status, progress, progressMessage, fileName, setProgress, setStatus } = useProcessingStore()
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
    console.log('[VideoDropzone] Starting codec check for file:', file.name)
    try {
      await loadFFmpeg()
      console.log('[VideoDropzone] FFmpeg loaded, detecting codec...')
      const codecInfo = await detectVideoCodec(file)
      console.log('[VideoDropzone] Codec detection result:', codecInfo)

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

      // Codec is playable, proceed with processing
      console.log('[VideoDropzone] Codec is playable, proceeding with processing')
      await processVideoFile(file)
    } catch (err) {
      // If codec detection fails, try processing anyway
      console.warn('[VideoDropzone] Codec detection failed, proceeding with processing:', err)
      await processVideoFile(file)
    } finally {
      setIsCheckingCodec(false)
    }
  }, [])

  const handleTranscode = useCallback(async () => {
    if (!hevcWarning.file) return

    const file = hevcWarning.file
    setHevcWarning(initialHevcState)
    setStatus('loading')
    setProgress(0, 'Converting HEVC to H.264...')

    try {
      const h264Blob = await transcodeHevcToH264(file, (percent) => {
        setProgress(percent * 0.4, `Converting video... ${percent}%`)
      })

      // Create a File from the blob to pass to processVideoFile
      const h264File = new File([h264Blob], file.name.replace(/\.[^.]+$/, '_h264.mp4'), {
        type: 'video/mp4'
      })

      // Process the transcoded file (skip codec check since we just created H.264)
      await processVideoFile(h264File)
    } catch (err) {
      setError(`Transcode failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      setStatus('idle')
    }
  }, [hevcWarning.file, setProgress, setStatus])

  const handleCancelHevc = useCallback(() => {
    setHevcWarning(initialHevcState)
  }, [])

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
      {hevcWarning.show && (
        <div className="hevc-modal-overlay">
          <div className="hevc-modal">
            <div className="hevc-modal-header">
              <span className="hevc-warning-icon">⚠</span>
              <h3>Unsupported Video Format</h3>
            </div>
            <div className="hevc-modal-content">
              <p>
                This video uses <strong>{hevcWarning.codec}</strong> encoding, which browsers
                cannot play natively.
              </p>
              <p className="hevc-modal-hint">
                This is common with iPhone videos recorded at 4K 60fps, even when exported
                as "Most Compatible".
              </p>
              <div className="hevc-modal-options">
                <div className="hevc-option">
                  <h4>Option 1: Convert in browser</h4>
                  <p>We can convert the video to a compatible format. This may take several minutes for large files.</p>
                  <button onClick={handleTranscode} className="btn-primary">
                    Convert Video
                  </button>
                </div>
                <div className="hevc-option-divider">or</div>
                <div className="hevc-option">
                  <h4>Option 2: Re-export from iPhone</h4>
                  <p>For faster results, re-export from iPhone using:</p>
                  <ol>
                    <li>Open the video in Photos app</li>
                    <li>Tap Share, then "Save to Files"</li>
                    <li>Choose "More Compatible" format</li>
                  </ol>
                </div>
              </div>
            </div>
            <div className="hevc-modal-footer">
              <button onClick={handleCancelHevc} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
