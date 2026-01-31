import { useState, useRef, useEffect, useCallback } from 'react'
import { useProcessingStore, TrajectoryData, TrajectoryPoint, TracerConfig } from '../stores/processingStore'
import { Scrubber } from './Scrubber'
import { TrajectoryEditor } from './TrajectoryEditor'
import { TracerConfigPanel } from './TracerConfigPanel'

interface ClipReviewProps {
  onComplete: () => void
}

// Generate a trajectory curve from landing point and config
function generateTrajectory(
  landingPoint: { x: number; y: number },
  config: TracerConfig,
  originPoint?: { x: number; y: number },
  apexPoint?: { x: number; y: number }
): TrajectoryData {
  const origin = originPoint || { x: 0.5, y: 0.85 }

  // Calculate apex based on config
  const heightMultiplier = config.height === 'low' ? 0.15 : config.height === 'medium' ? 0.25 : 0.35
  const defaultApex = {
    x: (origin.x + landingPoint.x) / 2,
    y: Math.min(origin.y, landingPoint.y) - heightMultiplier
  }
  const apex = apexPoint || defaultApex

  // Apply shape curve offset
  const shapeCurve = {
    hook: -0.15,
    draw: -0.08,
    straight: 0,
    fade: 0.08,
    slice: 0.15
  }[config.shape]

  // Generate points along quadratic bezier
  const numPoints = 30
  const points: TrajectoryPoint[] = []

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints
    const timestamp = t * config.flightTime

    // Quadratic bezier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
    const mt = 1 - t
    const x = mt * mt * origin.x + 2 * mt * t * (apex.x + shapeCurve * t) + t * t * landingPoint.x
    const y = mt * mt * origin.y + 2 * mt * t * apex.y + t * t * landingPoint.y

    points.push({
      timestamp,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      confidence: 1.0,
      interpolated: false
    })
  }

  return {
    shot_id: 'generated',
    points,
    confidence: 1.0,
    apex_point: {
      ...points[Math.floor(numPoints / 2)],
      x: apex.x,
      y: apex.y
    },
    frame_width: 1920,
    frame_height: 1080
  }
}

export function ClipReview({ onComplete }: ClipReviewProps) {
  const { segments, updateSegment, approveSegment, rejectSegment } = useProcessingStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Trajectory state
  const [showTracer, setShowTracer] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [landingPoint, setLandingPoint] = useState<{ x: number; y: number } | null>(null)
  const [apexPoint, setApexPoint] = useState<{ x: number; y: number } | null>(null)
  const [originPoint, setOriginPoint] = useState<{ x: number; y: number } | null>(null)
  const [reviewStep, setReviewStep] = useState<'marking_landing' | 'generating' | 'reviewing'>('marking_landing')
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null)
  const [tracerConfig, setTracerConfig] = useState<TracerConfig>({
    height: 'medium',
    shape: 'straight',
    startingLine: 'center',
    flightTime: 3.0
  })
  const [showConfigPanel, setShowConfigPanel] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isMarkingApex, setIsMarkingApex] = useState(false)
  const [isMarkingOrigin, setIsMarkingOrigin] = useState(false)

  // Export state
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
  const [exportComplete, setExportComplete] = useState(false)

  // Auto-loop state
  const [autoLoopEnabled, setAutoLoopEnabled] = useState(true)
  const loopTimeoutRef = useRef<number | null>(null)

  // Filter to shots needing review (confidence < 0.7 and not yet approved/rejected)
  const shotsNeedingReview = segments.filter(s => s.confidence < 0.7 && s.approved === 'pending')
  const currentShot = shotsNeedingReview[currentIndex]
  const totalShots = shotsNeedingReview.length

  // Seek to clip start when shot changes
  // Note: objectUrl is an extracted segment blob starting at 0, not the original video
  // clipStart is relative to original video, so offset by segment.startTime
  useEffect(() => {
    if (videoRef.current && currentShot) {
      videoRef.current.currentTime = currentShot.clipStart - currentShot.startTime
    }
  }, [currentShot?.id])

  // Track video time for trajectory animation and auto-loop
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentShot) return

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)

      // Auto-loop: pause at clip end, wait 750ms, restart
      const clipEndInVideo = currentShot.clipEnd - currentShot.startTime
      if (video.currentTime >= clipEndInVideo && !video.paused && autoLoopEnabled) {
        video.pause()
        setIsPlaying(false)

        if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current)
        loopTimeoutRef.current = window.setTimeout(() => {
          if (videoRef.current && autoLoopEnabled) {
            const clipStartInVideo = currentShot.clipStart - currentShot.startTime
            videoRef.current.currentTime = clipStartInVideo
            videoRef.current.play().catch(() => {})
            setIsPlaying(true)
          }
        }, 750)
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current)
    }
  }, [currentShot, autoLoopEnabled])

  // Reset marking state when shot changes
  useEffect(() => {
    setLandingPoint(null)
    setApexPoint(null)
    setOriginPoint(null)
    setReviewStep('marking_landing')
    setTrajectory(null)
  }, [currentShot?.id])

  // Handle canvas click for marking points
  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (isMarkingApex) {
      setApexPoint({ x, y })
      setIsMarkingApex(false)
      setHasUnsavedChanges(true)
    } else if (isMarkingOrigin) {
      setOriginPoint({ x, y })
      setIsMarkingOrigin(false)
      setHasUnsavedChanges(true)
    } else if (reviewStep === 'marking_landing') {
      setLandingPoint({ x, y })
      const traj = generateTrajectory({ x, y }, tracerConfig)
      setTrajectory(traj)
      setReviewStep('reviewing')
      if (currentShot) {
        updateSegment(currentShot.id, { landingPoint: { x, y }, trajectory: traj })
      }
    }
  }, [reviewStep, tracerConfig, isMarkingApex, isMarkingOrigin, currentShot, updateSegment])

  // TracerConfigPanel handlers
  const handleConfigChange = useCallback((config: TracerConfig) => {
    setTracerConfig(config)
    setHasUnsavedChanges(true)
  }, [])

  const handleGenerate = useCallback(() => {
    if (!landingPoint) return
    const traj = generateTrajectory(landingPoint, tracerConfig, originPoint || undefined, apexPoint || undefined)
    setTrajectory(traj)
    setHasUnsavedChanges(false)
    if (currentShot) {
      updateSegment(currentShot.id, { trajectory: traj })
    }
  }, [landingPoint, tracerConfig, originPoint, apexPoint, currentShot, updateSegment])

  const handleMarkApex = useCallback(() => {
    setIsMarkingApex(true)
    setIsMarkingOrigin(false)
  }, [])

  const handleMarkOrigin = useCallback(() => {
    setIsMarkingOrigin(true)
    setIsMarkingApex(false)
  }, [])

  // Export approved clips
  const handleExport = useCallback(async () => {
    const approved = segments.filter(s => s.approved === 'approved')
    if (approved.length === 0) {
      onComplete()
      return
    }

    setShowExportModal(true)
    setExportProgress({ current: 0, total: approved.length })
    setExportComplete(false)

    // Download each approved clip
    for (let i = 0; i < approved.length; i++) {
      const segment = approved[i]
      setExportProgress({ current: i + 1, total: approved.length })

      // Create download link
      const a = document.createElement('a')
      a.href = segment.objectUrl
      a.download = `shot_${i + 1}.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      // Small delay between downloads to avoid browser throttling
      await new Promise(r => setTimeout(r, 500))
    }

    setExportComplete(true)
  }, [segments, onComplete])

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }, [currentIndex])

  const handleNext = useCallback(() => {
    if (currentIndex < totalShots - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }, [currentIndex, totalShots])

  const handleApprove = useCallback(() => {
    if (!currentShot) return
    approveSegment(currentShot.id)

    if (currentIndex >= shotsNeedingReview.length - 1) {
      // All shots reviewed - trigger export
      handleExport()
    } else {
      // Stay at same index - approved shot will filter out
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
  }, [currentShot, currentIndex, shotsNeedingReview.length, approveSegment, handleExport])

  const handleReject = useCallback(() => {
    if (!currentShot) return
    rejectSegment(currentShot.id)

    if (currentIndex >= shotsNeedingReview.length - 1) {
      // All shots reviewed - trigger export
      handleExport()
    } else {
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
  }, [currentShot, currentIndex, shotsNeedingReview.length, rejectSegment, handleExport])

  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  const handleTrimUpdate = useCallback((newStart: number, newEnd: number) => {
    if (currentShot) {
      updateSegment(currentShot.id, {
        clipStart: newStart,
        clipEnd: newEnd,
      })
    }
  }, [currentShot?.id, updateSegment])

  // Keyboard shortcuts for clip review
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlayPause()
          break
        case 'ArrowUp':
          e.preventDefault()
          handlePrevious()
          break
        case 'ArrowDown':
          e.preventDefault()
          handleNext()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (videoRef.current) {
            if (e.shiftKey) {
              // Jump 1 second back
              videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1)
            } else {
              // Step one frame back (1/60 sec)
              videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1/60)
            }
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (videoRef.current) {
            if (e.shiftKey) {
              // Jump 1 second forward
              videoRef.current.currentTime += 1
            } else {
              // Step one frame forward (1/60 sec)
              videoRef.current.currentTime += 1/60
            }
          }
          break
        case 'Enter':
          e.preventDefault()
          if (reviewStep === 'reviewing' && trajectory) {
            handleApprove()
          }
          break
        case 'Escape':
        case 'Backspace':
          e.preventDefault()
          handleReject()
          break
        case '[':
          // Set in point (trim start)
          if (videoRef.current && currentShot) {
            const newStart = currentShot.startTime + videoRef.current.currentTime
            if (newStart < currentShot.clipEnd - 0.5) {
              handleTrimUpdate(newStart, currentShot.clipEnd)
            }
          }
          break
        case ']':
          // Set out point (trim end)
          if (videoRef.current && currentShot) {
            const newEnd = currentShot.startTime + videoRef.current.currentTime
            if (newEnd > currentShot.clipStart + 0.5) {
              handleTrimUpdate(currentShot.clipStart, newEnd)
            }
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlayPause, handlePrevious, handleNext, handleApprove, handleReject, reviewStep, trajectory, currentShot, handleTrimUpdate])

  if (!currentShot) {
    return (
      <div className="clip-review-complete">
        <div className="review-complete-icon">✓</div>
        <h2>All shots have been reviewed!</h2>
        <p className="review-complete-summary">
          {segments.filter(s => s.approved === 'approved').length} shots approved
        </p>
        <button onClick={onComplete} className="btn-primary btn-large">
          Continue to Export
        </button>
      </div>
    )
  }

  return (
    <div className="clip-review">
      <div className="review-header">
        <h2>Review Shots</h2>
        <span className="review-progress">{currentIndex + 1} of {totalShots}</span>
      </div>

      <div className="playback-controls">
        <button
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          className="btn-secondary"
        >
          ← Previous
        </button>
        <button
          onClick={togglePlayPause}
          className="btn-secondary btn-play"
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={handleNext}
          disabled={currentIndex >= totalShots - 1}
          className="btn-secondary"
        >
          Next →
        </button>
      </div>

      {/* Instruction banner based on review step */}
      <div className="marking-instruction">
        {reviewStep === 'marking_landing' && (
          <>
            <span className="step-badge">Step 1</span>
            <span className="instruction-text">Click where the ball landed</span>
          </>
        )}
        {reviewStep === 'reviewing' && (
          <>
            <span className="step-badge complete">Ready</span>
            <span className="instruction-text">Review the trajectory, then approve or reject</span>
          </>
        )}
      </div>

      <div className="video-container">
        <video
          ref={videoRef}
          src={currentShot.objectUrl}
          className="review-video"
          onClick={togglePlayPause}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        <TrajectoryEditor
          videoRef={videoRef as React.RefObject<HTMLVideoElement>}
          trajectory={trajectory}
          currentTime={currentTime}
          showTracer={showTracer}
          landingPoint={landingPoint}
          apexPoint={apexPoint}
          originPoint={originPoint}
          onCanvasClick={handleCanvasClick}
          markingStep={reviewStep}
          isMarkingApex={isMarkingApex}
          isMarkingOrigin={isMarkingOrigin}
        />
      </div>

      {/* Playback and tracer controls */}
      <div className="tracer-controls">
        <label>
          <input
            type="checkbox"
            checked={autoLoopEnabled}
            onChange={(e) => setAutoLoopEnabled(e.target.checked)}
          />
          Auto-loop clip
        </label>
        <label>
          <input
            type="checkbox"
            checked={showTracer}
            onChange={(e) => setShowTracer(e.target.checked)}
          />
          Show Tracer
        </label>
      </div>

      {/* TracerConfigPanel - only show when trajectory exists */}
      {reviewStep === 'reviewing' && (
        <TracerConfigPanel
          config={tracerConfig}
          onChange={handleConfigChange}
          onGenerate={handleGenerate}
          onMarkApex={handleMarkApex}
          onMarkOrigin={handleMarkOrigin}
          hasChanges={hasUnsavedChanges}
          apexMarked={!!apexPoint}
          originMarked={!!originPoint}
          isGenerating={false}
          isCollapsed={!showConfigPanel}
          onToggleCollapse={() => setShowConfigPanel(!showConfigPanel)}
        />
      )}

      <Scrubber
        videoRef={videoRef}
        startTime={currentShot.clipStart}
        endTime={currentShot.clipEnd}
        onTimeUpdate={handleTrimUpdate}
      />

      <div className="confidence-info">
        <span
          className="confidence-badge"
          data-level={currentShot.confidence < 0.4 ? 'low' : currentShot.confidence < 0.7 ? 'medium' : 'high'}
        >
          {(currentShot.confidence * 100).toFixed(0)}% confidence
        </span>
        <span className="clip-time">
          Duration: {(currentShot.clipEnd - currentShot.clipStart).toFixed(1)}s
        </span>
      </div>

      <div className="review-actions">
        <button onClick={handleReject} className="btn-no-shot">
          ✕ No Golf Shot
        </button>
        <button onClick={handleApprove} className="btn-primary btn-large">
          ✓ Approve Shot
        </button>
      </div>

      <div className="keyboard-hints">
        <span><kbd>Space</kbd> Play/Pause</span>
        <span><kbd>←</kbd><kbd>→</kbd> Frame step</span>
        <span><kbd>Shift+←</kbd><kbd>→</kbd> 1 sec</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> Prev/Next shot</span>
        <span><kbd>[</kbd><kbd>]</kbd> Set in/out</span>
        <span><kbd>Enter</kbd> Approve</span>
        <span><kbd>Esc</kbd> Reject</span>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="export-modal-overlay">
          <div className="export-modal">
            <div className="export-modal-header">
              <h3>{exportComplete ? 'Export Complete!' : 'Exporting Clips'}</h3>
            </div>
            <div className="export-modal-content">
              {!exportComplete ? (
                <>
                  <div className="export-progress-bar">
                    <div
                      className="export-progress-fill"
                      style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="export-status">
                    Downloading {exportProgress.current} of {exportProgress.total}...
                  </p>
                </>
              ) : (
                <>
                  <div className="export-success-icon">✓</div>
                  <p className="export-result">{exportProgress.total} clips downloaded</p>
                  <button
                    onClick={() => { setShowExportModal(false); onComplete() }}
                    className="btn-primary"
                  >
                    Done
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
