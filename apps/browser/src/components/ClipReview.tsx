import { useState, useRef, useEffect, useCallback } from 'react'
import { useProcessingStore, TrajectoryData, TracerConfig, VideoSegment } from '../stores/processingStore'
import { useReviewActionsStore } from '../stores/reviewActionsStore'
import { Scrubber } from './Scrubber'
import { TrajectoryEditor } from './TrajectoryEditor'
import { TracerConfigPanel } from './TracerConfigPanel'
import { HevcTranscodeModal, HevcTranscodeModalState, initialHevcTranscodeModalState } from './HevcTranscodeModal'
import { TracerStyle, DEFAULT_TRACER_STYLE } from '../types/tracer'
import { submitShotFeedback, submitTracerFeedback } from '../lib/feedback-service'
import { VideoFramePipeline, ExportConfig, HevcExportError } from '../lib/video-frame-pipeline'
import { VideoFramePipelineV2, ExportConfigV2 } from '../lib/video-frame-pipeline-v2'
import { VideoFramePipelineV3, ExportConfigV3, ExportResolution } from '../lib/video-frame-pipeline-v3'
import { VideoFramePipelineV4, ExportConfigV4, isVideoFrameCallbackSupported } from '../lib/video-frame-pipeline-v4'
import { loadFFmpeg, getFFmpegInstance, transcodeHevcToH264, estimateTranscodeTime } from '../lib/ffmpeg-client'
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
  const [exportQuality, setExportQuality] = useState<'draft' | 'preview' | 'final'>('preview')
  const [exportResolution, setExportResolution] = useState<ExportResolution>('1080p')
  const exportCancelledRef = useRef(false)
  const defensiveTimeoutRef = useRef<number | null>(null)
  const autoCloseTimerRef = useRef<number | null>(null)

  // HEVC transcode modal state (shown when export fails due to HEVC codec)
  const [hevcTranscodeModal, setHevcTranscodeModal] = useState<HevcTranscodeModalState>(initialHevcTranscodeModalState)
  const transcodeAbortRef = useRef<AbortController | null>(null)

  // Video playback error state
  const [videoError, setVideoError] = useState<string | null>(null)

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

  // Cleanup defensive timeout on unmount
  useEffect(() => {
    return () => {
      if (defensiveTimeoutRef.current) {
        clearTimeout(defensiveTimeoutRef.current)
      }
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

  // Export a single segment with tracer overlay
  // Returns the blob if successful, null if skipped (no trajectory)
  const exportSegmentWithTracer = useCallback(async (
    segment: typeof segments[0],
    _segmentIndex: number,
    pipeline: VideoFramePipeline
  ): Promise<Blob | null> => {
    if (!segment.trajectory || segment.trajectory.points.length === 0) {
      console.log('[Export] No trajectory, returning null for raw download')
      return null // No trajectory - will download raw segment
    }

    console.log('[Export] Building export config...', {
      blobSize: segment.blob.size,
      trajectoryPoints: segment.trajectory.points.length,
      clipStart: segment.clipStart,
      clipEnd: segment.clipEnd,
      startTime: segment.startTime,
    })

    const exportConfig: ExportConfig = {
      videoBlob: segment.blob,
      trajectory: segment.trajectory.points,
      startTime: segment.clipStart - segment.startTime,
      endTime: segment.clipEnd - segment.startTime,
      fps: 30,
      quality: exportQuality,
      tracerStyle: tracerStyle,
      landingPoint: segment.landingPoint ?? undefined,
      apexPoint: apexPoint ?? undefined,
      originPoint: originPoint ?? undefined,
      onProgress: (progress) => {
        console.log('[Export] Progress:', progress.phase, progress.progress)
        setExportPhase({ phase: progress.phase, progress: progress.progress })
      }
    }

    console.log('[Export] Calling pipeline.exportWithTracer...')
    const result = await pipeline.exportWithTracer(exportConfig)
    console.log('[Export] pipeline.exportWithTracer returned')
    return result
  }, [exportQuality, tracerStyle, apexPoint, originPoint])

  // Export approved clips
  // Note: Get segments directly from store to avoid stale closure issue
  // when handleExport is called immediately after approveSegment
  const handleExport = useCallback(async () => {
    // Use multi-video segments when available, fall back to legacy segments
    const store = useProcessingStore.getState()
    const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
    const currentSegments = activeVid?.segments ?? store.segments
    const approved = currentSegments.filter(s => s.approved === 'approved')
    if (approved.length === 0) {
      onComplete()
      return
    }

    setShowExportModal(true)
    setExportProgress({ current: 0, total: approved.length })
    setExportPhase({ phase: '', progress: 0 })
    setExportComplete(false)
    setExportError(null)
    exportCancelledRef.current = false

    try {
      // Load FFmpeg for tracer export
      console.log('[Export] Loading FFmpeg...')
      await loadFFmpeg()
      console.log('[Export] FFmpeg loaded')
      const ffmpeg = getFFmpegInstance()
      const pipeline = new VideoFramePipeline(ffmpeg)

      for (let i = 0; i < approved.length; i++) {
        if (exportCancelledRef.current) break

        const segment = approved[i]
        console.log('[Export] Processing segment', i + 1, 'of', approved.length, {
          hasTrajectory: !!segment.trajectory,
          trajectoryPoints: segment.trajectory?.points?.length ?? 0,
          hasObjectUrl: !!segment.objectUrl,
          hasBlob: !!segment.blob,
        })
        setExportProgress({ current: i + 1, total: approved.length })

        try {
          const exportedBlob = await exportSegmentWithTracer(segment, i, pipeline)
          console.log('[Export] exportSegmentWithTracer returned:', exportedBlob ? 'blob' : 'null')

          if (exportedBlob) {
            // Download the exported MP4
            const url = URL.createObjectURL(exportedBlob)
            const a = document.createElement('a')
            a.href = url
            a.download = `shot_${i + 1}.mp4`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          } else {
            // No trajectory - download raw segment as MP4
            const a = document.createElement('a')
            a.href = segment.objectUrl
            a.download = `shot_${i + 1}.mp4`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
          }
        } catch (segmentError) {
          // Check if it's an HEVC error - show transcode modal
          if (segmentError instanceof HevcExportError) {
            const fileSizeMB = Math.round(segment.blob.size / (1024 * 1024))
            const { formatted: estimatedTime } = estimateTranscodeTime(fileSizeMB)

            // Hide export modal and show HEVC transcode modal
            setShowExportModal(false)
            setHevcTranscodeModal({
              show: true,
              segmentIndex: i,
              segmentBlob: segment.blob,
              estimatedTime,
              isTranscoding: false,
              transcodeProgress: 0,
              transcodeStartTime: null,
            })
            return // Exit export loop - user will choose to transcode or cancel
          }
          // Re-throw other errors
          throw segmentError
        }

        // Small delay between downloads to avoid browser throttling
        await new Promise(r => setTimeout(r, 500))
      }

      if (!exportCancelledRef.current) {
        setExportComplete(true)
        // Auto-close modal after showing success for 1.5 seconds
        // Track timer so Done button can cancel it to prevent double onComplete
        autoCloseTimerRef.current = window.setTimeout(() => {
          autoCloseTimerRef.current = null
          // Clear defensive timeout when modal auto-closes on success
          if (defensiveTimeoutRef.current) {
            clearTimeout(defensiveTimeoutRef.current)
            defensiveTimeoutRef.current = null
          }
          setShowExportModal(false)
          onComplete()
        }, 1500)
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'An error occurred during export')
    } finally {
      // Clear any existing defensive timeout before potentially setting a new one
      if (defensiveTimeoutRef.current) {
        clearTimeout(defensiveTimeoutRef.current)
        defensiveTimeoutRef.current = null
      }
      // Defensive: Ensure modal closes even if exception occurs after downloads
      // This handles edge cases where exceptions bypass setExportComplete(true)
      // Only set the timeout if export wasn't cancelled
      if (!exportCancelledRef.current) {
        // Wait 10 seconds - if modal is still open without error/complete, force close
        defensiveTimeoutRef.current = window.setTimeout(() => {
          // Only force close if we're in a stuck state (modal open, no error, not complete, not cancelled)
          // Use functional updates to check current state values at timeout time
          setShowExportModal(currentShowModal => {
            if (currentShowModal && !exportCancelledRef.current) {
              // Check if we're in a stuck state by looking at what the modal would show
              // If we get here, the modal is open - but is it showing error or complete?
              // We can't directly check exportError/exportComplete, so we force close
              // and let the normal flow handle it if it's actually showing something
              console.warn('[ClipReview] Export modal stuck - forcing close after timeout')
              return false // Force close
            }
            return currentShowModal
          })
          defensiveTimeoutRef.current = null  // Clear after running
        }, 10000)
      }
    }
  }, [onComplete, exportSegmentWithTracer])

  // POC: Export using V2 pipeline with FFmpeg filter approach
  const handleExportV2 = useCallback(async () => {
    const store = useProcessingStore.getState()
    const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
    const currentSegments = activeVid?.segments ?? store.segments
    const approved = currentSegments.filter(s => s.approved === 'approved')

    if (approved.length === 0) {
      alert('No approved shots to export')
      return
    }

    setShowExportModal(true)
    setExportProgress({ current: 0, total: approved.length })
    setExportPhase({ phase: 'preparing', progress: 0 })
    setExportComplete(false)
    setExportError(null)
    exportCancelledRef.current = false

    try {
      console.log('[ExportV2] Loading FFmpeg...')
      await loadFFmpeg()
      const ffmpeg = getFFmpegInstance()
      const pipelineV2 = new VideoFramePipelineV2(ffmpeg)

      for (let i = 0; i < approved.length; i++) {
        if (exportCancelledRef.current) break

        const segment = approved[i]
        setExportProgress({ current: i + 1, total: approved.length })

        console.log('[ExportV2] Exporting segment', i + 1, 'of', approved.length)

        // Get trajectory points or empty array
        const trajectoryPoints = segment.trajectory?.points ?? []

        const configV2: ExportConfigV2 = {
          videoBlob: segment.blob,
          trajectory: trajectoryPoints,
          startTime: segment.clipStart - segment.startTime,
          endTime: segment.clipEnd - segment.startTime,
          quality: exportQuality,
          onProgress: (progress) => {
            setExportPhase({ phase: progress.phase, progress: progress.progress })
          },
        }

        const exportedBlob = await pipelineV2.exportWithTracer(configV2)

        // Download
        const url = URL.createObjectURL(exportedBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `shot_${i + 1}_v2.mp4`
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
      console.error('[ExportV2] Export failed:', error)
      setExportError(error instanceof Error ? error.message : 'Export V2 failed')
    }
  }, [onComplete, exportQuality])

  // POC: Export using V3 pipeline with WebCodecs (hardware accelerated)
  const handleExportV3 = useCallback(async () => {
    const store = useProcessingStore.getState()
    const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
    const currentSegments = activeVid?.segments ?? store.segments
    const approved = currentSegments.filter(s => s.approved === 'approved')

    if (approved.length === 0) {
      alert('No approved shots to export')
      return
    }

    setShowExportModal(true)
    setExportProgress({ current: 0, total: approved.length })
    setExportPhase({ phase: 'preparing', progress: 0 })
    setExportComplete(false)
    setExportError(null)
    exportCancelledRef.current = false

    try {
      console.log('[ExportV3] Starting WebCodecs export...')
      const pipelineV3 = new VideoFramePipelineV3()

      for (let i = 0; i < approved.length; i++) {
        if (exportCancelledRef.current) break

        const segment = approved[i]
        setExportProgress({ current: i + 1, total: approved.length })

        console.log('[ExportV3] Exporting segment', i + 1, 'of', approved.length)

        // Get trajectory points or empty array
        const trajectoryPoints = segment.trajectory?.points ?? []

        const configV3: ExportConfigV3 = {
          videoBlob: segment.blob,
          trajectory: trajectoryPoints,
          startTime: segment.clipStart - segment.startTime,
          endTime: segment.clipEnd - segment.startTime,
          resolution: exportResolution,
          onProgress: (progress) => {
            setExportPhase({ phase: progress.phase, progress: progress.progress })
          },
        }

        const exportedBlob = await pipelineV3.exportWithTracer(configV3)

        // Download
        const url = URL.createObjectURL(exportedBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `shot_${i + 1}_v3.mp4`
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
      console.error('[ExportV3] Export failed:', error)
      setExportError(error instanceof Error ? error.message : 'Export V3 failed')
    }
  }, [onComplete])

  // POC: Export using V4 pipeline with requestVideoFrameCallback (real-time capture)
  const handleExportV4 = useCallback(async () => {
    const store = useProcessingStore.getState()
    const activeVid = store.activeVideoId ? store.videos.get(store.activeVideoId) : undefined
    const currentSegments = activeVid?.segments ?? store.segments
    const approved = currentSegments.filter(s => s.approved === 'approved')

    if (approved.length === 0) {
      alert('No approved shots to export')
      return
    }

    if (!isVideoFrameCallbackSupported()) {
      alert('requestVideoFrameCallback is not supported in this browser. Please use V3 export instead.')
      return
    }

    setShowExportModal(true)
    setExportProgress({ current: 0, total: approved.length })
    setExportPhase({ phase: 'preparing', progress: 0 })
    setExportComplete(false)
    setExportError(null)
    exportCancelledRef.current = false

    try {
      console.log('[ExportV4] Starting real-time capture export...')
      const pipelineV4 = new VideoFramePipelineV4()

      for (let i = 0; i < approved.length; i++) {
        if (exportCancelledRef.current) break

        const segment = approved[i]
        setExportProgress({ current: i + 1, total: approved.length })

        console.log('[ExportV4] Exporting segment', i + 1, 'of', approved.length)

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

        const exportedBlob = await pipelineV4.exportWithTracer(configV4)

        // Download
        const url = URL.createObjectURL(exportedBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `shot_${i + 1}_v4.mp4`
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
      console.error('[ExportV4] Export failed:', error)
      setExportError(error instanceof Error ? error.message : 'Export V4 failed')
    }
  }, [onComplete, exportResolution])

  // Handle HEVC transcode and retry export
  const handleTranscodeAndExport = useCallback(async () => {
    if (!hevcTranscodeModal.segmentBlob) return

    const segmentBlob = hevcTranscodeModal.segmentBlob
    const segmentIndex = hevcTranscodeModal.segmentIndex

    // Get the segment ID to track it and prevent recursive loops
    const currentSegments = useProcessingStore.getState().segments
    const approved = currentSegments.filter(s => s.approved === 'approved')
    const segment = approved[segmentIndex]

    if (!segment) return

    // Guard: Check if this segment was already transcoded to prevent recursive loops
    // This can happen if transcode succeeds but export still fails for some reason
    const alreadyTranscoded = hevcTranscodeModal.transcodedSegmentIds?.has(segment.id)
    if (alreadyTranscoded) {
      // This segment was already transcoded but still failed - show error instead of looping
      setHevcTranscodeModal(initialHevcTranscodeModalState)
      setShowExportModal(true)
      setExportError(`Export failed for clip ${segmentIndex + 1}: Video still cannot be processed after conversion`)
      return
    }

    // Create abort controller for cancellation
    transcodeAbortRef.current = new AbortController()

    // Update state to show transcoding progress and track this segment
    setHevcTranscodeModal(prev => ({
      ...prev,
      isTranscoding: true,
      transcodeProgress: 0,
      transcodeStartTime: Date.now(),
      transcodedSegmentIds: new Set([...(prev.transcodedSegmentIds || []), segment.id]),
    }))

    try {
      // Transcode the segment
      const h264Blob = await transcodeHevcToH264(
        segmentBlob,
        (percent) => {
          setHevcTranscodeModal(prev => ({
            ...prev,
            transcodeProgress: percent,
          }))
        },
        transcodeAbortRef.current.signal
      )

      // Revoke old object URL
      URL.revokeObjectURL(segment.objectUrl)

      // Update segment with transcoded blob
      const newObjectUrl = URL.createObjectURL(h264Blob)
      const segmentUpdate: Partial<VideoSegment> = {
        blob: h264Blob,
        objectUrl: newObjectUrl,
      }
      // Use multi-video or legacy update based on activeVideoId
      const store = useProcessingStore.getState()
      if (activeVideoId) {
        store.updateVideoSegment(activeVideoId, segment.id, segmentUpdate)
      } else {
        store.updateSegment(segment.id, segmentUpdate)
      }

      // Close transcode modal (preserve transcodedSegmentIds to track) and restart export
      setHevcTranscodeModal(prev => ({
        ...initialHevcTranscodeModalState,
        transcodedSegmentIds: prev.transcodedSegmentIds,
      }))

      // Restart export (it will now use the transcoded segment)
      handleExport()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled - reset to initial modal state (not closed)
        setHevcTranscodeModal(prev => ({
          ...prev,
          isTranscoding: false,
          transcodeProgress: 0,
          transcodeStartTime: null,
        }))
        return
      }
      // Other error - show in export modal (preserve transcodedSegmentIds)
      setHevcTranscodeModal(prev => ({
        ...initialHevcTranscodeModalState,
        transcodedSegmentIds: prev.transcodedSegmentIds,
      }))
      setShowExportModal(true)
      setExportError(`Transcode failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      transcodeAbortRef.current = null
    }
  }, [hevcTranscodeModal.segmentBlob, hevcTranscodeModal.segmentIndex, hevcTranscodeModal.transcodedSegmentIds, handleExport])

  // Cancel HEVC transcode modal (go back to review)
  const handleCancelHevcTranscode = useCallback(() => {
    transcodeAbortRef.current?.abort()
    setHevcTranscodeModal(initialHevcTranscodeModalState)
  }, [])

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
  }, [currentShot, currentIndex, shotsNeedingReview.length, approveSegment, landingPoint, trajectory, originPoint, apexPoint, tracerConfig, tracerStyle])

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

  // Register handlers and progress with the shared store so header can display them
  const { setHandlers, setProgress, clearHandlers } = useReviewActionsStore()
  useEffect(() => {
    setHandlers(handleApprove, handleReject)
    return () => clearHandlers()
  }, [handleApprove, handleReject, setHandlers, clearHandlers])

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
    const approvedCount = segments.filter(s => s.approved === 'approved').length
    return (
      <div className="clip-review-complete">
        <div className="review-complete-icon">✓</div>
        <h2>All shots have been reviewed!</h2>
        <p className="review-complete-summary">
          {approvedCount} shots approved
        </p>
        {approvedCount > 0 && (
          <div className="export-quality-selector">
            <label className="quality-label">Export Quality:</label>
            <div className="quality-options">
              <button
                className={`quality-option ${exportQuality === 'draft' ? 'active' : ''}`}
                onClick={() => setExportQuality('draft')}
                title="Fast export, lower quality"
              >
                <span className="quality-name">Draft</span>
                <span className="quality-desc">Fast</span>
              </button>
              <button
                className={`quality-option ${exportQuality === 'preview' ? 'active' : ''}`}
                onClick={() => setExportQuality('preview')}
                title="Balanced quality and speed"
              >
                <span className="quality-name">Preview</span>
                <span className="quality-desc">Balanced</span>
              </button>
              <button
                className={`quality-option ${exportQuality === 'final' ? 'active' : ''}`}
                onClick={() => setExportQuality('final')}
                title="Best quality, slower export"
              >
                <span className="quality-name">Final</span>
                <span className="quality-desc">Best</span>
              </button>
            </div>
            <p className="export-format-hint" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              All clips export as .mp4
            </p>
          </div>
        )}
        <div className="review-complete-actions">
          {approvedCount > 0 && (
            <>
              <button onClick={handleExport} className="btn-primary btn-large">
                Export {approvedCount} Clip{approvedCount !== 1 ? 's' : ''}
              </button>
              <button
                onClick={handleExportV2}
                className="btn-secondary btn-large"
                title="POC: Export using FFmpeg filter approach (faster for 4K)"
              >
                Export V2 (POC)
              </button>
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
                  onClick={handleExportV3}
                  className="btn-secondary btn-large"
                  title="POC: Export using WebCodecs (hardware accelerated)"
                >
                  Export V3
                </button>
                <button
                  onClick={handleExportV4}
                  className="btn-secondary btn-large"
                  title="POC: Export using requestVideoFrameCallback (real-time capture, ~1x speed)"
                  disabled={!isVideoFrameCallbackSupported()}
                >
                  Export V4
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
                        if (defensiveTimeoutRef.current) {
                          clearTimeout(defensiveTimeoutRef.current)
                          defensiveTimeoutRef.current = null
                        }
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
                        if (defensiveTimeoutRef.current) {
                          clearTimeout(defensiveTimeoutRef.current)
                          defensiveTimeoutRef.current = null
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

        {/* HEVC Transcode Modal - also rendered in complete state */}
        <HevcTranscodeModal
          state={hevcTranscodeModal}
          onStartTranscode={handleTranscodeAndExport}
          onCancel={handleCancelHevcTranscode}
        />
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
        <button onClick={handleReject} className="btn-no-shot">
          ✕ No Golf Shot
        </button>
        <button onClick={handleApprove} className="btn-primary btn-large">
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
                      if (defensiveTimeoutRef.current) {
                        clearTimeout(defensiveTimeoutRef.current)
                        defensiveTimeoutRef.current = null
                      }
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
                      if (defensiveTimeoutRef.current) {
                        clearTimeout(defensiveTimeoutRef.current)
                        defensiveTimeoutRef.current = null
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

      {/* HEVC Transcode Modal - shown when export fails due to HEVC codec */}
      <HevcTranscodeModal
        state={hevcTranscodeModal}
        onStartTranscode={handleTranscodeAndExport}
        onCancel={handleCancelHevcTranscode}
      />
    </div>
  )
}
