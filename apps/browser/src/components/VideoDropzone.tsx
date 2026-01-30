// apps/browser/src/components/VideoDropzone.tsx
import { useCallback, useState } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { processVideoFile } from '../lib/streaming-processor'

export function VideoDropzone() {
  const [isDragging, setIsDragging] = useState(false)
  const { status, progress, progressMessage, fileName } = useProcessingStore()

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('video/')) {
      alert('Please drop a video file')
      return
    }

    // Warn for large files
    if (file.size > 500_000_000) {
      const proceed = confirm(
        `This file is ${(file.size / 1_000_000).toFixed(0)}MB. ` +
        'Large files may take longer to process. Continue?'
      )
      if (!proceed) return
    }

    await processVideoFile(file)
  }, [])

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('video/')) {
      alert('Please select a video file')
      return
    }

    if (file.size > 500_000_000) {
      const proceed = confirm(
        `This file is ${(file.size / 1_000_000).toFixed(0)}MB. ` +
        'Large files may take longer to process. Continue?'
      )
      if (!proceed) return
    }

    await processVideoFile(file)
  }, [])

  if (status === 'loading' || status === 'processing') {
    return (
      <div style={styles.container}>
        <div
          style={styles.progress}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Processing progress"
        >
          <div style={{ ...styles.progressBar, width: `${progress}%` }} />
        </div>
        <p>{progressMessage || 'Processing...'}</p>
        {fileName && <p style={styles.fileName}>{fileName}</p>}
      </div>
    )
  }

  return (
    <div
      style={{
        ...styles.container,
        ...(isDragging ? styles.dragging : {}),
      }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <p>Drop a golf video here</p>
      <p style={styles.hint}>or</p>
      <label style={styles.button}>
        Choose File
        <input
          type="file"
          accept="video/*"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />
      </label>
      <p style={styles.hint}>Supports MP4, MOV, and most video formats</p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: '2px dashed #ccc',
    borderRadius: '8px',
    padding: '3rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  dragging: {
    borderColor: '#007bff',
    backgroundColor: '#f0f7ff',
  },
  hint: {
    color: '#666',
    fontSize: '0.9rem',
    margin: '0.5rem 0',
  },
  button: {
    display: 'inline-block',
    padding: '0.5rem 1rem',
    backgroundColor: '#007bff',
    color: 'white',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  progress: {
    width: '100%',
    height: '8px',
    backgroundColor: '#e0e0e0',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '1rem',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#007bff',
    transition: 'width 0.3s',
  },
  fileName: {
    color: '#666',
    fontSize: '0.85rem',
  },
}
