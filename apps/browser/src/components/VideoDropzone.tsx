// apps/browser/src/components/VideoDropzone.tsx
import { useCallback, useState, useRef } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { processVideoFile } from '../lib/streaming-processor'

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v']
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.m4v']
const MAX_FILE_SIZE_GB = 2 // Browser has lower limit due to memory constraints

export function VideoDropzone() {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { status, progress, progressMessage, fileName } = useProcessingStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

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
    await processVideoFile(file)
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
  )
}
