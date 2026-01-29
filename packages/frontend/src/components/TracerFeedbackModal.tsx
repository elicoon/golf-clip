// src/frontend/src/components/TracerFeedbackModal.tsx
import { useCallback } from 'react'

export interface TracerFeedbackModalProps {
  isOpen: boolean
  onClose: () => void
  hasTriedAllInputs: boolean
  missingInputs: string[]
  onAcceptAnyway: () => void
  onSkipShot: () => void
  onAcceptNoTracer: () => void
}

export function TracerFeedbackModal({
  isOpen,
  onClose,
  hasTriedAllInputs,
  missingInputs,
  onAcceptAnyway,
  onSkipShot,
  onAcceptNoTracer,
}: TracerFeedbackModalProps) {
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  if (!isOpen) return null

  // Map input keys to friendly names
  const friendlyNames: Record<string, string> = {
    height: 'shot height',
    shape: 'shot shape',
    startingLine: 'starting line',
    flightTime: 'flight time',
    apex: 'apex point',
  }

  return (
    <div
      className="tracer-feedback-modal-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tracer-feedback-title"
    >
      <div className="tracer-feedback-modal">
        {!hasTriedAllInputs ? (
          <>
            <h3 id="tracer-feedback-title" className="tracer-feedback-title">
              Try a few more options
            </h3>
            <p className="tracer-feedback-message">
              You haven't tried all the configuration options yet.
            </p>
            <div className="tracer-feedback-suggestions">
              <p className="suggestions-label">Try adjusting:</p>
              <ul className="suggestions-list">
                {missingInputs.map((input) => (
                  <li key={input} className="suggestion-item">
                    {input === 'apex'
                      ? 'Mark the apex point'
                      : `Adjust ${friendlyNames[input] || input}`}
                  </li>
                ))}
              </ul>
            </div>
            <div className="tracer-feedback-actions single">
              <button
                type="button"
                className="btn-primary btn-ok"
                onClick={onClose}
                autoFocus
              >
                OK, I'll try that
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="tracer-feedback-title" className="tracer-feedback-title">
              Thanks for your feedback
            </h3>
            <p className="tracer-feedback-message">
              We'll use this to improve trajectory generation in the future.
            </p>
            <p className="tracer-feedback-submessage">
              What would you like to do?
            </p>
            <div className="tracer-feedback-actions">
              <button
                type="button"
                className="btn-primary btn-accept-anyway"
                onClick={onAcceptAnyway}
                autoFocus
              >
                Accept current trajectory
              </button>
              <button
                type="button"
                className="btn-secondary btn-no-tracer"
                onClick={onAcceptNoTracer}
              >
                Accept shot without trajectory
              </button>
              <button
                type="button"
                className="btn-skip-shot"
                onClick={onSkipShot}
              >
                Skip this shot
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
