import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from '../stores/appStore'
import { config } from '../config'

interface ProcessingViewProps {
  jobId: string
  onComplete: (needsReview: boolean, totalShots: number) => void
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

interface SSEProgressEvent {
  job_id: string
  step: string
  progress: number
  details: string | null
  timestamp: string
}

const PROCESSING_STEPS = [
  'Initializing',
  'Analyzing audio',
  'Detecting shots',
  'Processing video',
  'Finalizing',
]

const MAX_SSE_RETRIES = 3
const BASE_URL = config.apiBaseUrl
const SSE_THROTTLE_MS = 100

export function ProcessingView({ jobId, onComplete, onCancel }: ProcessingViewProps & { onCancel?: () => void }) {
  const [status, setStatus] = useState<ProcessingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [usePolling, setUsePolling] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const { setShots } = useAppStore()

  const eventSourceRef = useRef<EventSource | null>(null)
  const sseRetryCountRef = useRef(0)
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastUpdateRef = useRef(0)
  const isCompletedRef = useRef(false) // Prevent duplicate completion handling

  const handleCancel = async () => {
    if (isCancelling) return // Prevent multiple cancel attempts
    if (!window.confirm('Cancel processing? All progress will be lost.')) {
      return
    }
    setIsCancelling(true)
    try {
      await fetch(`${BASE_URL}/api/cancel/${jobId}`, {
        method: 'POST',
      })
    } catch (err) {
      console.error('Cancel request failed:', err)
      setIsCancelling(false) // Allow retry on failure
    }
  }

  const isFinalizing = status?.current_step?.toLowerCase().includes('finalizing') ?? false

  // Cleanup functions defined first (no dependencies on other callbacks)
  const cleanupSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const cleanupPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }, [])

  const fetchShots = useCallback(async () => {
    const response = await fetch(`${BASE_URL}/api/shots/${jobId}`)
    if (!response.ok) {
      throw new Error('Failed to fetch detected shots')
    }
    return response.json()
  }, [jobId])

  const handleComplete = useCallback(async (needsReview: boolean, totalShots: number) => {
    // Prevent duplicate completion (race between SSE and polling)
    if (isCompletedRef.current) return
    isCompletedRef.current = true

    try {
      const shotsData = await fetchShots()
      setShots(shotsData)
      // Pass total shots from API, or fall back to fetched shots length
      onComplete(needsReview, totalShots > 0 ? totalShots : shotsData.length)
    } catch {
      isCompletedRef.current = false // Allow retry on failure
      setError('Failed to fetch detected shots')
    }
  }, [fetchShots, setShots, onComplete])

  const fetchStatusPolling = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/status/${jobId}`)

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`)
      }

      const data: ProcessingStatus = await response.json()
      setStatus(data)

      if (data.status === 'cancelled') {
        cleanupPolling()
        cleanupSSE()
        onCancel?.()
        return
      } else if (data.status === 'error') {
        cleanupPolling()
        cleanupSSE()
        setError(data.error_message || 'An error occurred during processing')
      } else if (data.status === 'review' || data.status === 'complete') {
        cleanupPolling()
        cleanupSSE()
        handleComplete(data.status === 'review', data.total_shots_detected)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection error'
      setError(`Failed to connect to processing server: ${errorMessage}`)
    }
  }, [jobId, handleComplete, onCancel, cleanupPolling, cleanupSSE])

  const startPolling = useCallback(() => {
    cleanupPolling()
    setUsePolling(true)
    fetchStatusPolling()
    pollingIntervalRef.current = setInterval(fetchStatusPolling, 1000)
  }, [cleanupPolling, fetchStatusPolling])

  const connectSSE = useCallback(() => {
    cleanupSSE()

    const eventSource = new EventSource(`${BASE_URL}/api/progress/${jobId}`)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      sseRetryCountRef.current = 0
    }

    eventSource.onmessage = (event) => {
      // Throttle rapid updates to avoid excessive re-renders
      const now = Date.now()
      if (now - lastUpdateRef.current < SSE_THROTTLE_MS) return
      lastUpdateRef.current = now

      try {
        const data: SSEProgressEvent = JSON.parse(event.data)

        setStatus(prev => ({
          video_path: prev?.video_path || '',
          status: 'processing',
          progress: data.progress,
          current_step: data.step,
          total_shots_detected: prev?.total_shots_detected || 0,
          shots_needing_review: prev?.shots_needing_review || 0,
          error_message: null,
        }))

        // Check if this is a completion message (progress 100% with completion step)
        // Check if this is a completion message (progress 100% with completion step)
        // This provides a fallback if the 'complete' SSE event doesn't fire
        if (data.progress >= 100 && (
          data.step.toLowerCase().includes('complete') ||
          data.step.toLowerCase().includes('need review')
        )) {
          // Delay slightly to allow the 'complete' event to arrive first
          setTimeout(() => {
            if (!isCompletedRef.current) {
              const needsReview = data.step.toLowerCase().includes('need review')
              // Try to extract shot count from message like "3 shots need review"
              const shotMatch = data.step.match(/(\d+)\s+shots?\s+need/)
              const totalShots = shotMatch ? parseInt(shotMatch[1], 10) : 0
              handleComplete(needsReview, totalShots)
            }
          }, 500)
        }
      } catch {
        // Ignore parse errors (keepalive comments)
      }
    }

    eventSource.addEventListener('complete', async (event) => {
      cleanupSSE()
      cleanupPolling()
      try {
        const data = JSON.parse((event as MessageEvent).data)
        const needsReview = data.shots_needing_review > 0
        const totalShots = data.total_shots_detected || 0

        setStatus(prev => ({
          ...prev!,
          status: needsReview ? 'review' : 'complete',
          progress: 100,
          total_shots_detected: totalShots || prev?.total_shots_detected || 0,
          shots_needing_review: data.shots_needing_review || 0,
        }))

        handleComplete(needsReview, totalShots)
      } catch {
        handleComplete(false, 0)
      }
    })

    eventSource.addEventListener('cancelled', () => {
      cleanupSSE()
      cleanupPolling()
      onCancel?.()
    })

    // Listen for processing_error (distinct from connection onerror)
    eventSource.addEventListener('processing_error', (event) => {
      cleanupSSE()
      cleanupPolling()
      try {
        const data = JSON.parse((event as MessageEvent).data)
        setError(data.error_message || 'An error occurred during processing')
      } catch {
        setError('An error occurred during processing')
      }
    })

    // Handle connection errors (network issues, server down, etc.)
    eventSource.onerror = () => {
      cleanupSSE()
      sseRetryCountRef.current++

      if (sseRetryCountRef.current < MAX_SSE_RETRIES) {
        setTimeout(connectSSE, 1000 * sseRetryCountRef.current)
      } else {
        startPolling()
      }
    }
  }, [jobId, cleanupSSE, cleanupPolling, handleComplete, startPolling, onCancel])

  useEffect(() => {
    // Fetch initial status, then connect SSE
    fetchStatusPolling()
    connectSSE()

    return () => {
      cleanupSSE()
      cleanupPolling()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setError(null)
    setUsePolling(false)
    sseRetryCountRef.current = 0
    isCompletedRef.current = false // Reset completion flag for retry
    cleanupPolling()
    fetchStatusPolling()
    connectSSE()
  }

  if (error) {
    return (
      <div className="processing-view">
        <div className="processing-error">
          <div className="error-icon-large">!</div>
          <h2>Processing Error</h2>
          <p className="error-description">{error}</p>
          <button onClick={handleRetry} className="btn-primary">
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="processing-view">
        <div className="processing-initializing">
          <div className="spinner-large" />
          <h2>Initializing...</h2>
          <p className="initializing-hint">
            {usePolling ? 'Using polling fallback' : 'Connecting to processing server'}
          </p>
          <div className="init-progress-container">
            <div className="init-progress-bar">
              <div className="init-progress-fill" />
            </div>
          </div>
          <button
            className="btn-danger"
            onClick={handleCancel}
            disabled={isCancelling}
          >
            {isCancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
      </div>
    )
  }

  const currentStepIndex = PROCESSING_STEPS.findIndex(
    step => status.current_step.toLowerCase().includes(step.toLowerCase())
  )

  return (
    <div className="processing-view">
      <h2>Processing Video</h2>
      <p className="filename">{getFileName(status.video_path)}</p>

      <div className="progress-container">
        <div
          className="progress-bar"
          style={{ width: `${status.progress}%` }}
        />
      </div>
      <p className="progress-text">{Math.round(status.progress)}%</p>

      <div className="processing-steps">
        {PROCESSING_STEPS.map((step, index) => (
          <div
            key={step}
            className={`processing-step ${
              index < currentStepIndex
                ? 'step-complete'
                : index === currentStepIndex
                ? 'step-active'
                : 'step-pending'
            }`}
          >
            <div className="step-indicator">
              {index < currentStepIndex ? '✓' : index === currentStepIndex ? <span className="step-spinner" /> : ''}
            </div>
            <span className="step-label">{step}</span>
          </div>
        ))}
      </div>

      <p className="current-step">{status.current_step}</p>

      <button
        className="btn-danger"
        onClick={handleCancel}
        disabled={isCancelling || isFinalizing}
      >
        {isCancelling ? 'Cancelling...' : 'Cancel'}
      </button>

      {status.total_shots_detected > 0 && (
        <div className="detection-summary">
          <div className="detection-stat">
            <span className="stat-value">{status.total_shots_detected}</span>
            <span className="stat-label">shots detected</span>
          </div>
          {status.shots_needing_review > 0 && (
            <div className="detection-stat needs-review">
              <span className="stat-value">{status.shots_needing_review}</span>
              <span className="stat-label">need review</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getFileName(path: string): string {
  // Handle both forward and backslashes
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}
