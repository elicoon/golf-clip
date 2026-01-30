import { useState, useCallback } from 'react'
import { VideoDropzone } from './components/VideoDropzone'
import { ProcessingView } from './components/ProcessingView'
import { ClipReview } from './components/ClipReview'
import { ExportComplete } from './components/ExportComplete'
import { useAppStore } from './stores/appStore'
import { apiUrl } from './config'

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
    addVideoToQueue,
  } = useAppStore()

  const [view, setView] = useState<AppView>('home')
  const [error, setError] = useState<ApiError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [exportedClips, setExportedClips] = useState<string[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

  const queueStats = getQueueStats()
  const hasMultipleVideos = videoQueue.length > 1

  // Start processing a video from the queue
  const startProcessingVideo = useCallback(async (videoPath: string, queueIndex: number) => {
    setError(null)
    setIsSubmitting(true)

    // Update queue item status
    updateQueueItem(queueIndex, { status: 'processing' })

    try {
      const response = await fetch(apiUrl('/api/process'), {
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

  // Handle individual video uploaded (streaming upload - fires per-file)
  const handleVideoUploaded = useCallback(async (file: UploadedFile) => {
    const queueItem = {
      filename: file.filename,
      path: file.path,
      size: file.size,
      status: 'pending' as const,
    }

    // Add to queue - returns true if this is the first video
    const isFirst = addVideoToQueue(queueItem)

    // If this is the first video and we're not already processing, start
    if (isFirst && !isProcessing) {
      setIsProcessing(true)
      await startProcessingVideo(file.path, 0)
    }
  }, [addVideoToQueue, isProcessing, startProcessingVideo])

  // Handle videos selected from dropzone (backward compatibility / fallback)
  const handleVideosSelected = useCallback(async (files: UploadedFile[]) => {
    // Only start processing if we haven't already via onVideoUploaded
    if (videoQueue.length === 0 && files.length > 0) {
      const queueItems = files.map(file => ({
        filename: file.filename,
        path: file.path,
        size: file.size,
        status: 'pending' as const,
      }))
      setVideoQueue(queueItems)
      await startProcessingVideo(queueItems[0].path, 0)
    }
  }, [setVideoQueue, startProcessingVideo, videoQueue.length])

  // Backward compatibility: single video selection
  const handleVideoSelected = useCallback(async (filePath: string) => {
    handleVideosSelected([{
      filename: filePath.split('/').pop() || filePath,
      path: filePath,
      size: 0,
    }])
  }, [handleVideosSelected])

  const handleProcessingComplete = useCallback((_needsReview: boolean, totalShots: number) => {
    // Mark current video as complete in the queue
    updateQueueItem(currentQueueIndex, { status: 'complete' })

    // If there are shots to review, go to review
    // Otherwise, if there are more videos, continue processing
    // Only go to 'complete' when there's nothing to review and no more videos
    if (totalShots > 0) {
      // Always show review if there are any shots detected
      setView('review')
      setIsProcessing(false)  // Pause processing while in review
    } else if (currentQueueIndex < videoQueue.length - 1) {
      // No shots but more videos - auto-advance to next video
      const nextIndex = currentQueueIndex + 1
      advanceQueue()
      setShots([])
      startProcessingVideo(videoQueue[nextIndex].path, nextIndex)
    } else {
      // No shots and no more videos - show complete
      setIsProcessing(false)  // Done processing
      setView('complete')
    }
  }, [currentQueueIndex, videoQueue, updateQueueItem, advanceQueue, setShots, startProcessingVideo])

  const handleReviewComplete = useCallback((clips: string[]) => {
    setExportedClips(prev => [...prev, ...clips])
    setView('complete')
  }, [])

  // Move to next video in queue
  const handleNextVideo = useCallback(() => {
    const nextIndex = currentQueueIndex + 1
    if (nextIndex < videoQueue.length) {
      setIsProcessing(true)  // Resume processing
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
    setIsProcessing(false)
    setView('home')
  }, [setCurrentJob, setShots, clearQueue])

  // Skip current video and move to next
  const handleSkipVideo = useCallback(() => {
    updateQueueItem(currentQueueIndex, { status: 'error', error: 'Skipped by user' })
    if (hasMoreVideos) {
      handleNextVideo()
    } else {
      setIsProcessing(false)
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
              onVideoUploaded={handleVideoUploaded}
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
