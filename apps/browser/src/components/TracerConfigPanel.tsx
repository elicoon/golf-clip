// Browser app TracerConfigPanel - simplified version without API dependencies
import { useCallback, useState } from 'react'
import { TracerConfig } from '../stores/processingStore'
import { TracerStyle } from '../types/tracer'

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
}

type HeightOption = 'low' | 'medium' | 'high'
type ShapeOption = 'hook' | 'draw' | 'straight' | 'fade' | 'slice'

export function TracerConfigPanel({
  config,
  onChange,
  style,
  onStyleChange,
  onGenerate,
  onMarkApex,
  onMarkOrigin,
  onMarkLanding,
  hasChanges,
  apexMarked,
  originMarked,
  landingMarked,
  isMarkingLanding,
  isGenerating,
  isCollapsed,
  onToggleCollapse,
}: TracerConfigPanelProps) {
  const [showStyleOptions, setShowStyleOptions] = useState(false)
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

  const handleFlightTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const flightTime = parseFloat(e.target.value)
      onChange({ ...config, flightTime })
    },
    [config, onChange]
  )

  // Style handlers
  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onStyleChange({ ...style, color: e.target.value })
    },
    [style, onStyleChange]
  )

  const handleLineWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onStyleChange({ ...style, lineWidth: parseInt(e.target.value, 10) })
    },
    [style, onStyleChange]
  )

  const handleGlowToggle = useCallback(() => {
    onStyleChange({ ...style, glowEnabled: !style.glowEnabled })
  }, [style, onStyleChange])

  const handleGlowColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onStyleChange({ ...style, glowColor: e.target.value })
    },
    [style, onStyleChange]
  )

  const handleGlowRadiusChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onStyleChange({ ...style, glowRadius: parseInt(e.target.value, 10) })
    },
    [style, onStyleChange]
  )

  const handleMarkerToggle = useCallback(
    (marker: 'showApexMarker' | 'showLandingMarker' | 'showOriginMarker') => {
      onStyleChange({ ...style, [marker]: !style[marker] })
    },
    [style, onStyleChange]
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
          {/* Shot Height */}
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

          {/* Shot Shape */}
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

          {/* Flight Time */}
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

          {/* Origin Point */}
          <div className="config-row">
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

          {/* Landing Point */}
          {onMarkLanding && (
            <div className="config-row">
              <label>Landing Point</label>
              <button
                type="button"
                className={`btn-option btn-landing ${landingMarked ? 'marked' : ''}`}
                onClick={onMarkLanding}
                disabled={isGenerating || isMarkingLanding}
                title={landingMarked ? 'Click to re-mark where ball landed' : 'Click to mark where ball landed on video'}
              >
                {isMarkingLanding ? 'Click on video...' : landingMarked ? 'Re-mark Landing' : 'Mark on Video'}
              </button>
            </div>
          )}

          {/* Apex Point */}
          <div className="config-row">
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

          {/* Style Options Toggle */}
          <div className="config-row">
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowStyleOptions(!showStyleOptions)}
              style={{ marginLeft: 0 }}
            >
              {showStyleOptions ? 'Hide Style Options' : 'Show Style Options'}
            </button>
          </div>

          {showStyleOptions && (
            <>
              {/* Tracer Color */}
              <div className="config-row">
                <label>Tracer Color</label>
                <div className="color-picker-group">
                  <input
                    type="color"
                    value={style.color}
                    onChange={handleColorChange}
                    disabled={isGenerating}
                    className="color-picker"
                    title="Choose tracer color"
                  />
                  <span className="color-value">{style.color}</span>
                </div>
              </div>

              {/* Line Width */}
              <div className="config-row">
                <label>Line Width</label>
                <div className="slider-group">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={style.lineWidth}
                    onChange={handleLineWidthChange}
                    disabled={isGenerating}
                    className="style-slider"
                  />
                  <span className="slider-value">{style.lineWidth}px</span>
                </div>
              </div>

              {/* Glow Toggle */}
              <div className="config-row">
                <label>Glow Effect</label>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={style.glowEnabled}
                    onChange={handleGlowToggle}
                    disabled={isGenerating}
                    className="toggle-checkbox"
                  />
                  <span className="toggle-text">{style.glowEnabled ? 'On' : 'Off'}</span>
                </label>
              </div>

              {/* Glow Settings (conditional) */}
              {style.glowEnabled && (
                <>
                  <div className="config-row config-row-indent">
                    <label>Glow Color</label>
                    <div className="color-picker-group">
                      <input
                        type="color"
                        value={style.glowColor}
                        onChange={handleGlowColorChange}
                        disabled={isGenerating}
                        className="color-picker"
                        title="Choose glow color"
                      />
                      <span className="color-value">{style.glowColor}</span>
                    </div>
                  </div>

                  <div className="config-row config-row-indent">
                    <label>Glow Radius</label>
                    <div className="slider-group">
                      <input
                        type="range"
                        min={2}
                        max={20}
                        step={1}
                        value={style.glowRadius}
                        onChange={handleGlowRadiusChange}
                        disabled={isGenerating}
                        className="style-slider"
                      />
                      <span className="slider-value">{style.glowRadius}px</span>
                    </div>
                  </div>
                </>
              )}

              {/* Marker Visibility */}
              <div className="config-row">
                <label>Show Markers</label>
                <div className="marker-toggles">
                  <label className="marker-toggle">
                    <input
                      type="checkbox"
                      checked={style.showOriginMarker}
                      onChange={() => handleMarkerToggle('showOriginMarker')}
                      disabled={isGenerating}
                    />
                    <span>Origin</span>
                  </label>
                  <label className="marker-toggle">
                    <input
                      type="checkbox"
                      checked={style.showApexMarker}
                      onChange={() => handleMarkerToggle('showApexMarker')}
                      disabled={isGenerating}
                    />
                    <span>Apex</span>
                  </label>
                  <label className="marker-toggle">
                    <input
                      type="checkbox"
                      checked={style.showLandingMarker}
                      onChange={() => handleMarkerToggle('showLandingMarker')}
                      disabled={isGenerating}
                    />
                    <span>Landing</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* Generate Button */}
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
        </div>
      )}
    </div>
  )
}
