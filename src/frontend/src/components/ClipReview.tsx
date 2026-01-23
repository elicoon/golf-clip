import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { Scrubber } from './Scrubber'

interface ClipReviewProps {
  jobId: string
  videoPath: string
  onComplete: () => void
}

export function ClipReview({ jobId, videoPath, onComplete }: ClipReviewProps) {
  const { shots, updateShot } = useAppStore()
  const [currentShotIndex, setCurrentShotIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Filter to shots needing review (confidence < 70%)
  const shotsNeedingReview = shots.filter((s) => s.confidence < 0.7)
  const currentShot = shotsNeedingReview[currentShotIndex]

  useEffect(() => {
    if (videoRef.current && currentShot) {
      videoRef.current.currentTime = currentShot.clip_start
    }
  }, [currentShot])

  const handleTimeUpdate = (newStart: number, newEnd: number) => {
    if (currentShot) {
      updateShot(currentShot.id, {
        clip_start: newStart,
        clip_end: newEnd,
      })
    }
  }

  const handleAccept = async () => {
    if (!currentShot) return

    // Mark as approved (confidence = 1.0)
    updateShot(currentShot.id, { confidence: 1.0 })

    // Send update to server
    await fetch(`http://127.0.0.1:8420/api/shots/${jobId}/update`, {
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

    // Move to next shot or complete
    if (currentShotIndex < shotsNeedingReview.length - 1) {
      setCurrentShotIndex(currentShotIndex + 1)
    } else {
      // All shots reviewed, export clips
      await exportClips()
      onComplete()
    }
  }

  const handleReject = () => {
    // Skip this shot (don't include in export)
    updateShot(currentShot.id, { confidence: 0 })

    if (currentShotIndex < shotsNeedingReview.length - 1) {
      setCurrentShotIndex(currentShotIndex + 1)
    } else {
      exportClips()
      onComplete()
    }
  }

  const exportClips = async () => {
    const approvedClips = shots
      .filter((s) => s.confidence >= 0.7)
      .map((s) => ({
        shot_id: s.id,
        start_time: s.clip_start,
        end_time: s.clip_end,
        approved: true,
      }))

    await fetch('http://127.0.0.1:8420/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: jobId,
        clips: approvedClips,
        output_dir: videoPath.replace(/\.[^.]+$/, '_clips'),
        filename_pattern: 'shot_{shot_id}',
      }),
    })
  }

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const stepFrame = (direction: number) => {
    if (videoRef.current) {
      // Assuming 60fps
      videoRef.current.currentTime += direction * (1 / 60)
    }
  }

  if (!currentShot) {
    return (
      <div className="clip-review">
        <h2>All clips reviewed!</h2>
        <button onClick={onComplete} className="btn-primary">
          Export Clips
        </button>
      </div>
    )
  }

  return (
    <div className="clip-review">
      <h2>
        Review Shot #{currentShot.id} ({currentShotIndex + 1}/
        {shotsNeedingReview.length})
      </h2>

      <div className="video-container">
        <video
          ref={videoRef}
          src={`file://${videoPath}`}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      </div>

      <Scrubber
        videoRef={videoRef}
        startTime={currentShot.clip_start}
        endTime={currentShot.clip_end}
        onTimeUpdate={handleTimeUpdate}
      />

      <div className="playback-controls">
        <button onClick={() => stepFrame(-1)} className="btn-icon">
          ◄◄
        </button>
        <button onClick={() => stepFrame(-1)} className="btn-icon">
          ◄
        </button>
        <button onClick={togglePlayPause} className="btn-primary">
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={() => stepFrame(1)} className="btn-icon">
          ►
        </button>
        <button onClick={() => stepFrame(1)} className="btn-icon">
          ►►
        </button>
      </div>

      <div className="confidence-info">
        <p>
          Confidence: {Math.round(currentShot.confidence * 100)}%
          {currentShot.confidence_reasons.length > 0 && (
            <span className="reasons">
              {' '}
              - {currentShot.confidence_reasons.join(', ')}
            </span>
          )}
        </p>
      </div>

      <div className="review-actions">
        <button onClick={handleReject} className="btn-secondary">
          ✗ Reject
        </button>
        <button onClick={handleAccept} className="btn-primary">
          ✓ Accept
        </button>
      </div>

      <div className="time-display">
        <span>Start: {currentShot.clip_start.toFixed(2)}s</span>
        <span>End: {currentShot.clip_end.toFixed(2)}s</span>
        <span>
          Duration: {(currentShot.clip_end - currentShot.clip_start).toFixed(2)}
          s
        </span>
      </div>
    </div>
  )
}
