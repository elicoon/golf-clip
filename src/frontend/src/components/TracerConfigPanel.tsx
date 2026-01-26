// src/frontend/src/components/TracerConfigPanel.tsx
import { useCallback } from 'react'

export interface TracerConfig {
  height: 'low' | 'medium' | 'high'
  shape: 'hook' | 'draw' | 'straight' | 'fade' | 'slice'
  startingLine: 'left' | 'center' | 'right'
  flightTime: number
}

interface TracerConfigPanelProps {
  config: TracerConfig
  onChange: (config: TracerConfig) => void
  onGenerate: () => void
  onMarkApex: () => void
  onMarkOrigin: () => void
  hasChanges: boolean
  apexMarked: boolean
  originMarked: boolean
  isGenerating: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  // Feedback-related props for inline UI
  feedbackMessage?: string
  triedInputs?: Set<string>
  showFallbackActions?: boolean
  onAcceptAnyway?: () => void
  onSkipShot?: () => void
  onAcceptNoTracer?: () => void
}

type HeightOption = 'low' | 'medium' | 'high'
type ShapeOption = 'hook' | 'draw' | 'straight' | 'fade' | 'slice'
type LineOption = 'left' | 'center' | 'right'

export function TracerConfigPanel({
  config,
  onChange,
  onGenerate,
  onMarkApex,
  onMarkOrigin,
  hasChanges,
  apexMarked,
  originMarked,
  isGenerating,
  isCollapsed,
  onToggleCollapse,
  feedbackMessage,
  triedInputs,
  showFallbackActions,
  onAcceptAnyway,
  onSkipShot,
  onAcceptNoTracer,
}: TracerConfigPanelProps) {
  // Helper to check if an option has been tried
  const isUntried = (option: string) => triedInputs && !triedInputs.has(option)

  const handleHeightChange = useCallback(
    (height: HeightOption) => {
      onChange({ ...config, height })
    },
    [config, onChange]
  )

  const handleShapeChange = useCallback(
    (shape: ShapeOption) => {
      onChange({ ...config, shape })
    },
    [config, onChange]
  )

  const handleLineChange = useCallback(
    (startingLine: LineOption) => {
      onChange({ ...config, startingLine })
    },
    [config, onChange]
  )

  const handleFlightTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const flightTime = parseFloat(e.target.value)
      onChange({ ...config, flightTime })
    },
    [config, onChange]
  )

  const heightOptions: { value: HeightOption; label: string }[] = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ]

  const shapeOptions: { value: ShapeOption; label: string }[] = [
    { value: 'hook', label: 'Hook' },
    { value: 'draw', label: 'Draw' },
    { value: 'straight', label: 'Straight' },
    { value: 'fade', label: 'Fade' },
    { value: 'slice', label: 'Slice' },
  ]

  const lineOptions: { value: LineOption; label: string }[] = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ]

  return (
    <div className="tracer-config-panel">
      <div
        className="config-header"
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleCollapse()
          }
        }}
      >
        <span className="config-header-title">
          {isCollapsed ? 'Adjust Trajectory' : 'Trajectory Settings'}
        </span>
        <span className="config-header-icon">{isCollapsed ? '+' : '-'}</span>
      </div>

      {!isCollapsed && (
        <div className="config-body">
          {/* Feedback message banner */}
          {feedbackMessage && (
            <div className="config-feedback-message">
              {feedbackMessage}
            </div>
          )}

          {/* Shot Height */}
          <div className={`config-row ${isUntried('height') ? 'untried' : ''}`}>
            <label>Shot Height</label>
            <div className="button-group">
              {heightOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`btn-option ${config.height === opt.value ? 'active' : ''}`}
                  onClick={() => handleHeightChange(opt.value)}
                  disabled={isGenerating}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Shot Shape */}
          <div className={`config-row ${isUntried('shape') ? 'untried' : ''}`}>
            <label>Shot Shape</label>
            <div className="button-group">
              {shapeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`btn-option ${config.shape === opt.value ? 'active' : ''}`}
                  onClick={() => handleShapeChange(opt.value)}
                  disabled={isGenerating}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Starting Line */}
          <div className={`config-row ${isUntried('startingLine') ? 'untried' : ''}`}>
            <label>Starting Line</label>
            <div className="button-group">
              {lineOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`btn-option ${config.startingLine === opt.value ? 'active' : ''}`}
                  onClick={() => handleLineChange(opt.value)}
                  disabled={isGenerating}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Flight Time */}
          <div className={`config-row ${isUntried('flightTime') ? 'untried' : ''}`}>
            <label>Flight Time</label>
            <div className="slider-group">
              <input
                type="range"
                min="1.0"
                max="6.0"
                step="0.1"
                value={config.flightTime}
                onChange={handleFlightTimeChange}
                disabled={isGenerating}
                className="flight-time-slider"
              />
              <span className="flight-time-value">{config.flightTime.toFixed(1)}s</span>
            </div>
          </div>

          {/* Origin Point (if auto-detected is wrong) */}
          <div className={`config-row ${isUntried('origin') ? 'untried' : ''}`}>
            <label>Origin Point</label>
            <button
              type="button"
              className={`btn-option btn-origin ${originMarked ? 'marked' : ''}`}
              onClick={onMarkOrigin}
              disabled={isGenerating}
              title={originMarked ? 'Click to re-mark where ball starts' : 'Click to mark where ball starts on video'}
            >
              {originMarked ? 'Re-mark Origin' : 'Mark on Video'}
            </button>
            <span className="optional-hint">(if auto wrong)</span>
          </div>

          {/* Apex Point (Optional) */}
          <div className={`config-row ${isUntried('apex') ? 'untried' : ''}`}>
            <label>Apex Point</label>
            <button
              type="button"
              className={`btn-option btn-apex ${apexMarked ? 'marked' : ''}`}
              onClick={onMarkApex}
              disabled={isGenerating}
              title={apexMarked ? 'Click to re-mark apex point' : 'Click to mark apex point on video'}
            >
              {apexMarked ? 'Re-mark Apex' : 'Mark on Video'}
            </button>
            <span className="optional-hint">(optional)</span>
          </div>

          {/* Generate Button & Hint */}
          <div className="config-actions">
            {hasChanges && (
              <p className="config-hint">Click Generate to see updated tracer</p>
            )}
            <button
              type="button"
              className="btn-primary btn-generate"
              onClick={onGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <span className="spinner" />
                  Generating...
                </>
              ) : (
                'Generate'
              )}
            </button>
          </div>

          {/* Fallback actions when user can't get tracer right */}
          {showFallbackActions && (
            <div className="config-fallback-actions">
              <p className="fallback-message">Still not right? You can:</p>
              <div className="fallback-buttons">
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={onAcceptAnyway}
                  disabled={isGenerating}
                >
                  Accept Anyway
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={onSkipShot}
                  disabled={isGenerating}
                >
                  Skip Shot
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={onAcceptNoTracer}
                  disabled={isGenerating}
                >
                  No Tracer
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
