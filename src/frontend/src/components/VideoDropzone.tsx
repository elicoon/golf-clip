import { useState, useCallback, useRef, useEffect } from 'react'

interface UploadedFile {
  filename: string
  path: string
  size: number
}

// UploadError interface is intentionally unused in this component
// but kept for potential future use with batch upload error handling

interface VideoDropzoneProps {
  onVideosSelected: (files: UploadedFile[]) => void
  // Keep backward compatibility with single file selection
  onVideoSelected?: (filePath: string) => void
}

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/x-m4v']
const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.m4v']
const MAX_FILE_SIZE_GB = 100

interface FileUploadState {
  file: File
  status: 'pending' | 'uploading' | 'complete' | 'error'
  progress: number
  error?: string
  result?: UploadedFile
}

export function VideoDropzone({ onVideosSelected, onVideoSelected }: VideoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [uploadStates, setUploadStates] = useState<FileUploadState[]>([])
  const [manualPath, setManualPath] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  // Track active XHRs for cleanup on unmount
  const activeXhrsRef = useRef<Set<XMLHttpRequest>>(new Set())
  const isMountedRef = useRef(true)

  // Cleanup active XHRs on unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Abort all active XHRs
      activeXhrsRef.current.forEach(xhr => xhr.abort())
      activeXhrsRef.current.clear()
    }
  }, [])

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

  const uploadSingleFile = async (file: File, index: number): Promise<UploadedFile | null> => {
    // Check if running in Tauri (has native file path access)
    const nativePath = (file as any).path
    if (nativePath) {
      // Tauri mode: use native path directly
      return {
        filename: file.name,
        path: nativePath,
        size: file.size,
      }
    }

    // Browser mode: upload file to server
    return new Promise((resolve) => {
      const formData = new FormData()
      formData.append('file', file)

      const xhr = new XMLHttpRequest()
      // Track this XHR for cleanup
      activeXhrsRef.current.add(xhr)

      xhr.upload.addEventListener('progress', (event) => {
        if (!isMountedRef.current) return
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadStates(prev => prev.map((state, i) =>
            i === index ? { ...state, progress: percent } : state
          ))
        }
      })

      xhr.addEventListener('load', () => {
        activeXhrsRef.current.delete(xhr)
        if (!isMountedRef.current) return
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            setUploadStates(prev => prev.map((state, i) =>
              i === index ? { ...state, status: 'complete', result: data } : state
            ))
            resolve(data)
          } catch {
            setUploadStates(prev => prev.map((state, i) =>
              i === index ? { ...state, status: 'error', error: 'Invalid response from server' } : state
            ))
            resolve(null)
          }
        } else {
          let errorMessage = `Upload failed: ${xhr.status}`
          try {
            const errorData = JSON.parse(xhr.responseText)
            if (errorData.detail) errorMessage = errorData.detail
          } catch {
            // Use default error message
          }
          setUploadStates(prev => prev.map((state, i) =>
            i === index ? { ...state, status: 'error', error: errorMessage } : state
          ))
          resolve(null)
        }
      })

      xhr.addEventListener('error', () => {
        activeXhrsRef.current.delete(xhr)
        if (!isMountedRef.current) return
        setUploadStates(prev => prev.map((state, i) =>
          i === index ? { ...state, status: 'error', error: 'Network error' } : state
        ))
        resolve(null)
      })

      setUploadStates(prev => prev.map((state, i) =>
        i === index ? { ...state, status: 'uploading' } : state
      ))

      xhr.open('POST', 'http://127.0.0.1:8420/api/upload')
      xhr.send(formData)
    })
  }

  const handleFiles = useCallback(async (files: File[]) => {
    // Validate all files first
    const validFiles: File[] = []
    const validationErrors: string[] = []

    for (const file of files) {
      const validationError = validateFile(file)
      if (validationError) {
        validationErrors.push(`${file.name}: ${validationError}`)
      } else {
        validFiles.push(file)
      }
    }

    if (validationErrors.length > 0 && validFiles.length === 0) {
      setError(validationErrors.join('\n'))
      return
    }

    if (validFiles.length === 0) {
      setError('No valid video files selected')
      return
    }

    setError(null)
    setIsLoading(true)

    // Initialize upload states
    const initialStates: FileUploadState[] = validFiles.map(file => ({
      file,
      status: 'pending',
      progress: 0,
    }))
    setUploadStates(initialStates)

    // Upload all files (sequentially to avoid overwhelming the server)
    const results: UploadedFile[] = []
    for (let i = 0; i < validFiles.length; i++) {
      const result = await uploadSingleFile(validFiles[i], i)
      if (result) {
        results.push(result)
      }
    }

    setIsLoading(false)

    if (results.length > 0) {
      // Notify parent of uploaded files
      onVideosSelected(results)

      // For backward compatibility, if only one file and onVideoSelected is provided
      if (results.length === 1 && onVideoSelected) {
        onVideoSelected(results[0].path)
      }
    } else {
      setError('All uploads failed')
    }

    // Clear upload states after a short delay
    setTimeout(() => {
      setUploadStates([])
    }, 2000)
  }, [onVideosSelected, onVideoSelected])

  // Note: handleFile was removed as we now use handleFiles directly
  // Single files are handled via handleFiles([file])

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

      handleFiles(files)
    },
    [handleFiles]
  )

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        handleFiles(Array.from(files))
      }
      // Reset the input so the same file can be selected again
      e.target.value = ''
    },
    [handleFiles]
  )

  const handleFileSelect = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Try to use Tauri's file dialog first
      // @ts-ignore - Tauri API may not be available
      const { open } = await import('@tauri-apps/api/dialog')
      const selected = await open({
        multiple: true,  // Allow multiple file selection in Tauri
        filters: [
          {
            name: 'Video',
            extensions: ['mp4', 'mov', 'm4v'],
          },
        ],
      })

      if (selected) {
        // selected can be string (single file) or string[] (multiple files)
        const paths = Array.isArray(selected) ? selected : [selected]
        const results: UploadedFile[] = paths.map(path => ({
          filename: path.split('/').pop() || path,
          path,
          size: 0,  // Size not available from Tauri dialog
        }))

        if (results.length > 0) {
          onVideosSelected(results)
          if (results.length === 1 && onVideoSelected) {
            onVideoSelected(results[0].path)
          }
        }
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
      const result: UploadedFile = {
        filename: manualPath.trim().split('/').pop() || manualPath.trim(),
        path: manualPath.trim(),
        size: 0,
      }
      onVideosSelected([result])
      if (onVideoSelected) {
        onVideoSelected(manualPath.trim())
      }
    }
  }

  const totalProgress = uploadStates.length > 0
    ? Math.round(uploadStates.reduce((sum, s) => sum + s.progress, 0) / uploadStates.length)
    : 0

  const completedCount = uploadStates.filter(s => s.status === 'complete').length
  const errorCount = uploadStates.filter(s => s.status === 'error').length

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
        <h2>{isDragging ? 'Drop it here!' : 'Drop your golf videos here'}</h2>
        <p>or</p>
        {isLoading && uploadStates.length > 0 ? (
          <div className="upload-progress-container">
            <div className="upload-progress-text">
              <span className="spinner" />
              Uploading {uploadStates.length} file{uploadStates.length > 1 ? 's' : ''}...
            </div>
            <div className="upload-progress-bar">
              <div
                className="upload-progress-fill"
                style={{ width: `${totalProgress}%` }}
              />
            </div>
            <div className="upload-progress-percent">
              {completedCount}/{uploadStates.length} complete
              {errorCount > 0 && ` (${errorCount} failed)`}
            </div>
            {/* Individual file progress */}
            <div className="upload-files-list">
              {uploadStates.map((state, index) => (
                <div key={index} className={`upload-file-item upload-file-${state.status}`}>
                  <span className="upload-file-name" title={state.file.name}>
                    {state.file.name.length > 30
                      ? state.file.name.substring(0, 27) + '...'
                      : state.file.name}
                  </span>
                  <span className="upload-file-status">
                    {state.status === 'pending' && 'Waiting...'}
                    {state.status === 'uploading' && `${state.progress}%`}
                    {state.status === 'complete' && 'Done'}
                    {state.status === 'error' && state.error}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
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
              'Select Files'
            )}
          </button>
        )}
        <p className="dropzone-hint">Supports MP4, MOV, M4V (up to {MAX_FILE_SIZE_GB}GB each)</p>
        <p className="dropzone-hint-secondary">You can select multiple videos at once</p>

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

      {/* Hidden file input for web fallback - now allows multiple */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        multiple
      />
    </div>
  )
}
