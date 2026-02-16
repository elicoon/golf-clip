import { useState, useRef, useEffect, useCallback } from 'react'
import { useProcessingStore, TrajectoryData, TracerConfig, VideoSegment } from '../stores/processingStore'
import { useReviewActionsStore } from '../stores/reviewActionsStore'
import { Scrubber } from './Scrubber'
import { TrajectoryEditor } from './TrajectoryEditor'
import { TracerConfigPanel } from './TracerConfigPanel'
import { ConfirmDialog } from './ConfirmDialog'
import { TracerStyle, DEFAULT_TRACER_STYLE } from '../types/tracer'
import { submitShotFeedback, submitTracerFeedback } from '../lib/feedback-service'
import { VideoFramePipelineV4, ExportConfigV4, ExportResolution, isVideoFrameCallbackSupported } from '../lib/video-frame-pipeline-v4'
import { loadFFmpeg, muxAudioIntoClip } from '../lib/ffmpeg-client'
import { generateTrajectory, Point2D } from '../lib/trajectory-generator'

/** Minimum delay for trajectory generation to show loading state feedback */
const TRAJECTORY_GENERATION_MIN_DELAY_MS = 300

interface ClipReviewProps {
  onComplete: () => void
}

export function ClipReview({ onComplete }: ClipReviewProps) {
  const {
    segments: legacySegments,
    updateSegment: legacyUpdateSegment,
    approveSegment: legacyApproveSegment,
    rejectSegment: legacyRejectSegment,
    videos,
    activeVideoId,
    updateVideoSegment,
    approveVideoSegment,
    rejectVideoSegment,
  } = useProcessingStore()

  // Use multi-video segments when available, fall back to legacy segments
  const activeVideo = activeVideoId ? videos.get(activeVideoId) : undefined
  const segments = activeVideo?.segments ?? legacySegments

  // Wrapper functions that route to multi-video or legacy store actions
  const updateSegment = useCallback((id: string, updates: Partial<VideoSegment>) => {
    if (activeVideoId) {
      updateVideoSegment(activeVideoId, id, updates)
    } else {
      legacyUpdateSegment(id, updates)
    }
  }, [activeVideoId, updateVideoSegment, legacyUpdateSegment])

  const approveSegment = useCallback((id: string) => {
    if (activeVideoId) {
      approveVideoSegment(activeVideoId, id)
    } else {
      legacyApproveSegment(id)
    }
  }, [activeVideoId, approveVideoSegment, legacyApproveSegment])

  const rejectSegment = useCallback((id: string) => {
    if (activeVideoId) {
      rejectVideoSegment(activeVideoId, id)
    } else {
      legacyRejectSegment(id)
    }
  }, [activeVideoId, rejectVideoSegment, legacyRejectSegment])

  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Trajectory state
  const [showTracer, setShowTracer] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [landingPoint, setLandingPoint] = useState<Point2D | null>(null)
  const [apexPoint, setApexPoint] = useState<Point2D | null>(null)
  const [originPoint, setOriginPoint] = useState<Point2D | null>(null)
  const [reviewStep, setReviewStep] = useState<'marking_landing' | 'generating' | 'reviewing'>('marking_landing')
  const [trajectory, setTrajectory] = useState<TrajectoryData | null>(null)
  const [tracerConfig, setTracerConfig] = useState<TracerConfig>({
    height: 'medium',
    shape: 'straight',
    flightTime: 3.0
  })
  const [tracerStyle, setTracerStyle] = useState<TracerStyle>(DEFAULT_TRACER_STYLE)
  const [showConfigPanel, setShowConfigPanel] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isMarkingApex, setIsMarkingApex] = useState(false)
  const [isMarkingOrigin, setIsMarkingOrigin] = useState(false)
  const [isMarkingLanding, setIsMarkingLanding] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [impactTimeAdjusted, setImpactTimeAdjusted] = useState(false)

  // Export state
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
  const [exportPhase, setExportPhase] = useState<{ phase: string; progress: number }>({ phase: '', progress: 0 })
  const [exportComplete, setExportComplete] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportResolution, setExportResolution] = useState<ExportResolution>('1080p')
  const exportCancelledRef = useRef(false)
  const autoCloseTimerRef = useRef<number | null>(null)

  // Video playback error state
  const [videoError, setVideoError] = useState<string | null>(null)

  // Confirm dialog state for destructive actions (Escape / "No Golf Shot")
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)

  // Auto-loop state
  const [autoLoopEnabled, setAutoLoopEnabled] = useState(true)
  const loopTimeoutRef = useRef<number | null>(null)

  // Audio state - start unmuted, will auto-mute if browser blocks playback
  const [isMuted, setIsMuted] = useState(false)

  // Track which shot we've already autoplayed for (to avoid re-triggering on canplay)
  const autoplayedShotIdRef = useRef<string | null>(null)
  // Track when we last seeked to prevent auto-loop from triggering immediately
  const lastSeekTimeRef = useRef<number>(0)

  // Feedback tracking - store initial values for comparison
  const initialTracerParamsRef = useRef<{
    originX?: number
    originY?: number
    landingX?: number
    landingY?: number
    apexX?: number
    apexY?: number
    shape?: string
    height?: string
    flightTime?: number
  } | null>(null)
  const initialClipTimingRef = useRef<{ clipStart: number; clipEnd: number } | null>(null)
  // Track whether user made any tracer modifications
  const tracerModifiedRef = useRef(false)

  // Filter to shots needing review (confidence < 0.7 and not yet approved/rejected)
  const shotsNeedingReview = segments.filter(s => s.confidence < 0.7 && s.approved === 'pending')
  const currentShot = shotsNeedingReview[currentIndex]
  const totalShots = shotsNeedingReview.length

  // Autoplay handler - called when video can play
  const handleVideoCanPlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !currentShot) return

    // Only autoplay once per shot (avoid retriggering on every canplay event)
    if (autoplayedShotIdRef.current === currentShot.id) return
    autoplayedShotIdRef.current = currentShot.id

    // Seek to clip start (offset by segment start time since blob starts at 0)
    const targetTime = currentShot.clipStart - currentShot.startTime

    // Function to start playback after seek
    const startPlayback = () => {
      lastSeekTimeRef.current = Date.now()
      video.play().then(() => {
        setIsPlaying(true)
      }).catch(() => {
        // Autoplay with audio blocked - retry muted
        video.muted = true
        setIsMuted(true)
        video.play().then(() => {
          setIsPlaying(true)
        }).catch(() => {
          // Even muted autoplay blocked - user must click to play
          setIsPlaying(false)
        })
      })
    }

    // If already near target time, play immediately (seeked won't fire)
    if (Math.abs(video.currentTime - targetTime) < 0.1) {
      startPlayback()
    } else {
      // Wait for seek to complete before playing (avoids race with auto-loop)
      const handleSeeked = () => {
        video.removeEventListener('seeked', handleSeeked)
        startPlayback()
      }
      video.addEventListener('seeked', handleSeeked)
      video.currentTime = targetTime
    }
  }, [currentShot])

  // Reset autoplay tracking when shot changes
  useEffect(() => {
    if (currentShot?.id !== autoplayedShotIdRef.current) {
      autoplayedShotIdRef.current = null
    }
  }, [currentShot?.id])

  // Trigger autoplay when navigating between shots (video already loaded)
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentShot) return

    // If video is already loaded and we haven't autoplayed this shot, do it now
    if (video.readyState >= 3 && autoplayedShotIdRef.current !== currentShot.id) {
      handleVideoCanPlay()
    }
  }, [currentShot?.id, handleVideoCanPlay])

  // Track video time for trajectory animation and auto-loop
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentShot) return

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)

      // Auto-loop: pause at clip end, wait 750ms, restart
      // Skip if we just seeked (within 500ms) to avoid race condition with initial autoplay
      const clipEndInVideo = currentShot.clipEnd - currentShot.startTime
      const timeSinceSeek = Date.now() - lastSeekTimeRef.current
      if (video.currentTime >= clipEndInVideo && !video.paused && autoLoopEnabled && timeSinceSeek > 500) {
        video.pause()
        setIsPlaying(false)

        if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current)
        loopTimeoutRef.current = window.setTimeout(() => {
          if (videoRef.current && autoLoopEnabled) {
            const clipStartInVideo = currentShot.clipStart - currentShot.startTime
            lastSeekTimeRef.current = Date.now()
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

  // Cleanup auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
      }
    }
  }, [])

  // Reset marking state when shot changes
  useEffect(() => {
    setLandingPoint(null)
    setApexPoint(null)
    setOriginPoint(null)
    setReviewStep('marking_landing')
    setTrajectory(null)
    setVideoError(null) // Clear video error on shot change
    setShowRejectConfirm(false)
    setImpactTimeAdjusted(false)
    // Reset feedback tracking for new shot
    initialTracerParamsRef.current = null
    tracerModifiedRef.current = false
    // Store initial clip timing for feedback
    if (currentShot) {
      initialClipTimingRef.current = {
        clipStart: currentShot.clipStart,
        clipEnd: currentShot.clipEnd
      }
    }
  }, [currentShot?.id])

  // Handle video playback errors
  const handleVideoError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget
    const error = video.error

    console.error('Video playback error:', error)

    let message = 'This video format is not supported by your browser.'
    if (error) {
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          message = 'Video playback was aborted.'
          break
        case MediaError.MEDIA_ERR_NETWORK:
          message = 'A network error occurred while loading the video.'
          break
        case MediaError.MEDIA_ERR_DECODE:
          message = 'This video format cannot be decoded. It may use an unsupported codec like HEVC.'
          break
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          message = 'This video format is not supported. Try re-exporting as H.264.'
          break
      }
    }
    setVideoError(message)
  }, [])

  // Handle canvas click for marking points
  const handleCanvasClick = useCallback((x: number, y: number) => {
    if (isMarkingApex) {
      setApexPoint({ x, y })
      setIsMarkingApex(false)
      setHasUnsavedChanges(true)
      tracerModifiedRef.current = true
    } else if (isMarkingOrigin) {
      setOriginPoint({ x, y })
      setIsMarkingOrigin(false)
      setHasUnsavedChanges(true)
      tracerModifiedRef.current = true
    } else if (isMarkingLanding) {
      setLandingPoint({ x, y })
      setIsMarkingLanding(false)
      setHasUnsavedChanges(true)
      tracerModifiedRef.current = true
      if (currentShot) {
        updateSegment(currentShot.id, { landingPoint: { x, y } })
      }
    } else if (reviewStep === 'marking_landing') {
      setLandingPoint({ x, y })
      // Start trajectory animation from when the ball is struck in the video segment
      const strikeOffset = currentShot ? currentShot.strikeTime - currentShot.startTime : 0
      const traj = generateTrajectory({ x, y }, tracerConfig, undefined, undefined, strikeOffset)
      setTrajectory(traj)
      setReviewStep('reviewing')
      // Store initial tracer params for feedback comparison
      initialTracerParamsRef.current = {
        originX: 0.5,  // Default origin
        originY: 0.85,
        landingX: x,
        landingY: y,
        shape: tracerConfig.shape,
        height: tracerConfig.height,
        flightTime: tracerConfig.flightTime
      }
      if (currentShot) {
        updateSegment(currentShot.id, { landingPoint: { x, y }, trajectory: traj })
      }
    }
  }, [reviewStep, tracerConfig, isMarkingApex, isMarkingOrigin, isMarkingLanding, currentShot, updateSegment])

  // TracerConfigPanel handlers
  const handleConfigChange = useCallback((config: TracerConfig) => {
    setTracerConfig(config)
    setHasUnsavedChanges(true)
    tracerModifiedRef.current = true
  }, [])

  const handleStyleChange = useCallback((style: TracerStyle) => {
    setTracerStyle(style)
    setHasUnsavedChanges(true)
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!landingPoint) return
    setIsGenerating(true)
    try {
      // Minimum delay so user sees loading state
      const startTime = Date.now()

      // Start trajectory animation from when the ball is struck in the video segment
      const strikeOffset = currentShot ? currentShot.strikeTime - currentShot.startTime : 0
      const traj = generateTrajectory(landingPoint, tracerConfig, originPoint || undefined, apexPoint || undefined, strikeOffset)

      // Ensure minimum time has passed for visible feedback
      const elapsed = Date.now() - startTime
      if (elapsed < TRAJECTORY_GENERATION_MIN_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, TRAJECTORY_GENERATION_MIN_DELAY_MS - elapsed))
      }

      setTrajectory(traj)
      setHasUnsavedChanges(false)
      if (currentShot) {
        updateSegment(currentShot.id, { trajectory: traj })
      }
    } finally {
      setIsGenerating(false)
    }
  }, [landingPoint, tracerConfig, originPoint, apexPoint, currentShot, updateSegment])

  const handleMarkApex = useCallback(() => {
    setIsMarkingApex(true)
    setIsMarkingOrigin(false)
    setIsMarkingLanding(false)
  }, [])

  const handleMarkOrigin = useCallback(() => {
    setIsMarkingOrigin(true)
    setIsMarkingApex(false)
    setIsMarkingLanding(false)
  }, [])

  const handleMarkLanding = useCallback(() => {
    setIsMarkingLanding(true)
    setIsMarkingApex(false)
    setIsMarkingOrigin(false)
  }, [])

  const handleSetImpactTime = useCallback(() => {
    if (!videoRef.current || !currentShot) return
    const globalImpactTime = currentShot.startTime + videoRef.current.currentTime
    if (globalImpactTime < currentShot.clipStart || globalImpactTime > currentShot.clipEnd) {
      return // Silent reject - out of bounds
    }
    updateSegment(currentShot.id, { strikeTime: globalImpactTime })
    setImpactTimeAdjusted(true)
    setHasUnsavedChanges(true)
  }, [currentShot, updateSegment])

  // Export approved clips using real-time capture + WebCodecs pipeline
  const handleExport = useCallback(async () => {
    const store = useProcessingStore.getState()
    const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
    const currentSegments = activeVid?.segments ?? store.segments
    const approved = currentSegments.filter(s => s.approved === 'approved')

    if (approved.length === 0) {
      alert('No approved shots to export')
      return
    }

    if (!isVideoFrameCallbackSupported()) {
      alert('requestVideoFrameCallback is not supported in this browser. Please use Chrome 83+, Edge 83+, or Safari 15.4+.')
      return
    }

    setShowExportModal(true)
    setExportProgress({ current: 0, total: approved.length })
    setExportPhase({ phase: 'preparing', progress: 0 })
    setExportComplete(false)
    setExportError(null)
    exportCancelledRef.current = false

    try {
      console.log('[Export] Starting real-time capture export...')
      const pipelineV4 = new VideoFramePipelineV4()

      for (let i = 0; i < approved.length; i++) {
        if (exportCancelledRef.current) break

        const segment = approved[i]
        setExportProgress({ current: i + 1, total: approved.length })

        console.log('[Export] Exporting segment', i + 1, 'of', approved.length)

        // Get trajectory points or empty array
        const trajectoryPoints = segment.trajectory?.points ?? []

        const configV4: ExportConfigV4 = {
          videoBlob: segment.blob,
          trajectory: trajectoryPoints,
          startTime: segment.clipStart - segment.startTime,
          endTime: segment.clipEnd - segment.startTime,
          resolution: exportResolution,
          onProgress: (progress) => {
            setExportPhase({ phase: progress.phase, progress: progress.progress })
          },
        }

        let exportedBlob = await pipelineV4.exportWithTracer(configV4)

        // Mux audio from original segment into the video-only export
        try {
          await loadFFmpeg()
          setExportPhase({ phase: 'muxing', progress: 50 })
          const clipStart = segment.clipStart - segment.startTime
          const clipEnd = segment.clipEnd - segment.startTime
          exportedBlob = await muxAudioIntoClip(exportedBlob, segment.blob, clipStart, clipEnd)
        } catch (audioErr) {
          console.warn('[ExportV4] Audio mux failed, exporting without audio:', audioErr)
        }

        // Download
        const url = URL.createObjectURL(exportedBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `shot_${i + 1}.mp4`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        await new Promise(r => setTimeout(r, 500))
      }

      if (!exportCancelledRef.current) {
        setExportComplete(true)
        autoCloseTimerRef.current = window.setTimeout(() => {
          setShowExportModal(false)
          onComplete()
        }, 1500)
      }
    } catch (error) {
      console.error('[Export] Export failed:', error)
      setExportError(error instanceof Error ? error.message : 'Export failed')
    }
  }, [onComplete, exportResolution])

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
    // Prevent approval before landing is marked and tracer reviewed
    if (reviewStep !== 'reviewing') return

    // Submit shot feedback (TRUE_POSITIVE = user confirmed this is a real golf shot)
    const initialTiming = initialClipTimingRef.current
    submitShotFeedback({
      shotIndex: currentIndex,
      feedbackType: 'TRUE_POSITIVE',
      confidence: currentShot.confidence,
      clipStart: initialTiming?.clipStart,
      clipEnd: initialTiming?.clipEnd,
      userAdjustedStart: currentShot.clipStart !== initialTiming?.clipStart ? currentShot.clipStart : undefined,
      userAdjustedEnd: currentShot.clipEnd !== initialTiming?.clipEnd ? currentShot.clipEnd : undefined,
    })

    // Submit tracer feedback if user set a landing point
    if (landingPoint && trajectory) {
      const feedbackType = tracerModifiedRef.current ? 'CONFIGURED' : 'AUTO_ACCEPTED'
      submitTracerFeedback({
        shotIndex: currentIndex,
        feedbackType,
        autoParams: initialTracerParamsRef.current || undefined,
        finalParams: {
          originX: originPoint?.x ?? 0.5,
          originY: originPoint?.y ?? 0.85,
          landingX: landingPoint.x,
          landingY: landingPoint.y,
          apexX: apexPoint?.x,
          apexY: apexPoint?.y,
          shape: tracerConfig.shape,
          height: tracerConfig.height,
          flightTime: tracerConfig.flightTime,
        },
        tracerStyle: tracerStyle,
      })
    } else {
      // User approved without setting up tracer - skip feedback
      submitTracerFeedback({
        shotIndex: currentIndex,
        feedbackType: 'SKIP',
        finalParams: {},
      })
    }

    approveSegment(currentShot.id)

    if (currentIndex < shotsNeedingReview.length - 1) {
      // Stay at same index - approved shot will filter out
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
    // When last shot is approved, component will naturally show review-complete UI
    // User can then click the export button when ready
  }, [currentShot, currentIndex, shotsNeedingReview.length, approveSegment, landingPoint, trajectory, originPoint, apexPoint, tracerConfig, tracerStyle, reviewStep])

  const handleReject = useCallback(() => {
    if (!currentShot) return

    // Submit shot feedback (FALSE_POSITIVE = detector incorrectly identified this as a golf shot)
    const initialTiming = initialClipTimingRef.current
    submitShotFeedback({
      shotIndex: currentIndex,
      feedbackType: 'FALSE_POSITIVE',
      confidence: currentShot.confidence,
      clipStart: initialTiming?.clipStart,
      clipEnd: initialTiming?.clipEnd,
    })

    rejectSegment(currentShot.id)

    if (currentIndex < shotsNeedingReview.length - 1) {
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
    // When last shot is rejected, component will naturally show review-complete UI
    // User can then click the export button when ready (if any shots were approved)
  }, [currentShot, currentIndex, shotsNeedingReview.length, rejectSegment])

  // Wrapper that shows confirmation dialog instead of rejecting immediately
  const handleRejectWithConfirm = useCallback(() => {
    setShowRejectConfirm(true)
  }, [])

  // Register handlers and progress with the shared store so header can display them
  const { setHandlers, setCanApprove, setProgress, clearHandlers } = useReviewActionsStore()
  useEffect(() => {
    setHandlers(handleApprove, handleRejectWithConfirm)
    return () => clearHandlers()
  }, [handleApprove, handleRejectWithConfirm, setHandlers, clearHandlers])

  useEffect(() => {
    setCanApprove(reviewStep === 'reviewing')
  }, [reviewStep, setCanApprove])

  useEffect(() => {
    setProgress(currentIndex, totalShots)
  }, [currentIndex, totalShots, setProgress])

  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  const stepFrameForward = useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.currentTime += 1/60
  }, [])

  const stepFrameBackward = useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1/60)
  }, [])

  const skipToStart = useCallback(() => {
    if (!videoRef.current || !currentShot) return
    const clipStartInVideo = currentShot.clipStart - currentShot.startTime
    videoRef.current.currentTime = clipStartInVideo
  }, [currentShot])

  const skipToEnd = useCallback(() => {
    if (!videoRef.current || !currentShot) return
    const clipEndInVideo = currentShot.clipEnd - currentShot.startTime
    videoRef.current.currentTime = clipEndInVideo
  }, [currentShot])

  const handleTrimUpdate = useCallback((newStart: number, newEnd: number) => {
    if (currentShot) {
      updateSegment(currentShot.id, {
        clipStart: newStart,
        clipEnd: newEnd,
      })
    }
  }, [currentShot, updateSegment])

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
          e.preventDefault()
          if (!showRejectConfirm) {
            setShowRejectConfirm(true)
          }
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
        case 'i':
        case 'I':
          e.preventDefault()
          if (reviewStep === 'reviewing') {
            handleSetImpactTime()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePlayPause, handlePrevious, handleNext, handleApprove, handleReject, reviewStep, trajectory, currentShot, handleTrimUpdate, showRejectConfirm, handleSetImpactTime])

  if (!currentShot) {
    const approvedCount = segments.filter(s => s.approved === 'approved').length
    return (
      <div className="clip-review-complete">
        <div className="review-complete-icon">✓</div>
        <h2>All shots have been reviewed!</h2>
        <p className="review-complete-summary">
          {approvedCount} {approvedCount === 1 ? 'shot' : 'shots'} approved
        </p>
        <div className="review-complete-actions">
          {approvedCount > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  value={exportResolution}
                  onChange={(e) => setExportResolution(e.target.value as ExportResolution)}
                  style={{ padding: '8px', borderRadius: '4px' }}
                >
                  <option value="original">Original</option>
                  <option value="1080p">1080p (faster)</option>
                  <option value="720p">720p (fastest)</option>
                </select>
                <button
                  onClick={handleExport}
                  className="btn-primary btn-large"
                  disabled={!isVideoFrameCallbackSupported()}
                >
                  Export {approvedCount} Clip{approvedCount !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}
          <button onClick={onComplete} className="btn-secondary">
            Process Another Video
          </button>
        </div>

        {/* Export Modal - also rendered in complete state */}
        {showExportModal && (
          <div className="export-modal-overlay">
            <div className="export-modal">
              <div className="export-modal-header">
                <h3>{exportError ? 'Export Failed' : exportComplete ? 'Export Complete!' : 'Exporting Clips'}</h3>
              </div>
              <div className="export-modal-content">
                {exportError ? (
                  <>
                    <div className="export-error-icon">!</div>
                    <p className="export-error-message">{exportError}</p>
                    <button
                      onClick={() => { setShowExportModal(false); setExportError(null) }}
                      className="btn-secondary"
                    >
                      Close
                    </button>
                  </>
                ) : !exportComplete ? (
                  <>
                    <div className="export-progress-bar">
                      <div
                        className={`export-progress-fill${exportPhase.progress === -1 ? ' indeterminate' : ''}`}
                        style={{ width: exportPhase.progress === -1 ? '100%' : `${exportPhase.progress}%` }}
                      />
                    </div>
                    <p className="export-status">
                      Clip {exportProgress.current} of {exportProgress.total}
                      {exportPhase.phase && (
                        exportPhase.progress === -1
                          ? ` — ${exportPhase.phase}...`
                          : ` — ${exportPhase.phase} ${exportPhase.progress}%`
                      )}
                    </p>
                    <button
                      onClick={() => {
                        exportCancelledRef.current = true
                        setShowExportModal(false)
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <div className="export-success-icon">✓</div>
                    <p className="export-result">{exportProgress.total} clips downloaded</p>
                    <button
                      onClick={() => {
                        // Clear auto-close timer to prevent double onComplete
                        if (autoCloseTimerRef.current) {
                          clearTimeout(autoCloseTimerRef.current)
                          autoCloseTimerRef.current = null
                        }
                        setShowExportModal(false)
                        onComplete()
                      }}
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

  return (
    <div className="clip-review">
      {/* Review header with shot counter */}
      <div className="review-header">
        <span className="review-title">Review Shots</span>
        <span className="review-progress">{currentIndex + 1} of {totalShots}</span>
      </div>

      {/* Video transport controls */}
      <div className="video-transport-controls">
        <button
          onClick={skipToStart}
          className="btn-transport"
          title="Skip to clip start"
        >
          ⏮
        </button>
        <button
          onClick={stepFrameBackward}
          className="btn-transport"
          title="Step back 1 frame"
        >
          ⏪
        </button>
        <button
          onClick={togglePlayPause}
          className="btn-transport btn-transport-play"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          onClick={stepFrameForward}
          className="btn-transport"
          title="Step forward 1 frame"
        >
          ⏩
        </button>
        <button
          onClick={skipToEnd}
          className="btn-transport"
          title="Skip to clip end"
        >
          ⏭
        </button>
      </div>

      <Scrubber
        videoRef={videoRef}
        startTime={currentShot.clipStart - currentShot.startTime}
        endTime={currentShot.clipEnd - currentShot.startTime}
        videoDuration={currentShot.endTime - currentShot.startTime}
        onTimeUpdate={(newStart, newEnd) => {
          // Convert blob-relative times back to global for storage
          handleTrimUpdate(newStart + currentShot.startTime, newEnd + currentShot.startTime)
        }}
      />

      {/* Review action buttons - positioned above video */}
      <div className="review-actions">
        <button onClick={() => setShowRejectConfirm(true)} className="btn-no-shot">
          ✕ No Golf Shot
        </button>
        <button
          onClick={handleApprove}
          className="btn-primary btn-large"
          disabled={reviewStep !== 'reviewing'}
        >
          ✓ Approve Shot
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

      {/* TracerConfigPanel - above video for easy access */}
      {reviewStep === 'reviewing' && (
        <TracerConfigPanel
          config={tracerConfig}
          onChange={handleConfigChange}
          style={tracerStyle}
          onStyleChange={handleStyleChange}
          onGenerate={handleGenerate}
          onMarkApex={handleMarkApex}
          onMarkOrigin={handleMarkOrigin}
          onMarkLanding={handleMarkLanding}
          hasChanges={hasUnsavedChanges}
          apexMarked={!!apexPoint}
          originMarked={!!originPoint}
          landingMarked={!!landingPoint}
          isMarkingLanding={isMarkingLanding}
          isGenerating={isGenerating}
          isCollapsed={!showConfigPanel}
          onToggleCollapse={() => setShowConfigPanel(!showConfigPanel)}
          onSetImpactTime={handleSetImpactTime}
          impactTime={currentShot ? currentShot.strikeTime - currentShot.startTime : 0}
          impactTimeAdjusted={impactTimeAdjusted}
        />
      )}

      <div className="video-container">
        {videoError ? (
          <div className="video-error-overlay">
            <div className="video-error-content">
              <span className="video-error-icon">⚠</span>
              <h3>Video Cannot Play</h3>
              <p>{videoError}</p>
              <p className="video-error-hint">
                The video may use HEVC/H.265 encoding which browsers cannot play natively.
                Try processing a different video or re-export the original as H.264.
              </p>
              <button onClick={handleReject} className="btn-secondary">
                Skip This Clip
              </button>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={currentShot.objectUrl}
            className="review-video"
            muted={isMuted}
            playsInline
            onClick={togglePlayPause}
            onCanPlay={handleVideoCanPlay}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={handleVideoError}
          />
        )}
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
          isMarkingLanding={isMarkingLanding}
        />
      </div>

      {/* Playback and tracer controls */}
      <div className="tracer-controls">
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="btn-audio-toggle"
          title={isMuted ? 'Click to unmute' : 'Click to mute'}
        >
          {isMuted ? '🔇 Unmute' : '🔊 Sound On'}
        </button>
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
              <h3>{exportError ? 'Export Failed' : exportComplete ? 'Export Complete!' : 'Exporting Clips'}</h3>
            </div>
            <div className="export-modal-content">
              {exportError ? (
                <>
                  <div className="export-error-icon">!</div>
                  <p className="export-error-message">{exportError}</p>
                  <button
                    onClick={() => { setShowExportModal(false); setExportError(null) }}
                    className="btn-secondary"
                  >
                    Close
                  </button>
                </>
              ) : !exportComplete ? (
                <>
                  <div className="export-progress-bar">
                    <div
                      className={`export-progress-fill${exportPhase.progress === -1 ? ' indeterminate' : ''}`}
                      style={{ width: exportPhase.progress === -1 ? '100%' : `${exportPhase.progress}%` }}
                    />
                  </div>
                  <p className="export-status">
                    Clip {exportProgress.current} of {exportProgress.total}
                    {exportPhase.phase && (
                      exportPhase.progress === -1
                        ? ` — ${exportPhase.phase}...`
                        : ` — ${exportPhase.phase} ${exportPhase.progress}%`
                    )}
                  </p>
                  <button
                    onClick={() => {
                      exportCancelledRef.current = true
                      setShowExportModal(false)
                    }}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div className="export-success-icon">✓</div>
                  <p className="export-result">{exportProgress.total} clips downloaded</p>
                  <button
                    onClick={() => {
                      // Clear auto-close timer to prevent double onComplete
                      if (autoCloseTimerRef.current) {
                        clearTimeout(autoCloseTimerRef.current)
                        autoCloseTimerRef.current = null
                      }
                      setShowExportModal(false)
                      onComplete()
                    }}
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

      {/* Confirmation dialog for destructive actions (Escape / No Golf Shot) */}
      {showRejectConfirm && (
        <ConfirmDialog
          message="Skip this shot? It will be marked as not a golf shot."
          confirmLabel="Skip Shot"
          cancelLabel="Cancel"
          onConfirm={() => {
            setShowRejectConfirm(false)
            handleReject()
          }}
          onCancel={() => setShowRejectConfirm(false)}
        />
      )}
    </div>
  )
}
