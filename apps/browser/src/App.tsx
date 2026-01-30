// apps/browser/src/App.tsx
import { VideoDropzone } from './components/VideoDropzone'
import { useProcessingStore } from './stores/processingStore'

export default function App() {
  const { status, strikes, segments, error } = useProcessingStore()

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
      <h1>GolfClip Browser</h1>

      {error && (
        <div style={{ color: 'red', padding: '1rem', backgroundColor: '#fee' }}>
          Error: {error}
        </div>
      )}

      {(status === 'idle' || status === 'loading' || status === 'processing') && (
        <VideoDropzone />
      )}

      {status === 'ready' && (
        <div>
          <div style={{ marginBottom: '1rem' }}>
            <button
              onClick={() => useProcessingStore.getState().reset()}
              style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
            >
              Process Another Video
            </button>
          </div>
          <h2>Found {strikes.length} shots</h2>
          {segments.map((segment, i) => (
            <div key={segment.id} style={{ marginBottom: '2rem' }}>
              <h3>Shot {i + 1} at {strikes[i].timestamp.toFixed(1)}s</h3>
              <video
                src={segment.objectUrl}
                controls
                style={{ maxWidth: '100%' }}
              />
              <p>Confidence: {(strikes[i].confidence * 100).toFixed(0)}%</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
