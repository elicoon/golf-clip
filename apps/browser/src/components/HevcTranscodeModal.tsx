import { formatRemainingTime, SUPPORTED_CODECS } from '../lib/ffmpeg-client'

export interface HevcTranscodeModalState {
  show: boolean
  segmentIndex: number
  segmentBlob: Blob | null
  estimatedTime: string
  isTranscoding: boolean
  transcodeProgress: number
  transcodeStartTime: number | null
  /** Track segments that have already been transcoded to prevent recursive loops */
  transcodedSegmentIds?: Set<string>
}

export const initialHevcTranscodeModalState: HevcTranscodeModalState = {
  show: false,
  segmentIndex: 0,
  segmentBlob: null,
  estimatedTime: '',
  isTranscoding: false,
  transcodeProgress: 0,
  transcodeStartTime: null,
  transcodedSegmentIds: new Set(),
}

/** File info displayed in the modal (for VideoDropzone context) */
export interface HevcFileInfo {
  codec: string
  fileSizeMB: number
}

interface HevcTranscodeModalProps {
  state: HevcTranscodeModalState
  onStartTranscode: () => void
  onCancel: () => void
  /** Optional title override for different contexts */
  title?: string
  /** Optional description override */
  description?: string
  /** Optional file info section (shown in VideoDropzone context) */
  fileInfo?: HevcFileInfo
  /** Show iPhone tip section (for VideoDropzone context) */
  showTip?: boolean
  /** Label for the cancel button when not transcoding (default: "Cancel Export") */
  cancelLabel?: string
  /** Label for the start button (default: "Start Conversion") */
  startLabel?: string
}

/**
 * Modal shown when HEVC video is detected during export.
 * Offers the user the option to transcode to H.264 or cancel.
 */
export function HevcTranscodeModal({
  state,
  onStartTranscode,
  onCancel,
  title = 'Video Needs Conversion',
  description = 'This clip uses HEVC encoding, which cannot be processed for tracer export. The video needs to be converted to H.264 format first.',
  fileInfo,
  showTip = false,
  cancelLabel = 'Cancel Export',
  startLabel = 'Start Conversion',
}: HevcTranscodeModalProps) {
  if (!state.show) return null

  return (
    <div className="hevc-modal-overlay">
      <div className="hevc-modal">
        <div className="hevc-modal-header">
          <span className="hevc-warning-icon">&#9888;</span>
          <h3>{title}</h3>
        </div>

        <div className="hevc-modal-content">
          {!state.isTranscoding ? (
            <>
              {/* File info section (shown in VideoDropzone context) */}
              {fileInfo && (
                <div className="hevc-file-info">
                  <p>
                    <strong>Detected:</strong> {fileInfo.codec} encoding ({fileInfo.fileSizeMB} MB)
                  </p>
                  <p>
                    <strong>Supported:</strong> {SUPPORTED_CODECS.join(', ')}
                  </p>
                </div>
              )}

              <p>{description}</p>

              <div className="hevc-time-estimate">
                <p>
                  Estimated conversion time: <strong>{state.estimatedTime}</strong>
                </p>
                <p className="hevc-modal-hint">
                  Processing happens in your browser and may be slower on older devices.
                </p>
              </div>

              {/* iPhone tip section (shown in VideoDropzone context) */}
              {showTip && (
                <div className="hevc-tip">
                  <h4>Tip: Re-export from iPhone for faster results</h4>
                  <ol>
                    <li>Open the video in Photos app</li>
                    <li>Tap Share &rarr; "Save to Files"</li>
                    <li>Choose "More Compatible" format</li>
                  </ol>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="hevc-progress-container">
                <p className="hevc-progress-status">
                  {state.transcodeProgress < 100 ? 'Converting video...' : 'Finalizing...'}
                </p>
                <div className="hevc-progress-bar">
                  <div
                    className="hevc-progress-fill"
                    style={{ width: `${state.transcodeProgress}%` }}
                  />
                </div>
                <div className="hevc-progress-info">
                  <span>{state.transcodeProgress}%</span>
                  <span>
                    {state.transcodeStartTime &&
                      formatRemainingTime(
                        state.transcodeProgress,
                        Date.now() - state.transcodeStartTime
                      )
                    }
                  </span>
                </div>
                <p className="hevc-modal-hint" style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                  Note: Cancellation will stop after the current operation completes.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="hevc-modal-footer">
          {!state.isTranscoding ? (
            <>
              <button onClick={onCancel} className="btn-secondary">
                {cancelLabel}
              </button>
              <button onClick={onStartTranscode} className="btn-primary">
                {startLabel}
              </button>
            </>
          ) : (
            <button onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
