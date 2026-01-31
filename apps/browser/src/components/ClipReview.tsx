import { useState, useRef, useEffect, useCallback } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { Scrubber } from './Scrubber'

interface ClipReviewProps {
  onComplete: () => void
}

export function ClipReview({ onComplete }: ClipReviewProps) {
  const { segments, updateSegment, approveSegment, rejectSegment } = useProcessingStore()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Filter to shots needing review (confidence < 0.7)
  const shotsNeedingReview = segments.filter(s => s.confidence < 0.7)
  const currentShot = shotsNeedingReview[currentIndex]
  const totalShots = shotsNeedingReview.length

  // Seek to clip start when shot changes
  useEffect(() => {
    if (videoRef.current && currentShot) {
      videoRef.current.currentTime = currentShot.clipStart
    }
  }, [currentShot?.id])

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  const handleNext = () => {
    if (currentIndex < totalShots - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handleApprove = () => {
    if (!currentShot) return
    approveSegment(currentShot.id)

    if (currentIndex >= shotsNeedingReview.length - 1) {
      onComplete()
    } else {
      // Stay at same index - approved shot will filter out
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
  }

  const handleReject = () => {
    if (!currentShot) return
    rejectSegment(currentShot.id)

    if (currentIndex >= shotsNeedingReview.length - 1) {
      onComplete()
    } else {
      setCurrentIndex(Math.min(currentIndex, shotsNeedingReview.length - 2))
    }
  }

  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  const handleTimeUpdate = useCallback((newStart: number, newEnd: number) => {
    if (currentShot) {
      updateSegment(currentShot.id, {
        clipStart: newStart,
        clipEnd: newEnd,
      })
    }
  }, [currentShot, updateSegment])

  if (!currentShot) {
    return (
      <div className="clip-review-complete">
        <div className="review-complete-icon">✓</div>
        <h2>All shots have been reviewed!</h2>
        <p className="review-complete-summary">
          {segments.filter(s => s.approved).length} shots approved
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

      <div className="video-container">
        <video
          ref={videoRef}
          src={currentShot.objectUrl}
          className="review-video"
          onClick={togglePlayPause}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      </div>

      <Scrubber
        videoRef={videoRef}
        startTime={currentShot.clipStart}
        endTime={currentShot.clipEnd}
        onTimeUpdate={handleTimeUpdate}
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
        <span><kbd>↑</kbd><kbd>↓</kbd> Prev/Next</span>
        <span><kbd>Enter</kbd> Approve</span>
        <span><kbd>Esc</kbd> Reject</span>
      </div>
    </div>
  )
}
