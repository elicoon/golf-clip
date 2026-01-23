import { useState, useCallback, useRef } from 'react'

interface VideoDropzoneProps {
  onVideoSelected: (filePath: string) => void
}

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v']
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.m4v']
const MAX_FILE_SIZE_GB = 100

export function VideoDropzone({ onVideoSelected }: VideoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [manualPath, setManualPath] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const validateFile = (file: File): string | null => {
    // Check file type
    const hasValidType = ACCEPTED_TYPES.includes(file.type)
    const hasValidExtension = ACCEPTED_EXTENSIONS.some(ext =>
      file.name.toLowerCase().endsWith(ext)
    )

    if (!hasValidType && !hasValidExtension) {
      return 'Please select a video file (MP4, MOV, M4V)'
    }

    // Check file size (rough check, 100GB limit)
    const fileSizeGB = file.size / (1024 * 1024 * 1024)
    if (fileSizeGB > MAX_FILE_SIZE_GB) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE_GB}GB`
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

    // Check if running in Tauri (has native file path access)
    const nativePath = (file as any).path
    if (nativePath) {
      // Tauri mode: use native path directly
      onVideoSelected(nativePath)
      return
    }

    // Browser mode: upload file to server
    setIsLoading(true)
    setUploadProgress('Preparing upload...')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1)
      setUploadProgress(`Uploading ${file.name} (${fileSizeMB} MB)...`)

      const response = await fetch('http://127.0.0.1:8420/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Upload failed: ${response.status}`)
      }

      const data = await response.json()
      setUploadProgress(null)

      // Use the server path for processing
      onVideoSelected(data.path)

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
      setUploadProgress(null)
    } finally {
      setIsLoading(false)
    }
  }, [onVideoSelected])

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

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
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

      if (files.length > 1) {
        setError('Please drop only one video file at a time')
        return
      }

      handleFile(files[0])
    },
    [handleFile]
  )

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFile(files[0])
      }
      // Reset the input so the same file can be selected again
      e.target.value = ''
    },
    [handleFile]
  )

  const handleFileSelect = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Try to use Tauri's file dialog first
      // @ts-ignore - Tauri API may not be available
      const { open } = await import('@tauri-apps/api/dialog')
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Video',
            extensions: ['mp4', 'mov', 'm4v'],
          },
        ],
      })

      if (selected && typeof selected === 'string') {
        onVideoSelected(selected)
      }
    } catch {
      // Fallback to native file input for web/development
      if (fileInputRef.current) {
        fileInputRef.current.click()
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleFileSelect()
    }
  }

  const handleManualPathSubmit = () => {
    if (manualPath.trim()) {
      setError(null)
      onVideoSelected(manualPath.trim())
    }
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
        <button
          onClick={handleFileSelect}
          className="btn-primary"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <span className="spinner" />
              {uploadProgress || 'Loading...'}
            </>
          ) : (
            'Select File'
          )}
        </button>
        <p className="dropzone-hint">Supports MP4, MOV, M4V (up to {MAX_FILE_SIZE_GB}GB)</p>

        {/* Dev mode: manual path input */}
        <div className="manual-path-section">
          <button
            onClick={() => setShowManualInput(!showManualInput)}
            className="btn-link"
            type="button"
          >
            {showManualInput ? 'Hide' : 'Enter path manually'} (dev mode)
          </button>
          {showManualInput && (
            <div className="manual-path-input">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="/path/to/your/video.mp4"
                onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
              />
              <button onClick={handleManualPathSubmit} className="btn-secondary">
                Load
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="dropzone-error" role="alert">
            <span className="error-icon">⚠</span>
            {error}
          </div>
        )}
      </div>

      {/* Hidden file input for web fallback */}
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
