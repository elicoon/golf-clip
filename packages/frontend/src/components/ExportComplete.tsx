import { useState, useCallback, useMemo } from 'react'
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

  // Download state
  const [selectedForDownload, setSelectedForDownload] = useState<Set<string>>(
    () => new Set(exportedClips)
  )
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null)

  // Get exported shot IDs from file paths (shot_{id}.mp4)
  const exportedShotIds = useMemo(() =>
    exportedClips.map(path => {
      const match = path.match(/shot_(\d+)\.mp4$/)
      return match ? parseInt(match[1], 10) : null
    }).filter((id): id is number => id !== null),
    [exportedClips]
  )

  // Map paths to shot IDs for display
  const clipInfo = useMemo(() =>
    exportedClips.map(path => {
      const match = path.match(/shot_(\d+)\.mp4$/)
      const shotId = match ? parseInt(match[1], 10) : null
      const shot = shotId ? shots.find(s => s.id === shotId) : null
      const filename = path.split('/').pop() || path
      return { path, shotId, shot, filename }
    }),
    [exportedClips, shots]
  )

  const handleToggleClip = useCallback((path: string) => {
    setSelectedForDownload(prev => {
      const updated = new Set(prev)
      if (updated.has(path)) {
        updated.delete(path)
      } else {
        updated.add(path)
      }
      return updated
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedForDownload(new Set(exportedClips))
  }, [exportedClips])

  const handleDeselectAll = useCallback(() => {
    setSelectedForDownload(new Set())
  }, [])

  const handleDownloadSelected = useCallback(async () => {
    const selected = Array.from(selectedForDownload)
    if (selected.length === 0) return

    setDownloading(true)
    setDownloadProgress(null)

    try {
      for (let i = 0; i < selected.length; i++) {
        const path = selected[i]
        const filename = path.split('/').pop() || `clip_${i + 1}.mp4`

        setDownloadProgress(`Downloading ${i + 1} of ${selected.length}...`)

        // Fetch the file with download flag
        const response = await fetch(
          `http://127.0.0.1:8420/api/video?path=${encodeURIComponent(path)}&download=true`
        )

        if (!response.ok) {
          throw new Error(`Failed to download ${filename}`)
        }

        // Create blob and trigger download
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)

        // Small delay between downloads to prevent browser issues
        if (i < selected.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300))
        }
      }

      setDownloadProgress(`Downloaded ${selected.length} clip${selected.length !== 1 ? 's' : ''}!`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed'
      setDownloadProgress(`Error: ${message}`)
    } finally {
      setDownloading(false)
    }
  }, [selectedForDownload])

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
  const allSelected = selectedForDownload.size === exportedClips.length
  const noneSelected = selectedForDownload.size === 0

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

      {/* Download Section */}
      <div className="download-section">
        <h3>Download Clips</h3>
        <p className="download-description">
          Select the clips you want to download to your computer.
        </p>

        <div className="download-select-actions">
          <button
            className="btn-link"
            onClick={handleSelectAll}
            disabled={allSelected}
          >
            Select All
          </button>
          <span className="select-divider">|</span>
          <button
            className="btn-link"
            onClick={handleDeselectAll}
            disabled={noneSelected}
          >
            Deselect All
          </button>
        </div>

        <div className="clips-download-list">
          {clipInfo.map(({ path, shotId, shot, filename }) => (
            <label key={path} className="clip-download-item">
              <input
                type="checkbox"
                checked={selectedForDownload.has(path)}
                onChange={() => handleToggleClip(path)}
                disabled={downloading}
              />
              <span className="clip-download-info">
                <span className="clip-name">{shotId ? `Shot ${shotId}` : filename}</span>
                {shot && (
                  <span className="clip-time">
                    {formatTime(shot.clip_start)} - {formatTime(shot.clip_end)}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

        {downloadProgress && (
          <div className={`download-status ${downloadProgress.startsWith('Error') ? 'download-error' : ''}`}>
            {downloadProgress}
          </div>
        )}

        <button
          onClick={handleDownloadSelected}
          className="btn-primary btn-download"
          disabled={downloading || noneSelected}
        >
          {downloading ? 'Downloading...' : `Download${selectedForDownload.size > 0 ? ` (${selectedForDownload.size})` : ''}`}
        </button>
      </div>

      {/* Feedback Section */}
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
