// apps/browser/src/App.tsx
import { VideoDropzone } from './components/VideoDropzone'
import { useProcessingStore } from './stores/processingStore'

export default function App() {
  const { status, strikes, segments, error, reset } = useProcessingStore()

  return (
    <div className="app">
      <header className="app-header">
        <h1>GolfClip</h1>
        <div className="header-actions">
          {status === 'ready' && (
            <button onClick={reset} className="btn-secondary">
              New Video
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="app-error">
            <h3>Error</h3>
            <p>{error}</p>
            <button onClick={reset} className="btn-secondary">
              Try Again
            </button>
          </div>
        )}

        {(status === 'idle' || status === 'loading' || status === 'processing') && !error && (
          <VideoDropzone />
        )}

        {status === 'ready' && (
          <div className="results-container">
            <div className="results-header">
              <h2>Found {strikes.length} shot{strikes.length !== 1 ? 's' : ''}</h2>
              <p className="results-subtitle">Click to play each detected shot</p>
            </div>

            <div className="shots-grid">
              {segments.map((segment, i) => (
                <div key={segment.id} className="shot-card">
                  <div className="shot-header">
                    <span className="shot-number">Shot {i + 1}</span>
                    <span className="shot-time">{strikes[i].timestamp.toFixed(1)}s</span>
                  </div>
                  <video
                    src={segment.objectUrl}
                    controls
                    className="shot-video"
                  />
                  <div className="shot-footer">
                    <span className="confidence-badge">
                      {(strikes[i].confidence * 100).toFixed(0)}% confidence
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {strikes.length === 0 && (
              <div className="no-shots">
                <p>No golf shots detected in this video.</p>
                <button onClick={reset} className="btn-primary">
                  Try Another Video
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
