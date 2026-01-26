// src/frontend/src/components/PointStatusTracker.tsx
import { useCallback } from 'react'

export type ReviewStep = 'marking_landing' | 'generating' | 'reviewing'

interface PointStatusTrackerProps {
  landingPoint: { x: number; y: number } | null
  reviewStep: ReviewStep
  isGenerating: boolean
  hasTrajectory: boolean
  onSelectStep: (step: ReviewStep) => void
}

type StatusState = 'active' | 'complete' | 'pending' | 'generating'

export function PointStatusTracker({
  landingPoint,
  reviewStep,
  isGenerating,
  hasTrajectory,
  onSelectStep,
}: PointStatusTrackerProps) {
  const getLandingStatus = useCallback((): StatusState => {
    if (landingPoint) return 'complete'
    if (reviewStep === 'marking_landing') return 'active'
    return 'pending'
  }, [landingPoint, reviewStep])

  const getReviewStatus = useCallback((): StatusState => {
    if (isGenerating) return 'generating'
    if (hasTrajectory) {
      if (reviewStep === 'reviewing') return 'active'
      return 'complete'
    }
    return 'pending'
  }, [isGenerating, hasTrajectory, reviewStep])

  const landingStatus = getLandingStatus()
  const reviewStatus = getReviewStatus()

  return (
    <div className="point-status-tracker">
      <StatusItem
        label="Mark Landing"
        status={landingStatus}
        icon="↓"
        onClick={() => {
          // Only allow going back to landing if not currently generating
          if (!isGenerating) {
            onSelectStep('marking_landing')
          }
        }}
        disabled={isGenerating}
      />

      <StatusConnector complete={!!landingPoint} />

      <StatusItem
        label={isGenerating ? 'Generating...' : 'Review Tracer'}
        status={reviewStatus}
        icon={isGenerating ? '...' : '✓'}
        onClick={() => {
          if (hasTrajectory && !isGenerating) {
            onSelectStep('reviewing')
          }
        }}
        disabled={!hasTrajectory || isGenerating}
      />
    </div>
  )
}

interface StatusItemProps {
  label: string
  status: StatusState
  icon: string
  onClick?: () => void
  disabled?: boolean
}

function StatusItem({
  label,
  status,
  icon,
  onClick,
  disabled,
}: StatusItemProps) {
  return (
    <div
      className={`status-item status-${status} ${!disabled ? 'clickable' : ''}`}
      onClick={!disabled ? onClick : undefined}
      title={disabled ? undefined : `Click to ${status === 'complete' ? 're-mark' : 'go to'} ${label.toLowerCase()}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick?.()
        }
      }}
    >
      <div
        className="status-icon"
        aria-label={
          status === 'complete'
            ? `${label} completed`
            : status === 'generating'
            ? `${label} in progress`
            : status === 'active'
            ? `${label} active`
            : `${label} pending`
        }
      >
        {status === 'complete' ? '✓' : status === 'generating' ? <span className="spinner-small" /> : icon}
      </div>
      <div className="status-label">
        {label}
      </div>
    </div>
  )
}

function StatusConnector({ complete }: { complete: boolean }) {
  return (
    <div className={`status-connector ${complete ? 'complete' : ''}`}>
      <div className="connector-line" />
    </div>
  )
}
