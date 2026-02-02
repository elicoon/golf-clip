// apps/browser/src/components/VideoQueue.tsx
import { useProcessingStore, VideoState } from '../stores/processingStore'

interface VideoQueueItemProps {
  video: VideoState
  isActive: boolean
  onClick: () => void
}

function VideoQueueItem({ video, isActive, onClick }: VideoQueueItemProps) {
  const statusIcon = {
    pending: '...',
    loading: '...',
    processing: '*',
    ready: 'ok',
    error: 'x',
  }[video.status]

  const statusClass = {
    pending: 'queue-item-pending',
    loading: 'queue-item-loading',
    processing: 'queue-item-processing',
    ready: 'queue-item-ready',
    error: 'queue-item-error',
  }[video.status]

  return (
    <button
      className={`queue-item ${statusClass} ${isActive ? 'queue-item-active' : ''}`}
      onClick={onClick}
      title={video.fileName}
    >
      <span className="queue-item-icon">{statusIcon}</span>
      <span className="queue-item-name">{video.fileName}</span>
      {(video.status === 'loading' || video.status === 'processing') && (
        <span className="queue-item-progress">{video.progress}%</span>
      )}
      {video.status === 'ready' && (
        <span className="queue-item-count">{video.segments.length} shots</span>
      )}
    </button>
  )
}

export function VideoQueue() {
  const { videos, activeVideoId, setActiveVideo } = useProcessingStore()

  const videoList = Array.from(videos.values())

  if (videoList.length === 0) {
    return null
  }

  return (
    <div className="video-queue">
      <h3 className="video-queue-title">Videos ({videoList.length})</h3>
      <div className="video-queue-list">
        {videoList.map((video) => (
          <VideoQueueItem
            key={video.id}
            video={video}
            isActive={video.id === activeVideoId}
            onClick={() => setActiveVideo(video.id)}
          />
        ))}
      </div>
    </div>
  )
}
