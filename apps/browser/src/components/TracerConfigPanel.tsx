// Browser app TracerConfigPanel - simplified version without API dependencies
import { useCallback } from 'react'
import { TracerConfig } from '../stores/processingStore'
import { TracerStyle } from '../types/tracer'
import { formatTime } from './Scrubber'

interface TracerConfigPanelProps {
  config: TracerConfig
  onChange: (config: TracerConfig) => void
  style: TracerStyle
  onStyleChange: (style: TracerStyle) => void
  onGenerate: () => void
  onMarkApex: () => void
  onMarkOrigin: () => void
  onMarkLanding?: () => void
  hasChanges: boolean
  apexMarked: boolean
  originMarked: boolean
  landingMarked?: boolean
  isMarkingLanding?: boolean
  isGenerating: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  // Impact time adjustment
  onSetImpactTime?: () => void
  impactTime?: number
  impactTimeAdjusted?: boolean
  // Inline status after generate
  generateStatus?: string | null
}

type HeightOption = 'low' | 'medium' | 'high'
type ShapeOption = 'hook' | 'draw' | 'straight' | 'fade' | 'slice'

export function TracerConfigPanel({
  config,
  onChange,
  style: _style,
  onStyleChange: _onStyleChange,
  onGenerate,
  onMarkApex,
  onMarkOrigin,
  onMarkLanding,
  hasChanges: _hasChanges,
  apexMarked,
  originMarked,
  landingMarked,
  isMarkingLanding,
  isGenerating,
  isCollapsed,
  onToggleCollapse,
  onSetImpactTime,
  impactTime,
  impactTimeAdjusted,
  generateStatus,
}: TracerConfigPanelProps) {
  // Style options hidden for now — may re-enable later
  const handleHeightChange = useCallback(
    (height: HeightOption) => {
      onChange({ ...config, height })
    },
    [config, onChange],
  )

  const handleShapeChange = useCallback(
    (shape: ShapeOption) => {
      onChange({ ...config, shape })
    },
    [config, onChange],
  )

  const handleFlightTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const flightTime = parseFloat(e.target.value)
      onChange({ ...config, flightTime })
    },
    [config, onChange],
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

  return (
    <div className="tracer-config-panel">
      <div
        className="config-header"
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
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
          <div className="config-grid">
            {/* Column 1: Shot shape controls */}
            <div className="config-column">
              <div className="config-row">
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

              <div className="config-row">
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

              <div className="config-row config-row-generate">
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
                {generateStatus && <p className="generate-status">{generateStatus}</p>}
              </div>
            </div>

            {/* Column 2: Sliders and timing */}
            <div className="config-column">
              <div className="config-row">
                <label>Flight Time</label>
                <div className="slider-group">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={0.1}
                    value={config.flightTime}
                    onChange={handleFlightTimeChange}
                    disabled={isGenerating}
                    className="flight-time-slider"
                  />
                  <span className="flight-time-value">{config.flightTime.toFixed(1)}s</span>
                </div>
              </div>

              {onSetImpactTime && (
                <div className="config-row">
                  <label>Impact Time</label>
                  <button
                    type="button"
                    className={`btn-option btn-impact ${impactTimeAdjusted ? 'marked' : ''}`}
                    onClick={onSetImpactTime}
                    disabled={isGenerating}
                    title={`Current: ${formatTime(impactTime ?? 0)} - Click to set to current video position`}
                  >
                    {impactTimeAdjusted
                      ? `Adjusted: ${formatTime(impactTime ?? 0)}`
                      : 'Set to Playhead'}
                  </button>
                  <span className="optional-hint">(if auto wrong)</span>
                </div>
              )}
            </div>

            {/* Column 3: Point markers */}
            <div className="config-column">
              <div className="config-row">
                <label>Origin Point</label>
                <button
                  type="button"
                  className={`btn-option btn-origin ${originMarked ? 'marked' : ''}`}
                  onClick={onMarkOrigin}
                  disabled={isGenerating}
                  title={
                    originMarked
                      ? 'Click to re-mark where ball starts'
                      : 'Click to mark where ball starts on video'
                  }
                >
                  {originMarked ? 'Re-mark Origin' : 'Mark on Video'}
                </button>
                <span className="optional-hint">(if auto wrong)</span>
              </div>

              {onMarkLanding && (
                <div className="config-row">
                  <label>Landing Point</label>
                  <button
                    type="button"
                    className={`btn-option btn-landing ${landingMarked ? 'marked' : ''}`}
                    onClick={onMarkLanding}
                    disabled={isGenerating || isMarkingLanding}
                    title={
                      landingMarked
                        ? 'Click to re-mark where ball landed'
                        : 'Click to mark where ball landed on video'
                    }
                  >
                    {isMarkingLanding
                      ? 'Click on video...'
                      : landingMarked
                        ? 'Re-mark Landing'
                        : 'Mark on Video'}
                  </button>
                </div>
              )}

              <div className="config-row">
                <label>Apex Point</label>
                <button
                  type="button"
                  className={`btn-option btn-apex ${apexMarked ? 'marked' : ''}`}
                  onClick={onMarkApex}
                  disabled={isGenerating}
                  title={
                    apexMarked ? 'Click to re-mark apex point' : 'Click to mark apex point on video'
                  }
                >
                  {apexMarked ? 'Re-mark Apex' : 'Mark on Video'}
                </button>
                <span className="optional-hint">(optional)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
