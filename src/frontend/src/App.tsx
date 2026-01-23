import { useState } from 'react'
import { VideoDropzone } from './components/VideoDropzone'
import { ProcessingView } from './components/ProcessingView'
import { ClipReview } from './components/ClipReview'
import { useAppStore } from './stores/appStore'

type AppView = 'home' | 'processing' | 'review' | 'complete'

function App() {
  const { currentJob, setCurrentJob } = useAppStore()
  const [view, setView] = useState<AppView>('home')

  const handleVideoSelected = async (filePath: string) => {
    // Start processing
    setView('processing')

    try {
      const response = await fetch('http://127.0.0.1:8420/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: filePath }),
      })

      const data = await response.json()
      setCurrentJob(data)
    } catch (error) {
      console.error('Failed to start processing:', error)
      setView('home')
    }
  }

  const handleProcessingComplete = (needsReview: boolean) => {
    setView(needsReview ? 'review' : 'complete')
  }

  const handleReviewComplete = () => {
    setView('complete')
  }

  const handleReset = () => {
    setCurrentJob(null)
    setView('home')
  }

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
          <VideoDropzone onVideoSelected={handleVideoSelected} />
        )}

        {view === 'processing' && currentJob && (
          <ProcessingView
            jobId={currentJob.job_id}
            onComplete={handleProcessingComplete}
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
            <h2>Processing Complete!</h2>
            <p>Your clips have been exported.</p>
            <button onClick={handleReset} className="btn-primary">
              Process Another Video
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
