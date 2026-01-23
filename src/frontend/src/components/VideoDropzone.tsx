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

  const handleFile = useCallback((file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)

    // In Tauri, we can get the file path directly
    // For web/development, use the file name
    const filePath = (file as any).path || file.name
    onVideoSelected(filePath)
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
              Loading...
            </>
          ) : (
            'Select File'
          )}
        </button>
        <p className="dropzone-hint">Supports MP4, MOV, M4V (up to {MAX_FILE_SIZE_GB}GB)</p>
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
