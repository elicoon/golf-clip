import { useRef, useState, useEffect, useCallback, RefObject } from 'react'

interface ScrubberProps {
  videoRef: RefObject<HTMLVideoElement>
  startTime: number
  endTime: number
  onTimeUpdate: (start: number, end: number) => void
}

export function Scrubber({
  videoRef,
  startTime,
  endTime,
  onTimeUpdate,
}: ScrubberProps) {
  const scrubberRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'playhead' | null>(null)
  const [currentTime, setCurrentTime] = useState(startTime)
  const [duration, setDuration] = useState(0)

  // Window around the clip to show (extra context before and after)
  const windowPadding = 5 // seconds
  const windowStart = Math.max(0, startTime - windowPadding)
  const windowEnd = Math.min(duration, endTime + windowPadding)
  const windowDuration = windowEnd - windowStart

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

  const handleMouseDown = (
    e: React.MouseEvent,
    type: 'start' | 'end' | 'playhead'
  ) => {
    e.preventDefault()
    setIsDragging(type)
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !scrubberRef.current) return

      const rect = scrubberRef.current.getBoundingClientRect()
      const position = ((e.clientX - rect.left) / rect.width) * 100
      const clampedPosition = Math.max(0, Math.min(100, position))
      const time = positionToTime(clampedPosition)

      if (isDragging === 'start') {
        const newStart = Math.min(time, endTime - 0.5)
        onTimeUpdate(Math.max(0, newStart), endTime)
      } else if (isDragging === 'end') {
        const newEnd = Math.max(time, startTime + 0.5)
        onTimeUpdate(startTime, Math.min(duration, newEnd))
      } else if (isDragging === 'playhead') {
        if (videoRef.current) {
          videoRef.current.currentTime = time
        }
      }
    },
    [isDragging, positionToTime, startTime, endTime, duration, onTimeUpdate, videoRef]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(null)
  }, [])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleTrackClick = (e: React.MouseEvent) => {
    if (!scrubberRef.current || isDragging) return

    const rect = scrubberRef.current.getBoundingClientRect()
    const position = ((e.clientX - rect.left) / rect.width) * 100
    const time = positionToTime(position)

    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
  }

  return (
    <div className="scrubber-container">
      <div className="scrubber" ref={scrubberRef} onClick={handleTrackClick}>
        {/* Background track */}
        <div className="scrubber-track" />

        {/* Selected region */}
        <div
          className="scrubber-selection"
          style={{
            left: `${timeToPosition(startTime)}%`,
            width: `${timeToPosition(endTime) - timeToPosition(startTime)}%`,
          }}
        />

        {/* Start handle */}
        <div
          className="scrubber-handle scrubber-handle-start"
          style={{ left: `${timeToPosition(startTime)}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'start')}
        >
          <div className="handle-grip" />
        </div>

        {/* End handle */}
        <div
          className="scrubber-handle scrubber-handle-end"
          style={{ left: `${timeToPosition(endTime)}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'end')}
        >
          <div className="handle-grip" />
        </div>

        {/* Playhead */}
        <div
          className="scrubber-playhead"
          style={{ left: `${timeToPosition(currentTime)}%` }}
          onMouseDown={(e) => handleMouseDown(e, 'playhead')}
        />
      </div>

      {/* Time labels */}
      <div className="scrubber-labels">
        <span>{formatTime(windowStart)}</span>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(windowEnd)}</span>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}
