import { useState, useCallback } from 'react'
import { VideoDropzone } from './components/VideoDropzone'
import { ProcessingView } from './components/ProcessingView'
import { ClipReview } from './components/ClipReview'
import { useAppStore } from './stores/appStore'

type AppView = 'home' | 'processing' | 'review' | 'complete'

interface ApiError {
  message: string
  details?: string
}

function App() {
  const { currentJob, setCurrentJob, setShots } = useAppStore()
  const [view, setView] = useState<AppView>('home')
  const [error, setError] = useState<ApiError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleVideoSelected = useCallback(async (filePath: string) => {
    setError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch('http://127.0.0.1:8420/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: filePath }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Server error: ${response.status}`)
      }

      const data = await response.json()
      setCurrentJob(data)
      setView('processing')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start processing'
      setError({
        message: 'Failed to start processing',
        details: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [setCurrentJob])

  const handleProcessingComplete = useCallback((needsReview: boolean) => {
    setView(needsReview ? 'review' : 'complete')
  }, [])

  const handleReviewComplete = useCallback(() => {
    setView('complete')
  }, [])

  const handleReset = useCallback(() => {
    setCurrentJob(null)
    setShots([])
    setError(null)
    setView('home')
  }, [setCurrentJob, setShots])

  return (
    <div className="app">
      <header className="app-header">
        <h1>GolfClip</h1>
        {view !== 'home' && (
          <button onClick={handleReset} className="btn-secondary">
            New Video
          </button>
        )}
      </header>

      <main className="app-main">
        {view === 'home' && (
          <>
            <VideoDropzone onVideoSelected={handleVideoSelected} />
            {isSubmitting && (
              <div className="submitting-overlay">
                <div className="spinner-large" />
                <p>Starting processing...</p>
              </div>
            )}
            {error && (
              <div className="app-error">
                <h3>{error.message}</h3>
                {error.details && <p>{error.details}</p>}
                <button onClick={() => setError(null)} className="btn-secondary">
                  Dismiss
                </button>
              </div>
            )}
          </>
        )}

        {view === 'processing' && currentJob && (
          <ProcessingView
            jobId={currentJob.job_id}
            onComplete={handleProcessingComplete}
            onCancel={handleReset}
          />
        )}

        {view === 'review' && currentJob && (
          <ClipReview
            jobId={currentJob.job_id}
            videoPath={currentJob.video_info.path}
            onComplete={handleReviewComplete}
          />
        )}

        {view === 'complete' && (
          <div className="complete-view">
            <div className="complete-icon">✓</div>
            <h2>Processing Complete!</h2>
            <p>Your clips have been exported successfully.</p>
            <button onClick={handleReset} className="btn-primary btn-large">
              Process Another Video
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
