import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/appStore'

interface ProcessingViewProps {
  jobId: string
  onComplete: (needsReview: boolean) => void
}

interface ProcessingStatus {
  video_path: string
  status: string
  progress: number
  current_step: string
  total_shots_detected: number
  shots_needing_review: number
  error_message: string | null
}

export function ProcessingView({ jobId, onComplete }: ProcessingViewProps) {
  const [status, setStatus] = useState<ProcessingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { setShots } = useAppStore()

  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await fetch(
          `http://127.0.0.1:8420/api/status/${jobId}`
        )
        const data: ProcessingStatus = await response.json()
        setStatus(data)

        if (data.status === 'error') {
          setError(data.error_message || 'An error occurred')
        } else if (data.status === 'review' || data.status === 'complete') {
          // Fetch the detected shots
          const shotsResponse = await fetch(
            `http://127.0.0.1:8420/api/shots/${jobId}`
          )
          const shotsData = await shotsResponse.json()
          setShots(shotsData)

          onComplete(data.status === 'review')
        }
      } catch (err) {
        setError('Failed to connect to processing server')
      }
    }

    // Poll every second while processing
    const interval = setInterval(pollStatus, 1000)
    pollStatus() // Initial poll

    return () => clearInterval(interval)
  }, [jobId, onComplete, setShots])

  if (error) {
    return (
      <div className="processing-view error">
        <h2>Processing Error</h2>
        <p>{error}</p>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="processing-view">
        <h2>Initializing...</h2>
      </div>
    )
  }

  return (
    <div className="processing-view">
      <h2>Processing Video</h2>
      <p className="filename">{status.video_path.split('/').pop()}</p>

      <div className="progress-container">
        <div
          className="progress-bar"
          style={{ width: `${status.progress}%` }}
        />
      </div>
      <p className="progress-text">{Math.round(status.progress)}%</p>

      <p className="current-step">{status.current_step}</p>

      {status.total_shots_detected > 0 && (
        <div className="detection-summary">
          <p>Shots detected: {status.total_shots_detected}</p>
          {status.shots_needing_review > 0 && (
            <p className="needs-review">
              {status.shots_needing_review} shots need review
            </p>
          )}
        </div>
      )}
    </div>
  )
}
