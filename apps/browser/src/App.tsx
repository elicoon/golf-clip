// apps/browser/src/App.tsx
import { useState, useEffect } from 'react'
import { VideoDropzone } from './components/VideoDropzone'
import { ClipReview } from './components/ClipReview'
import { VideoQueue } from './components/VideoQueue'
import { useProcessingStore } from './stores/processingStore'

type AppView = 'upload' | 'review' | 'export'

export default function App() {
  const { status, segments, error, reset, videos, activeVideoId } = useProcessingStore()
  const [view, setView] = useState<AppView>('upload')

  // Get active video state
  const activeVideo = activeVideoId ? videos.get(activeVideoId) : undefined
  const hasVideos = videos.size > 0

  const handleReviewComplete = () => {
    setView('export')
  }

  const handleReset = () => {
    reset()
    setView('upload')
  }

  // Auto-transition to review when a video is ready
  useEffect(() => {
    if (activeVideo?.status === 'ready' && view === 'upload' && activeVideo.segments.length > 0) {
      setView('review')
    }
  }, [activeVideo?.status, view, activeVideo?.segments.length])

  // Also support legacy single-video flow
  useEffect(() => {
    if (status === 'ready' && view === 'upload' && segments.length > 0) {
      setView('review')
    }
  }, [status, view, segments.length])

  return (
    <div className="app">
      <header className="app-header">
        <h1>GolfClip</h1>
        <div className="header-actions">
          {(view !== 'upload' || hasVideos) && (
            <button onClick={handleReset} className="btn-secondary">
              New Video
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {/* Show queue when there are multiple videos */}
        {hasVideos && <VideoQueue />}

        {error && (
          <div className="app-error">
            <h3>Error</h3>
            <p>{error}</p>
            <button onClick={handleReset} className="btn-secondary">
              Try Again
            </button>
          </div>
        )}

        {view === 'upload' && !error && (
          <VideoDropzone />
        )}

        {view === 'review' && (
          <ClipReview onComplete={handleReviewComplete} />
        )}

        {view === 'export' && (
          <div className="export-complete">
            <div className="review-complete-icon">OK</div>
            <h2>Review Complete!</h2>
            <p className="export-message">
              {(activeVideo?.segments || segments).filter(s => s.approved === 'approved').length} shots approved
            </p>
            <button onClick={handleReset} className="btn-primary btn-large">
              Process Another Video
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
