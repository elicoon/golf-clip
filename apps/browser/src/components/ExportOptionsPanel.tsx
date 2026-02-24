import { useState, useEffect } from 'react'
import {
  detectGpuCapabilities,
  getExportOptions,
  GpuCapabilities,
  ExportOption,
  ExportMethod,
} from '../lib/gpu-detection'
import { ExportResolution } from '../lib/video-frame-pipeline-v4'
import './ExportOptionsPanel.css'

interface ExportOptionsPanelProps {
  onExport: (method: ExportMethod) => void
  exportResolution: ExportResolution
  onResolutionChange: (resolution: ExportResolution) => void
}

export function ExportOptionsPanel({
  onExport,
  exportResolution,
  onResolutionChange,
}: ExportOptionsPanelProps) {
  const [capabilities, setCapabilities] = useState<GpuCapabilities | null>(null)
  const [options, setOptions] = useState<ExportOption[]>([])
  const [selectedMethod, setSelectedMethod] = useState<ExportMethod | null>(null)

  useEffect(() => {
    detectGpuCapabilities().then((caps) => {
      setCapabilities(caps)
      const opts = getExportOptions(caps)
      setOptions(opts)
      // Auto-select recommended option
      const recommended = opts.find((o) => o.recommended && o.available)
      if (recommended) {
        setSelectedMethod(recommended.id)
      }
    })
  }, [])

  const handleExport = () => {
    if (selectedMethod) {
      onExport(selectedMethod)
    }
  }

  if (!capabilities) {
    return (
      <div className="export-options-panel">
        <div className="export-options-loading">Checking system capabilities...</div>
      </div>
    )
  }

  const hasIssue = !capabilities.hardwareAccelerationEnabled

  return (
    <div className="export-options-panel">
      <h3>Export Method</h3>

      {hasIssue && (
        <div className="export-options-warning">
          Hardware acceleration is disabled in your browser. Browser export may produce lower
          quality (30fps) results.
        </div>
      )}

      <div className="export-options-grid">
        {options.map((option) => (
          <div
            key={option.id}
            className={`export-option-card ${selectedMethod === option.id ? 'selected' : ''} ${!option.available ? 'disabled' : ''}`}
            onClick={() => option.available && setSelectedMethod(option.id)}
          >
            <div className="export-option-header">
              <span className="export-option-name">{option.name}</span>
              {option.recommended && option.available && (
                <span className="export-option-badge recommended">Recommended</span>
              )}
              {!option.available && (
                <span className="export-option-badge unavailable">Unavailable</span>
              )}
            </div>
            <ul className="export-option-description">
              {option.description.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
              {!option.available && option.unavailableReason && (
                <li className="unavailable-reason">{option.unavailableReason}</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="export-options-actions">
        <select
          value={exportResolution}
          onChange={(e) => onResolutionChange(e.target.value as ExportResolution)}
          className="export-resolution-select"
        >
          <option value="original">Original resolution</option>
          <option value="1080p">1080p (faster)</option>
          <option value="720p">720p (fastest)</option>
        </select>
        <button className="btn-primary btn-large" onClick={handleExport} disabled={!selectedMethod}>
          Export
        </button>
      </div>

      <details className="export-options-details">
        <summary>System details</summary>
        <div className="detail-content">
          <div className="detail-row">
            <span className="detail-label">WebGL:</span>
            <span className="detail-value">
              {capabilities.webglAvailable ? 'Available' : 'Not available'}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">GPU:</span>
            <span className="detail-value">{capabilities.renderer || 'Unknown'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Hardware Acceleration:</span>
            <span
              className={`detail-value ${capabilities.hardwareAccelerationEnabled ? 'status-good' : 'status-bad'}`}
            >
              {capabilities.hardwareAccelerationEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          {capabilities.isSoftwareRenderer && (
            <div className="detail-row">
              <span className="detail-label">Note:</span>
              <span className="detail-value status-bad">Software renderer detected</span>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
