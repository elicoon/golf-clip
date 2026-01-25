import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppStore } from '../stores/appStore'
import { Scrubber } from './Scrubber'
import { TrajectoryEditor } from './TrajectoryEditor'
import { PointStatusTracker } from './PointStatusTracker'

interface ClipReviewProps {
  jobId: string
  videoPath: string
  onComplete: (exportedClips: string[]) => void
}

type LoadingState = 'idle' | 'loading' | 'error'

interface TrajectoryPoint {
  timestamp: number
  x: number
  y: number
  confidence: number
  interpolated: boolean
}

interface TrajectoryData {
  shot_id: number
  points: TrajectoryPoint[]
  confidence: number
  apex_point?: TrajectoryPoint
  frame_width: number
  frame_height: number
  is_manual_override: boolean
}

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
  const [showTracer, setShowTracer] = useState(true)
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null)
  const [trajectoryLoading, setTrajectoryLoading] = useState(false)
  const [exportWithTracer, setExportWithTracer] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)

  // Landing point marking state
  const [landingPoint, setLandingPoint] = useState<{x: number, y: number} | null>(null)
  const [trajectoryProgress, setTrajectoryProgress] = useState<number | null>(null)
  const [trajectoryMessage, setTrajectoryMessage] = useState<string>('')
  const [detectionWarnings, setDetectionWarnings] = useState<string[]>([])
  const [trajectoryError, setTrajectoryError] = useState<string | null>(null)

  // Target point marking state
  const [targetPoint, setTargetPoint] = useState<{x: number, y: number} | null>(null)

  // Apex point marking state (optional)
  const [apexPoint, setApexPoint] = useState<{x: number, y: number} | null>(null)

  // Marking step: 'target' -> 'landing' -> 'apex' -> 'configure'
  type MarkingStep = 'target' | 'landing' | 'apex' | 'configure'
  const [markingStep, setMarkingStep] = useState<MarkingStep>('target')

  // Trajectory configuration
  const [startingLine, setStartingLine] = useState<'left' | 'center' | 'right'>('center')
  const [shotShape, setShotShape] = useState<'hook' | 'draw' | 'straight' | 'fade' | 'slice'>('straight')
  const [shotHeight, setShotHeight] = useState<'low' | 'medium' | 'high'>('medium')
  const [flightTime, setFlightTime] = useState<number>(3.0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
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

  // Fetch trajectory when shot changes
  useEffect(() => {
    if (currentShot) {
      setTrajectoryLoading(true)
      fetch(`http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot.id}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => setTrajectory(data))
        .catch(() => setTrajectory(null))
        .finally(() => setTrajectoryLoading(false))
    } else {
      setTrajectory(null)
    }
  }, [currentShot?.id, jobId])

  // Reset marking state when shot changes
  useEffect(() => {
    setTargetPoint(null)
    setLandingPoint(null)
    setApexPoint(null)
    setMarkingStep('target')
    setStartingLine('center')
    setShotShape('straight')
    setShotHeight('medium')
    setFlightTime(3.0)
    setTrajectoryProgress(null)
    setTrajectoryMessage('')
    setDetectionWarnings([])
    setTrajectoryError(null)
  }, [currentShot?.id])

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // NOTE: Removed auto-regeneration on config change - user must click Generate button

  // Track current video time for trajectory rendering and enforce clip boundaries
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentShot) return

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)

      // Stop playback when reaching clip end
      if (video.currentTime >= currentShot.clip_end && !video.paused) {
        video.pause()
        video.currentTime = currentShot.clip_end
        setIsPlaying(false)
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
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
          if (landingPoint !== null && trajectoryProgress === null) {
            handleAccept()
          }
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
  // Note: We intentionally use a minimal dependency array here.
  // The handlers (handleAccept, handleReject, etc.) are called at event time
  // and reference the current component scope, so they get the latest state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShotIndex, shotsNeedingReview.length])

  const handleTimeUpdate = useCallback((newStart: number, newEnd: number) => {
    if (currentShot) {
      updateShot(currentShot.id, {
        clip_start: newStart,
        clip_end: newEnd,
      })
    }
  }, [currentShot, updateShot])

  const handleAccept = async () => {
    if (!currentShot || loadingState === 'loading') return

    setLoadingState('loading')
    setErrorMessage(null)

    try {
      // Mark as approved (confidence = 1.0)
      console.log('Accepting shot', currentShot.id, '- setting confidence to 1.0')
      updateShot(currentShot.id, { confidence: 1.0 })
      console.log('After updateShot, store state:', useAppStore.getState().shots.map(s => ({ id: s.id, confidence: s.confidence })))

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

      // Check if this was the last shot needing review
      if (shotsNeedingReview.length === 1) {
        // All shots reviewed, export clips
        // handleExportComplete() will call onComplete() when user clicks Done
        await exportClips()
      } else {
        // Reset to index 0 - the accepted shot will be filtered out on re-render,
        // so remaining shots shift down. Setting to 0 ensures we don't go out of bounds
        // if user had navigated to a later shot.
        setCurrentShotIndex(0)
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
      // handleExportComplete() will call onComplete() when user clicks Done
      await exportClips()
    }
  }

  const exportClips = async () => {
    setLoadingState('loading')
    setErrorMessage(null)
    setShowExportModal(true)

    try {
      // Get fresh state from store (shots variable may be stale from render cycle)
      const currentShots = useAppStore.getState().shots
      console.log('Export - all shots:', currentShots.map(s => ({ id: s.id, confidence: s.confidence })))
      const approvedClips = currentShots
        .filter((s) => s.confidence >= 0.7)
        .map((s) => ({
          shot_id: s.id,
          start_time: s.clip_start,
          end_time: s.clip_end,
          approved: true,
        }))
      console.log('Export - approved clips:', approvedClips)

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
          render_tracer: exportWithTracer,
          tracer_style: exportWithTracer ? { color: '#FFFFFF', glow_enabled: true } : undefined,
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
    if (videoRef.current && currentShot) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        // If at or past clip end, restart from clip start
        if (videoRef.current.currentTime >= currentShot.clip_end - 0.05) {
          videoRef.current.currentTime = currentShot.clip_start
        }
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }, [isPlaying, currentShot])

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

  const generateTrajectorySSE = useCallback((landingX: number, landingY: number) => {
    // Cancel previous connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setTrajectoryProgress(0)
    setTrajectoryMessage('Starting...')
    setDetectionWarnings([])
    setTrajectoryError(null)

    const url = `http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot?.id}/generate?landing_x=${landingX}&landing_y=${landingY}`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      setTrajectoryProgress(data.progress)
      setTrajectoryMessage(data.message || '')
    })

    eventSource.addEventListener('warning', (e) => {
      const data = JSON.parse(e.data)
      setDetectionWarnings(prev => [...prev, data.message])
    })

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data)
      setTrajectory(data.trajectory)
      setTrajectoryProgress(null)
      setTrajectoryMessage('')
      eventSource.close()
      eventSourceRef.current = null
    })

    eventSource.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        setTrajectoryError(data.error || 'Failed to generate trajectory')
      } catch {
        setTrajectoryError('Connection lost during trajectory generation')
      }
      setTrajectoryProgress(null)
      eventSource.close()
      eventSourceRef.current = null
    })

    eventSource.onerror = () => {
      setTrajectoryError('Connection lost during trajectory generation')
      setTrajectoryProgress(null)
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [jobId, currentShot?.id])

  const generateTrajectoryWithConfig = useCallback((landingX: number, landingY: number) => {
    if (!targetPoint || !currentShot) return

    // Cancel previous connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setTrajectoryProgress(0)
    setTrajectoryMessage('Starting...')
    setDetectionWarnings([])
    setTrajectoryError(null)

    const params = new URLSearchParams({
      landing_x: landingX.toString(),
      landing_y: landingY.toString(),
      target_x: targetPoint.x.toString(),
      target_y: targetPoint.y.toString(),
      starting_line: startingLine,
      shot_shape: shotShape,
      shot_height: shotHeight,
      flight_time: flightTime.toString(),
    })

    // Add apex if marked (optional)
    if (apexPoint) {
      params.append('apex_x', apexPoint.x.toString())
      params.append('apex_y', apexPoint.y.toString())
    }

    const url = `http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot.id}/generate?${params}`
    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      setTrajectoryProgress(data.progress)
      setTrajectoryMessage(data.message || '')
    })

    eventSource.addEventListener('warning', (e) => {
      const data = JSON.parse(e.data)
      setDetectionWarnings(prev => [...prev, data.message])
    })

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data)
      setTrajectory(data.trajectory)
      setTrajectoryProgress(null)
      setTrajectoryMessage('')
      eventSource.close()
      eventSourceRef.current = null
    })

    eventSource.addEventListener('error', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data)
        setTrajectoryError(data.error || 'Failed to generate trajectory')
      } catch {
        setTrajectoryError('Connection lost during trajectory generation')
      }
      setTrajectoryProgress(null)
      eventSource.close()
      eventSourceRef.current = null
    })

    eventSource.onerror = () => {
      setTrajectoryError('Connection lost during trajectory generation')
      setTrajectoryProgress(null)
      eventSource.close()
      eventSourceRef.current = null
    }
  }, [jobId, currentShot?.id, targetPoint, apexPoint, startingLine, shotShape, shotHeight, flightTime])

  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (loadingState === 'loading' || trajectoryProgress !== null) return

    if (markingStep === 'target') {
      setTargetPoint({ x, y })
      setMarkingStep('landing')
    } else if (markingStep === 'landing') {
      setLandingPoint({ x, y })
      setMarkingStep('apex')
    } else if (markingStep === 'apex') {
      setApexPoint({ x, y })
      setMarkingStep('configure')
    }
  }, [loadingState, trajectoryProgress, markingStep])

  const handleVideoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || loadingState === 'loading' || trajectoryProgress !== null) return

    const rect = videoRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // Clamp to valid range
    const clampedX = Math.max(0, Math.min(1, x))
    const clampedY = Math.max(0, Math.min(1, y))

    setLandingPoint({ x: clampedX, y: clampedY })
    setTrajectoryError(null)
    generateTrajectorySSE(clampedX, clampedY)
  }, [loadingState, trajectoryProgress, generateTrajectorySSE])

  const clearMarking = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    setTargetPoint(null)
    setLandingPoint(null)
    setApexPoint(null)
    setMarkingStep('target')
    setTrajectory(null)
    setTrajectoryProgress(null)
    setTrajectoryMessage('')
    setDetectionWarnings([])
    setTrajectoryError(null)
  }, [])

  const handleClearPoint = useCallback((point: 'target' | 'landing' | 'apex') => {
    if (point === 'target') {
      setTargetPoint(null)
      setLandingPoint(null)
      setApexPoint(null)
      setMarkingStep('target')
    } else if (point === 'landing') {
      setLandingPoint(null)
      setApexPoint(null)
      setMarkingStep('landing')
    } else if (point === 'apex') {
      setApexPoint(null)
      if (markingStep === 'configure') {
        // Stay in configure - user can re-mark apex or skip
      } else {
        setMarkingStep('apex')
      }
    }
    setTrajectory(null)
  }, [markingStep])

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

      <div className="review-actions">
        <button
          onClick={handleReject}
          className="btn-secondary btn-skip"
          disabled={loadingState === 'loading' || trajectoryProgress !== null}
          title="Skip Shot (Escape)"
        >
          Skip Shot
        </button>
        <button
          onClick={handleAccept}
          className="btn-primary btn-next"
          disabled={loadingState === 'loading' || trajectoryProgress !== null || markingStep !== 'configure'}
          title={markingStep !== 'configure' ? "Complete trajectory setup first" : "Next (Enter)"}
        >
          {loadingState === 'loading' ? (
            <>
              <span className="spinner" />
              Saving...
            </>
          ) : (
            'Next →'
          )}
        </button>
      </div>

      {/* Instruction banner */}
      <div className="marking-instruction">
        {markingStep === 'target' && (
          <>
            <span className="step-badge">Step 1</span>
            <span>Click where you were aiming (the target)</span>
          </>
        )}
        {markingStep === 'landing' && (
          <>
            <span className="step-badge">Step 2</span>
            <span>Click where the ball actually landed</span>
            <button className="btn-reset-inline" onClick={clearMarking} title="Reset and start over">
              Reset
            </button>
          </>
        )}
        {markingStep === 'apex' && (
          <>
            <span className="step-badge">Step 3</span>
            <span>Click the highest point of ball flight (optional)</span>
            <button
              className="btn-skip-inline"
              onClick={() => setMarkingStep('configure')}
            >
              Skip
            </button>
            <button className="btn-reset-inline" onClick={clearMarking}>
              Reset
            </button>
          </>
        )}
        {markingStep === 'configure' && (
          <>
            <span className="step-badge">Step 4</span>
            <span>Select trajectory settings and click Generate</span>
          </>
        )}
      </div>

      <PointStatusTracker
        targetPoint={targetPoint}
        landingPoint={landingPoint}
        apexPoint={apexPoint}
        markingStep={markingStep}
        onClearPoint={handleClearPoint}
      />

      {/* Trajectory configuration section - ABOVE player - always visible */}
      <div className="trajectory-config-above-player">
          {trajectoryProgress !== null ? (
            <div className="trajectory-progress">
              <div className="progress-header">
                Generating tracer... {trajectoryProgress}%
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${trajectoryProgress}%` }}
                />
              </div>
              <div className="progress-message">{trajectoryMessage}</div>
            </div>
          ) : (
            <div className="trajectory-controls-inline">
              <div className="control-group">
                <label>Starting line:</label>
                <div className="button-group">
                  {(['left', 'center', 'right'] as const).map((value) => (
                    <button
                      key={value}
                      className={`btn-option ${startingLine === value ? 'active' : ''}`}
                      onClick={() => setStartingLine(value)}
                    >
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="control-group">
                <label>Shot shape:</label>
                <div className="button-group">
                  {(['hook', 'draw', 'straight', 'fade', 'slice'] as const).map((value) => (
                    <button
                      key={value}
                      className={`btn-option ${shotShape === value ? 'active' : ''}`}
                      onClick={() => setShotShape(value)}
                    >
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="control-group">
                <label>Shot height:</label>
                <div className="button-group">
                  {(['low', 'medium', 'high'] as const).map((value) => (
                    <button
                      key={value}
                      className={`btn-option ${shotHeight === value ? 'active' : ''}`}
                      onClick={() => setShotHeight(value)}
                    >
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="control-group">
                <label>Flight time: {flightTime.toFixed(1)}s</label>
                <input
                  type="range"
                  min="1.0"
                  max="6.0"
                  step="0.5"
                  value={flightTime}
                  onChange={(e) => setFlightTime(parseFloat(e.target.value))}
                  className="flight-time-slider"
                />
              </div>
              <button
                className="btn-primary btn-generate"
                onClick={() => landingPoint && generateTrajectoryWithConfig(landingPoint.x, landingPoint.y)}
                disabled={!landingPoint || trajectoryProgress !== null}
              >
                Generate
              </button>
              <button className="btn-clear" onClick={clearMarking}>
                Start Over
              </button>
            </div>
          )}
        </div>

      <div
        className={`video-container ${!videoLoaded ? 'video-loading' : ''}`}
        style={{ cursor: ['target', 'landing', 'apex'].includes(markingStep) ? 'crosshair' : 'default' }}
      >
        {!videoLoaded && (
          <div className="video-loader">
            <div className="spinner-large" />
            <p>Loading video...</p>
          </div>
        )}
        <video
          ref={videoRef}
          src={`http://127.0.0.1:8420/api/video?path=${encodeURIComponent(videoPath)}`}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedData={handleVideoLoad}
          onError={handleVideoError}
          playsInline
        />
        <TrajectoryEditor
          videoRef={videoRef}
          trajectory={trajectory}
          currentTime={currentTime}
          showTracer={showTracer}
          disabled={trajectoryProgress !== null}
          landingPoint={landingPoint}
          targetPoint={targetPoint}
          apexPoint={apexPoint}
          onCanvasClick={handleCanvasClick}
          onTrajectoryUpdate={(points) => {
            if (!currentShot) return
            fetch(`http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ points }),
            }).catch((err) => console.error('Failed to save trajectory:', err))
          }}
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

      <div className="tracer-controls">
        <label>
          <input
            type="checkbox"
            checked={showTracer}
            onChange={(e) => setShowTracer(e.target.checked)}
            disabled={trajectoryLoading}
          />
          Show Tracer
          {trajectoryLoading && <span className="spinner" style={{ marginLeft: 8 }} />}
        </label>
        <label>
          <input
            type="checkbox"
            checked={exportWithTracer}
            onChange={(e) => setExportWithTracer(e.target.checked)}
          />
          Render Shot Tracers
        </label>
      </div>

      {/* Trajectory status section (for non-configure steps) */}
      {markingStep !== 'configure' && (targetPoint || landingPoint) && (
        <div className="trajectory-config-section">
          <div className="marking-status">
            {targetPoint && (
              <div className="marked-point">
                <span className="marker-icon">&#8853;</span>
                <span>Target marked</span>
              </div>
            )}
            <button className="btn-clear" onClick={clearMarking}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Trajectory errors/warnings */}
      {(trajectoryError || detectionWarnings.length > 0) && (
        <div className="trajectory-config-section">
          {trajectoryError && (
            <div className="trajectory-error">
              <span>&#9888;&#65039; {trajectoryError}</span>
            </div>
          )}
          {detectionWarnings.length > 0 && (
            <div className="detection-warnings">
              {detectionWarnings.map((warning, i) => (
                <div key={i} className="warning-item">
                  <span className="warning-icon">&#9888;</span>
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
        <span><kbd>Enter</kbd> Next</span>
        <span><kbd>Esc</kbd> Skip</span>
      </div>
    </div>
  )
}

function getConfidenceLevel(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence < 0.4) return 'low'
  if (confidence < 0.7) return 'medium'
  return 'high'
}
