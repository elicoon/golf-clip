import { useState, useCallback } from 'react'

interface VideoDropzoneProps {
  onVideoSelected: (filePath: string) => void
}

export function VideoDropzone({ onVideoSelected }: VideoDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      setError(null)

      const files = Array.from(e.dataTransfer.files)
      const videoFile = files.find((f) =>
        ['video/mp4', 'video/quicktime', 'video/x-m4v'].includes(f.type)
      )

      if (!videoFile) {
        setError('Please drop a video file (MP4, MOV)')
        return
      }

      // In Tauri, we'd use the file path directly
      // For now, we'll use the file name as a placeholder
      // Real implementation would use Tauri's file dialog
      const filePath = (videoFile as any).path || videoFile.name
      onVideoSelected(filePath)
    },
    [onVideoSelected]
  )

  const handleFileSelect = async () => {
    // In Tauri, we'd open a file dialog
    // For development without Tauri, show a message
    try {
      // @ts-ignore - Tauri API
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
      // Fallback for development without Tauri
      setError('File dialog not available. Drag and drop a video file instead.')
    }
  }

  return (
    <div
      className={`dropzone ${isDragging ? 'dropzone-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="dropzone-content">
        <div className="dropzone-icon">🎬</div>
        <h2>Drop your golf video here</h2>
        <p>or</p>
        <button onClick={handleFileSelect} className="btn-primary">
          Select File
        </button>
        <p className="dropzone-hint">Supports MP4, MOV (up to 100GB)</p>
        {error && <p className="dropzone-error">{error}</p>}
      </div>
    </div>
  )
}
