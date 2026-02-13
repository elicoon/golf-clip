import { useRef, useState, useEffect, useCallback, RefObject } from 'react'

interface ScrubberProps {
  videoRef: RefObject<HTMLVideoElement>
  startTime: number
  endTime: number
  onTimeUpdate: (start: number, end: number) => void
  disabled?: boolean
  videoDuration?: number // Total video duration for extended boundary support
}

type DragTarget = 'start' | 'end' | 'playhead' | null

export function Scrubber({
  videoRef,
  startTime,
  endTime,
  onTimeUpdate,
  disabled = false,
  videoDuration,
}: ScrubberProps) {
  const scrubberRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<DragTarget>(null)
  const [currentTime, setCurrentTime] = useState(startTime)
  const [duration, setDuration] = useState(0)
  const [hoverPosition, setHoverPosition] = useState<number | null>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  // Window around the clip to show (extra context before and after)
  // Lock the window while dragging to prevent it from shifting
  const [lockedWindow, setLockedWindow] = useState<{ start: number; end: number } | null>(null)

  // The scrubber window shows the full available segment
  // Users can extend the clip up to the segment boundaries (0 to videoDuration)
  const totalDuration = videoDuration || duration

  // Calculate window bounds - always show the full segment so user can extend to boundaries
  // When dragging, lock the window to prevent jumping
  const windowStart = lockedWindow
    ? lockedWindow.start
    : 0  // Segment always starts at 0 (times are relative to segment)

  // Guard against inverted window - ensure windowEnd > windowStart
  const rawWindowEnd = lockedWindow
    ? lockedWindow.end
    : totalDuration || Math.max(endTime + 5, 30)  // Show full segment, fallback if duration unknown
  const windowEnd = Math.max(rawWindowEnd, windowStart + 1) // Ensure at least 1s window

  // Prevent division by zero/negative
  const windowDuration = Math.max(0.1, windowEnd - windowStart)

  // Track video metadata and time updates
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
    }

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('timeupdate', handleTimeUpdate)

    if (video.duration) {
      setDuration(video.duration)
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [videoRef])

  const timeToPosition = useCallback(
    (time: number): number => {
      if (windowDuration === 0) return 0
      return ((time - windowStart) / windowDuration) * 100
    },
    [windowStart, windowDuration]
  )

  const positionToTime = useCallback(
    (position: number): number => {
      return windowStart + (position / 100) * windowDuration
    },
    [windowStart, windowDuration]
  )

  const getPositionFromEvent = useCallback(
    (clientX: number): number => {
      if (!scrubberRef.current) return 0
      const rect = scrubberRef.current.getBoundingClientRect()
      const position = ((clientX - rect.left) / rect.width) * 100
      return Math.max(0, Math.min(100, position))
    },
    []
  )

  const handleMouseDown = (
    e: React.MouseEvent,
    type: DragTarget
  ) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()

    // Lock the window dimensions when starting to drag a handle
    // Use full segment bounds (0 to totalDuration)
    if (type === 'start' || type === 'end') {
      setLockedWindow({
        start: 0,
        end: totalDuration || Math.max(endTime + 5, 30),
      })
    }

    setIsDragging(type)
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !scrubberRef.current || disabled) return

      const position = getPositionFromEvent(e.clientX)
      const time = positionToTime(position)

      if (isDragging === 'start') {
        // Ensure minimum 0.5s clip duration and clamp to bounds
        const newStart = Math.max(0, Math.min(time, endTime - 0.5))
        onTimeUpdate(newStart, endTime)
      } else if (isDragging === 'end') {
        // Ensure minimum 0.5s clip duration and clamp to video bounds
        // Use videoDuration prop if available, otherwise fall back to loaded duration
        const maxEnd = videoDuration || duration || endTime + 30
        const newEnd = Math.min(maxEnd, Math.max(time, startTime + 0.5))
        onTimeUpdate(startTime, newEnd)
      } else if (isDragging === 'playhead') {
        if (videoRef.current) {
          const clampedTime = Math.max(windowStart, Math.min(windowEnd, time))
          videoRef.current.currentTime = clampedTime
        }
      }
    },
    [isDragging, getPositionFromEvent, positionToTime, startTime, endTime, duration, videoDuration, onTimeUpdate, videoRef, windowStart, windowEnd, disabled]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(null)
    // Unlock the window after dragging ends
    setLockedWindow(null)
  }, [])

  // Global mouse event listeners for drag operations
  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleTrackClick = (e: React.MouseEvent) => {
    if (!scrubberRef.current || isDragging || disabled) return

    const position = getPositionFromEvent(e.clientX)
    const time = positionToTime(position)

    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }

  const handleMouseLeave = () => {
    setHoverPosition(null)
    setHoverTime(null)
  }

  const handleTrackMouseMove = (e: React.MouseEvent) => {
    if (isDragging || disabled) return
    const position = getPositionFromEvent(e.clientX)
    const time = positionToTime(position)
    setHoverPosition(position)
    setHoverTime(time)
  }

  const startPos = timeToPosition(startTime)
  const endPos = timeToPosition(endTime)
  const playheadPos = timeToPosition(currentTime)

  return (
    <div className={`scrubber-container ${disabled ? 'scrubber-disabled' : ''}`}>
      <div
        className={`scrubber ${isDragging ? 'scrubber-dragging' : ''}`}
        ref={scrubberRef}
        onClick={handleTrackClick}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleTrackMouseMove}
      >
        {/* Background track */}
        <div className="scrubber-track" />

        {/* Out-of-bounds regions (dimmed) */}
        <div
          className="scrubber-region-outside"
          style={{ left: 0, width: `${startPos}%` }}
        />
        <div
          className="scrubber-region-outside"
          style={{ left: `${endPos}%`, width: `${100 - endPos}%` }}
        />

        {/* Selected region */}
        <div
          className={`scrubber-selection ${isDragging ? 'scrubber-selection-active' : ''}`}
          style={{
            left: `${startPos}%`,
            width: `${endPos - startPos}%`,
          }}
        />

        {/* Hover preview indicator */}
        {hoverPosition !== null && hoverTime !== null && !isDragging && (
          <div
            className="scrubber-hover-preview"
            style={{ left: `${hoverPosition}%` }}
          >
            <div className="scrubber-hover-thumbnail">
              {/* Placeholder for future thumbnail preview */}
              <div className="scrubber-hover-thumbnail-placeholder" />
            </div>
            <div className="scrubber-hover-time">{formatTime(hoverTime)}</div>
          </div>
        )}

        {/* Start handle */}
        <div
          className={`scrubber-handle scrubber-handle-start ${isDragging === 'start' ? 'scrubber-handle-active' : ''}`}
          style={{ left: `${startPos}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'start')}
          title="Drag to adjust clip start"
        >
          <div className="handle-grip">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>

        {/* End handle */}
        <div
          className={`scrubber-handle scrubber-handle-end ${isDragging === 'end' ? 'scrubber-handle-active' : ''}`}
          style={{ left: `${endPos}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'end')}
          title="Drag to adjust clip end"
        >
          <div className="handle-grip">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>

        {/* Playhead */}
        <div
          className={`scrubber-playhead ${isDragging === 'playhead' ? 'scrubber-playhead-active' : ''}`}
          style={{ left: `${playheadPos}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'playhead')}
          title="Current playback position"
        />
      </div>

      {/* Time labels */}
      <div className="scrubber-labels">
        <span className="scrubber-label-start">{formatTime(windowStart)}</span>
        <span className="scrubber-label-current">
          <span className="scrubber-label-icon">▶</span>
          {formatTime(currentTime)}
        </span>
        <span className="scrubber-label-end">{formatTime(windowEnd)}</span>
      </div>

      {/* Clip duration indicator */}
      <div className="scrubber-clip-info">
        <span className="scrubber-clip-duration">
          Clip: {formatTime(startTime)} - {formatTime(endTime)} ({formatDuration(endTime - startTime)})
        </span>
      </div>
    </div>
  )
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${mins}m ${secs}s`
}
