import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import { Scrubber } from './Scrubber'

interface ClipReviewProps {
  jobId: string
  videoPath: string
  onComplete: (exportedClips: string[]) => void
}

type LoadingState = 'idle' | 'loading' | 'error'

interface ExportProgress {
  export_job_id: string
  status: string
  total_clips: number
  exported_count: number
  current_clip: number | null
  progress: number
  output_dir: string
  exported: string[]
  errors: { shot_id: number; error: string }[]
  has_errors: boolean
}

export function ClipReview({ jobId, videoPath, onComplete }: ClipReviewProps) {
  const { shots, updateShot } = useAppStore()
  const [currentShotIndex, setCurrentShotIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [videoLoaded, setVideoLoaded] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter to shots needing review (confidence < 70%)
  const shotsNeedingReview = shots.filter((s) => s.confidence < 0.7)
  const currentShot = shotsNeedingReview[currentShotIndex]

  // Seek to clip start when shot changes
  useEffect(() => {
    if (videoRef.current && currentShot) {
      videoRef.current.currentTime = currentShot.clip_start
    }
  }, [currentShot])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlayPause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey) {
            // Jump 1 second back
            stepTime(-1)
          } else {
            // Step one frame back
            stepFrame(-1)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey) {
            // Jump 1 second forward
            stepTime(1)
          } else {
            // Step one frame forward
            stepFrame(1)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          // Go to previous shot
          if (currentShotIndex > 0) {
            setCurrentShotIndex(currentShotIndex - 1)
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          // Go to next shot
          if (currentShotIndex < shotsNeedingReview.length - 1) {
            setCurrentShotIndex(currentShotIndex + 1)
          }
          break
        case 'Enter':
          e.preventDefault()
          handleAccept()
          break
        case 'Escape':
        case 'Backspace':
          e.preventDefault()
          handleReject()
          break
        case '[':
          // Set start to current time
          if (videoRef.current && currentShot) {
            const newStart = Math.max(0, videoRef.current.currentTime)
            if (newStart < currentShot.clip_end - 0.5) {
              handleTimeUpdate(newStart, currentShot.clip_end)
            }
          }
          break
        case ']':
          // Set end to current time
          if (videoRef.current && currentShot) {
            const newEnd = videoRef.current.currentTime
            if (newEnd > currentShot.clip_start + 0.5) {
              handleTimeUpdate(currentShot.clip_start, newEnd)
            }
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentShotIndex, shotsNeedingReview.length, currentShot])

  const handleTimeUpdate = (newStart: number, newEnd: number) => {
    if (currentShot) {
      updateShot(currentShot.id, {
        clip_start: newStart,
        clip_end: newEnd,
      })
    }
  }

  const handleAccept = async () => {
    if (!currentShot || loadingState === 'loading') return

    setLoadingState('loading')
    setErrorMessage(null)

    try {
      // Mark as approved (confidence = 1.0)
      updateShot(currentShot.id, { confidence: 1.0 })

      // Send update to server
      const response = await fetch(`http://127.0.0.1:8420/api/shots/${jobId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            shot_id: currentShot.id,
            start_time: currentShot.clip_start,
            end_time: currentShot.clip_end,
            approved: true,
          },
        ]),
      })

      if (!response.ok) {
        throw new Error('Failed to save shot')
      }

      setLoadingState('idle')

      // Move to next shot or complete
      if (currentShotIndex < shotsNeedingReview.length - 1) {
        setCurrentShotIndex(currentShotIndex + 1)
      } else {
        // All shots reviewed, export clips
        await exportClips()
        onComplete()
      }
    } catch (error) {
      setLoadingState('error')
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save shot')
    }
  }

  const handleReject = async () => {
    if (!currentShot || loadingState === 'loading') return

    // Skip this shot (don't include in export)
    updateShot(currentShot.id, { confidence: 0 })

    if (currentShotIndex < shotsNeedingReview.length - 1) {
      setCurrentShotIndex(currentShotIndex + 1)
    } else {
      await exportClips()
      onComplete()
    }
  }

  const exportClips = async () => {
    setLoadingState('loading')
    setErrorMessage(null)
    setShowExportModal(true)

    try {
      const approvedClips = shots
        .filter((s) => s.confidence >= 0.7)
        .map((s) => ({
          shot_id: s.id,
          start_time: s.clip_start,
          end_time: s.clip_end,
          approved: true,
        }))

      const outputDir = videoPath.replace(/\.[^.]+$/, '_clips')

      // Start export job
      const response = await fetch('http://127.0.0.1:8420/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          clips: approvedClips,
          output_dir: outputDir,
          filename_pattern: 'shot_{shot_id}',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start export')
      }

      const { export_job_id, total_clips } = await response.json()

      // Initialize export progress
      setExportProgress({
        export_job_id,
        status: 'pending',
        total_clips,
        exported_count: 0,
        current_clip: null,
        progress: 0,
        output_dir: outputDir,
        exported: [],
        errors: [],
        has_errors: false,
      })

      // Poll for progress
      await pollExportProgress(export_job_id)

    } catch (error) {
      setLoadingState('error')
      setShowExportModal(false)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to export clips')
    }
  }

  const pollExportProgress = async (exportJobId: string) => {
    const pollInterval = 500 // 500ms
    const maxAttempts = 600 // 5 minutes max

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:8420/api/export/${exportJobId}/status`)

        if (!response.ok) {
          throw new Error('Failed to get export status')
        }

        const status: ExportProgress = await response.json()
        setExportProgress(status)

        if (status.status === 'complete' || status.status === 'error') {
          setLoadingState('idle')
          // Keep modal open to show results
          return
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      } catch (error) {
        console.error('Error polling export status:', error)
        setLoadingState('error')
        setErrorMessage('Lost connection while exporting')
        return
      }
    }

    // Timeout
    setLoadingState('error')
    setErrorMessage('Export timed out')
  }

  const handleExportComplete = () => {
    const exported = exportProgress?.exported || []
    setShowExportModal(false)
    setExportProgress(null)
    onComplete(exported)
  }

  const togglePlayPause = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }, [isPlaying])

  const stepFrame = useCallback((direction: number) => {
    if (videoRef.current) {
      // Assuming 60fps (1/60 ≈ 0.0167 seconds per frame)
      videoRef.current.currentTime += direction * (1 / 60)
    }
  }, [])

  const stepTime = useCallback((seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds
    }
  }, [])

  const handleVideoLoad = () => {
    setVideoLoaded(true)
  }

  const handleVideoError = () => {
    setVideoLoaded(false)
    setErrorMessage('Failed to load video')
  }

  // Export progress modal
  const renderExportModal = () => {
    if (!showExportModal || !exportProgress) return null

    const isComplete = exportProgress.status === 'complete'
    const hasErrors = exportProgress.has_errors
    const isExporting = exportProgress.status === 'exporting' || exportProgress.status === 'pending'

    return (
      <div className="export-modal-overlay">
        <div className="export-modal">
          <div className="export-modal-header">
            <h3>{isComplete ? (hasErrors ? 'Export Completed with Errors' : 'Export Complete!') : 'Exporting Clips...'}</h3>
          </div>

          <div className="export-modal-content">
            {isExporting && (
              <>
                <div className="export-progress-bar">
                  <div
                    className="export-progress-fill"
                    style={{ width: `${exportProgress.progress}%` }}
                  />
                </div>
                <p className="export-status">
                  Exporting clip {exportProgress.exported_count + 1} of {exportProgress.total_clips}
                  {exportProgress.current_clip !== null && ` (Shot #${exportProgress.current_clip})`}
                </p>
              </>
            )}

            {isComplete && (
              <>
                <div className="export-success-icon">{hasErrors ? '⚠' : '✓'}</div>
                <p className="export-result">
                  {exportProgress.exported_count} of {exportProgress.total_clips} clips exported successfully
                </p>
                <p className="export-output-dir">
                  Saved to: <code>{exportProgress.output_dir}</code>
                </p>

                {hasErrors && exportProgress.errors.length > 0 && (
                  <div className="export-errors">
                    <p className="export-errors-title">Failed exports:</p>
                    <ul>
                      {exportProgress.errors.map((err, i) => (
                        <li key={i}>
                          {err.shot_id !== null ? `Shot #${err.shot_id}: ` : ''}{err.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={handleExportComplete}
                  className="btn-primary btn-large"
                >
                  Done
                </button>
              </>
            )}

            {exportProgress.status === 'error' && (
              <>
                <div className="export-error-icon">✗</div>
                <p className="export-error-message">Export failed</p>
                {exportProgress.errors.length > 0 && (
                  <p className="export-error-detail">{exportProgress.errors[0]?.error}</p>
                )}
                <button
                  onClick={() => {
                    setShowExportModal(false)
                    setExportProgress(null)
                    setLoadingState('idle')
                  }}
                  className="btn-secondary"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // All clips reviewed state
  if (!currentShot) {
    return (
      <div className="clip-review clip-review-complete">
        {renderExportModal()}
        <div className="review-complete-icon">✓</div>
        <h2>All clips reviewed!</h2>
        <p className="review-complete-summary">
          {shots.filter((s) => s.confidence >= 0.7).length} clips approved for export
        </p>
        <button
          onClick={exportClips}
          className="btn-primary btn-large"
          disabled={loadingState === 'loading'}
        >
          {loadingState === 'loading' ? (
            <>
              <span className="spinner" />
              Starting Export...
            </>
          ) : (
            'Export Clips'
          )}
        </button>
        {errorMessage && <p className="error-message">{errorMessage}</p>}
      </div>
    )
  }

  return (
    <div className="clip-review" ref={containerRef} tabIndex={-1}>
      {renderExportModal()}
      <div className="review-header">
        <h2>
          Review Shot #{currentShot.id}
        </h2>
        <span className="review-progress">
          {currentShotIndex + 1} of {shotsNeedingReview.length}
        </span>
      </div>

      <div className={`video-container ${!videoLoaded ? 'video-loading' : ''}`}>
        {!videoLoaded && (
          <div className="video-loader">
            <div className="spinner-large" />
            <p>Loading video...</p>
          </div>
        )}
        <video
          ref={videoRef}
          src={`file://${videoPath}`}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedData={handleVideoLoad}
          onError={handleVideoError}
          playsInline
        />
      </div>

      <Scrubber
        videoRef={videoRef}
        startTime={currentShot.clip_start}
        endTime={currentShot.clip_end}
        onTimeUpdate={handleTimeUpdate}
        disabled={loadingState === 'loading'}
      />

      <div className="playback-controls">
        <button
          onClick={() => stepTime(-1)}
          className="btn-icon"
          title="Back 1 second (Shift + ←)"
          disabled={loadingState === 'loading'}
        >
          ⏪
        </button>
        <button
          onClick={() => stepFrame(-1)}
          className="btn-icon"
          title="Previous frame (←)"
          disabled={loadingState === 'loading'}
        >
          ◀
        </button>
        <button
          onClick={togglePlayPause}
          className="btn-primary btn-play"
          title="Play/Pause (Space)"
          disabled={loadingState === 'loading'}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={() => stepFrame(1)}
          className="btn-icon"
          title="Next frame (→)"
          disabled={loadingState === 'loading'}
        >
          ▶
        </button>
        <button
          onClick={() => stepTime(1)}
          className="btn-icon"
          title="Forward 1 second (Shift + →)"
          disabled={loadingState === 'loading'}
        >
          ⏩
        </button>
      </div>

      <div className="confidence-info">
        <div className="confidence-badge" data-level={getConfidenceLevel(currentShot.confidence)}>
          {Math.round(currentShot.confidence * 100)}%
        </div>
        {currentShot.confidence_reasons.length > 0 && (
          <div className="confidence-reasons">
            {currentShot.confidence_reasons.map((reason, i) => (
              <span key={i} className="reason-tag">{reason}</span>
            ))}
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="error-banner">
          <span className="error-icon">⚠</span>
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="review-actions">
        <button
          onClick={handleReject}
          className="btn-secondary btn-reject"
          disabled={loadingState === 'loading'}
          title="Reject (Escape)"
        >
          ✗ Reject
        </button>
        <button
          onClick={handleAccept}
          className="btn-primary btn-accept"
          disabled={loadingState === 'loading'}
          title="Accept (Enter)"
        >
          {loadingState === 'loading' ? (
            <>
              <span className="spinner" />
              Saving...
            </>
          ) : (
            '✓ Accept'
          )}
        </button>
      </div>

      <div className="time-display">
        <span>Start: {currentShot.clip_start.toFixed(2)}s</span>
        <span className="time-separator">|</span>
        <span>End: {currentShot.clip_end.toFixed(2)}s</span>
        <span className="time-separator">|</span>
        <span>Duration: {(currentShot.clip_end - currentShot.clip_start).toFixed(2)}s</span>
      </div>

      <div className="keyboard-hints">
        <span><kbd>Space</kbd> Play/Pause</span>
        <span><kbd>←</kbd><kbd>→</kbd> Frame step</span>
        <span><kbd>[</kbd><kbd>]</kbd> Set in/out</span>
        <span><kbd>Enter</kbd> Accept</span>
        <span><kbd>Esc</kbd> Reject</span>
      </div>
    </div>
  )
}

function getConfidenceLevel(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence < 0.4) return 'low'
  if (confidence < 0.7) return 'medium'
  return 'high'
}
