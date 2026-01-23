import { useState, useCallback } from 'react'
import { useAppStore } from '../stores/appStore'

interface ExportCompleteProps {
  jobId: string
  exportedClips: string[]
  onReset: () => void
}

type FeedbackType = 'true_positive' | 'false_positive' | null

interface ClipFeedback {
  shot_id: number
  feedback_type: FeedbackType
  notes: string
}

export function ExportComplete({ jobId, exportedClips, onReset }: ExportCompleteProps) {
  const { shots } = useAppStore()
  const [feedbackMap, setFeedbackMap] = useState<Map<number, ClipFeedback>>(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedNotes, setExpandedNotes] = useState<number | null>(null)

  // Get exported shot IDs from file paths (shot_{id}.mp4)
  const exportedShotIds = exportedClips.map(path => {
    const match = path.match(/shot_(\d+)\.mp4$/)
    return match ? parseInt(match[1], 10) : null
  }).filter((id): id is number => id !== null)

  const handleFeedback = useCallback((shotId: number, type: FeedbackType) => {
    setFeedbackMap(prev => {
      const updated = new Map(prev)
      const existing = updated.get(shotId) || { shot_id: shotId, feedback_type: null, notes: '' }

      // Toggle off if clicking same button
      if (existing.feedback_type === type) {
        updated.delete(shotId)
      } else {
        updated.set(shotId, { ...existing, feedback_type: type })
      }
      return updated
    })
  }, [])

  const handleNotesChange = useCallback((shotId: number, notes: string) => {
    setFeedbackMap(prev => {
      const updated = new Map(prev)
      const existing = updated.get(shotId) || { shot_id: shotId, feedback_type: null, notes: '' }
      updated.set(shotId, { ...existing, notes })
      return updated
    })
  }, [])

  const submitFeedback = useCallback(async () => {
    const feedbackItems = Array.from(feedbackMap.values())
      .filter(f => f.feedback_type !== null)
      .map(f => ({
        shot_id: f.shot_id,
        feedback_type: f.feedback_type,
        notes: f.notes || null,
      }))

    if (feedbackItems.length === 0) {
      onReset()
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`http://127.0.0.1:8420/api/feedback/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedbackItems }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Server error: ${response.status}`)
      }

      setSubmitted(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit feedback'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }, [feedbackMap, jobId, onReset])

  const feedbackCount = Array.from(feedbackMap.values()).filter(f => f.feedback_type !== null).length

  if (submitted) {
    return (
      <div className="export-complete">
        <div className="complete-icon">&#10003;</div>
        <h2>Thank You!</h2>
        <p>Your feedback helps improve detection accuracy.</p>
        <p className="feedback-summary">
          Submitted feedback for {feedbackCount} clip{feedbackCount !== 1 ? 's' : ''}.
        </p>
        <button onClick={onReset} className="btn-primary btn-large">
          Process Another Video
        </button>
      </div>
    )
  }

  return (
    <div className="export-complete">
      <div className="complete-icon">&#10003;</div>
      <h2>Export Complete!</h2>
      <p className="export-message">
        {exportedClips.length} clip{exportedClips.length !== 1 ? 's' : ''} exported successfully.
      </p>

      <div className="feedback-section">
        <h3>Help Improve Detection</h3>
        <p className="feedback-description">
          Mark each clip as a good detection or false positive. This data helps us improve accuracy.
        </p>

        <div className="clips-feedback-list">
          {exportedShotIds.map(shotId => {
            const shot = shots.find(s => s.id === shotId)
            const feedback = feedbackMap.get(shotId)
            const isExpanded = expandedNotes === shotId

            return (
              <div key={shotId} className="clip-feedback-item">
                <div className="clip-info">
                  <span className="clip-name">Shot {shotId}</span>
                  {shot && (
                    <span className="clip-time">
                      {formatTime(shot.clip_start)} - {formatTime(shot.clip_end)}
                    </span>
                  )}
                </div>

                <div className="feedback-buttons">
                  <button
                    className={`btn-feedback btn-good ${feedback?.feedback_type === 'true_positive' ? 'active' : ''}`}
                    onClick={() => handleFeedback(shotId, 'true_positive')}
                    title="Good detection"
                  >
                    &#10003; Good
                  </button>
                  <button
                    className={`btn-feedback btn-bad ${feedback?.feedback_type === 'false_positive' ? 'active' : ''}`}
                    onClick={() => handleFeedback(shotId, 'false_positive')}
                    title="False positive"
                  >
                    &#10007; Bad
                  </button>
                  <button
                    className="btn-notes"
                    onClick={() => setExpandedNotes(isExpanded ? null : shotId)}
                    title="Add notes"
                  >
                    &#9998;
                  </button>
                </div>

                {isExpanded && (
                  <div className="notes-input">
                    <input
                      type="text"
                      placeholder="Optional: Why was this a false positive?"
                      value={feedback?.notes || ''}
                      onChange={(e) => handleNotesChange(shotId, e.target.value)}
                      maxLength={500}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && (
          <div className="feedback-error">
            {error}
          </div>
        )}

        <div className="feedback-actions">
          <button
            onClick={submitFeedback}
            className="btn-primary"
            disabled={submitting}
          >
            {submitting ? 'Submitting...' : feedbackCount > 0 ? `Submit Feedback (${feedbackCount})` : 'Skip Feedback'}
          </button>
          <button onClick={onReset} className="btn-secondary">
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
