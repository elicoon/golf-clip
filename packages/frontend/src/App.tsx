import { useState, useCallback } from 'react'
import { VideoDropzone } from './components/VideoDropzone'
import { ProcessingView } from './components/ProcessingView'
import { ClipReview } from './components/ClipReview'
import { ExportComplete } from './components/ExportComplete'
import { useAppStore } from './stores/appStore'

type AppView = 'home' | 'processing' | 'review' | 'complete'

interface ApiError {
  message: string
  details?: string
}

interface UploadedFile {
  filename: string
  path: string
  size: number
}

function App() {
  const {
    currentJob,
    setCurrentJob,
    setShots,
    videoQueue,
    currentQueueIndex,
    setVideoQueue,
    updateQueueItem,
    advanceQueue,
    clearQueue,
    getQueueStats,
  } = useAppStore()

  const [view, setView] = useState<AppView>('home')
  const [error, setError] = useState<ApiError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [exportedClips, setExportedClips] = useState<string[]>([])

  const queueStats = getQueueStats()
  const hasMultipleVideos = videoQueue.length > 1

  // Start processing a video from the queue
  const startProcessingVideo = useCallback(async (videoPath: string, queueIndex: number) => {
    setError(null)
    setIsSubmitting(true)

    // Update queue item status
    updateQueueItem(queueIndex, { status: 'processing' })

    try {
      const response = await fetch('http://127.0.0.1:8420/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: videoPath }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Server error: ${response.status}`)
      }

      const data = await response.json()
      setCurrentJob(data)

      // Update queue item with job ID
      updateQueueItem(queueIndex, { jobId: data.job_id })

      setView('processing')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start processing'
      updateQueueItem(queueIndex, { status: 'error', error: message })
      setError({
        message: 'Failed to start processing',
        details: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [setCurrentJob, updateQueueItem])

  // Handle videos selected from dropzone
  const handleVideosSelected = useCallback(async (files: UploadedFile[]) => {
    // Initialize queue with uploaded files
    const queueItems = files.map(file => ({
      filename: file.filename,
      path: file.path,
      size: file.size,
      status: 'pending' as const,
    }))

    setVideoQueue(queueItems)

    // Start processing the first video
    if (queueItems.length > 0) {
      await startProcessingVideo(queueItems[0].path, 0)
    }
  }, [setVideoQueue, startProcessingVideo])

  // Backward compatibility: single video selection
  const handleVideoSelected = useCallback(async (filePath: string) => {
    handleVideosSelected([{
      filename: filePath.split('/').pop() || filePath,
      path: filePath,
      size: 0,
    }])
  }, [handleVideosSelected])

  const handleProcessingComplete = useCallback((needsReview: boolean) => {
    // Mark current video as complete in the queue
    updateQueueItem(currentQueueIndex, { status: 'complete' })
    setView(needsReview ? 'review' : 'complete')
  }, [currentQueueIndex, updateQueueItem])

  const handleReviewComplete = useCallback((clips: string[]) => {
    setExportedClips(prev => [...prev, ...clips])
    setView('complete')
  }, [])

  // Move to next video in queue
  const handleNextVideo = useCallback(() => {
    const nextIndex = currentQueueIndex + 1
    if (nextIndex < videoQueue.length) {
      advanceQueue()
      setShots([])
      setExportedClips([])
      startProcessingVideo(videoQueue[nextIndex].path, nextIndex)
    }
  }, [currentQueueIndex, videoQueue, advanceQueue, setShots, startProcessingVideo])

  // Check if there are more videos in the queue
  const hasMoreVideos = currentQueueIndex < videoQueue.length - 1

  const handleReset = useCallback(() => {
    setCurrentJob(null)
    setShots([])
    setError(null)
    setExportedClips([])
    clearQueue()
    setView('home')
  }, [setCurrentJob, setShots, clearQueue])

  // Skip current video and move to next
  const handleSkipVideo = useCallback(() => {
    updateQueueItem(currentQueueIndex, { status: 'error', error: 'Skipped by user' })
    if (hasMoreVideos) {
      handleNextVideo()
    } else {
      setView('complete')
    }
  }, [currentQueueIndex, hasMoreVideos, handleNextVideo, updateQueueItem])

  return (
    <div className="app">
      <header className="app-header">
        <h1>GolfClip</h1>
        <div className="header-actions">
          {hasMultipleVideos && view !== 'home' && (
            <div className="queue-indicator">
              Video {queueStats.current} of {queueStats.total}
              {queueStats.completed > 0 && ` (${queueStats.completed} done)`}
            </div>
          )}
          {view !== 'home' && (
            <button onClick={handleReset} className="btn-secondary">
              New Video{hasMultipleVideos ? 's' : ''}
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {view === 'home' && (
          <>
            <VideoDropzone
              onVideosSelected={handleVideosSelected}
              onVideoSelected={handleVideoSelected}
            />
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
          <>
            {hasMultipleVideos && (
              <div className="queue-progress-bar">
                <div className="queue-progress-fill" style={{ width: `${((currentQueueIndex + 1) / videoQueue.length) * 100}%` }} />
              </div>
            )}
            <ProcessingView
              jobId={currentJob.job_id}
              onComplete={handleProcessingComplete}
              onCancel={handleReset}
            />
            {hasMultipleVideos && (
              <div className="queue-controls">
                <button onClick={handleSkipVideo} className="btn-secondary">
                  Skip This Video
                </button>
              </div>
            )}
          </>
        )}

        {view === 'review' && currentJob && (
          <>
            {hasMultipleVideos && (
              <div className="queue-progress-bar">
                <div className="queue-progress-fill" style={{ width: `${((currentQueueIndex + 1) / videoQueue.length) * 100}%` }} />
              </div>
            )}
            <ClipReview
              jobId={currentJob.job_id}
              videoPath={currentJob.video_info.path}
              onComplete={handleReviewComplete}
            />
          </>
        )}

        {view === 'complete' && currentJob && (
          <>
            {hasMultipleVideos && (
              <div className="queue-summary">
                <h3>Queue Progress</h3>
                <div className="queue-list">
                  {videoQueue.map((video, index) => (
                    <div
                      key={index}
                      className={`queue-item queue-item-${video.status} ${index === currentQueueIndex ? 'queue-item-current' : ''}`}
                    >
                      <span className="queue-item-icon">
                        {video.status === 'complete' && '✓'}
                        {video.status === 'error' && '✗'}
                        {video.status === 'processing' && '⏳'}
                        {video.status === 'pending' && '○'}
                      </span>
                      <span className="queue-item-name" title={video.filename}>
                        {video.filename.length > 40
                          ? video.filename.substring(0, 37) + '...'
                          : video.filename}
                      </span>
                      {video.error && (
                        <span className="queue-item-error" title={video.error}>
                          ({video.error})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ExportComplete
              jobId={currentJob.job_id}
              exportedClips={exportedClips}
              onReset={handleReset}
            />
            {hasMoreVideos && (
              <div className="next-video-prompt">
                <button onClick={handleNextVideo} className="btn-primary btn-large">
                  Process Next Video ({videoQueue.length - currentQueueIndex - 1} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App
