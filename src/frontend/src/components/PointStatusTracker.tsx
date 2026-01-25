// src/frontend/src/components/PointStatusTracker.tsx
import { useCallback } from 'react'

interface PointStatusTrackerProps {
  targetPoint: { x: number; y: number } | null
  landingPoint: { x: number; y: number } | null
  apexPoint: { x: number; y: number } | null
  markingStep: 'target' | 'landing' | 'apex' | 'configure'
  onClearPoint: (point: 'target' | 'landing' | 'apex') => void
}

type StatusState = 'active' | 'complete' | 'pending' | 'optional' | 'ready'

export function PointStatusTracker({
  targetPoint,
  landingPoint,
  apexPoint,
  markingStep,
  onClearPoint,
}: PointStatusTrackerProps) {
  const getStatus = useCallback(
    (
      point: { x: number; y: number } | null,
      step: string,
      isOptional: boolean = false
    ): StatusState => {
      if (point) return 'complete'
      if (markingStep === step) return 'active'
      if (isOptional) return 'optional'
      return 'pending'
    },
    [markingStep]
  )

  const targetStatus = getStatus(targetPoint, 'target')
  const landingStatus = getStatus(landingPoint, 'landing')
  const apexStatus = getStatus(apexPoint, 'apex', true)
  const configStatus: StatusState =
    markingStep === 'configure'
      ? 'active'
      : targetPoint && landingPoint
      ? 'ready'
      : 'pending'

  return (
    <div className="point-status-tracker">
      <StatusItem
        label="Target"
        status={targetStatus}
        icon="⊕"
        point={targetPoint}
        onClear={() => onClearPoint('target')}
      />

      <StatusConnector complete={!!targetPoint} />

      <StatusItem
        label="Landing"
        status={landingStatus}
        icon="↓"
        point={landingPoint}
        onClear={() => onClearPoint('landing')}
      />

      <StatusConnector complete={!!landingPoint} />

      <StatusItem
        label="Apex"
        status={apexStatus}
        icon="◇"
        point={apexPoint}
        isOptional
        onClear={() => onClearPoint('apex')}
      />

      <StatusConnector complete={!!landingPoint} />

      <StatusItem label="Generate" status={configStatus} icon="▶" isAction />
    </div>
  )
}

interface StatusItemProps {
  label: string
  status: StatusState
  icon: string
  point?: { x: number; y: number } | null
  isOptional?: boolean
  isAction?: boolean
  onClear?: () => void
}

function StatusItem({
  label,
  status,
  icon,
  point,
  isOptional,
  isAction,
  onClear,
}: StatusItemProps) {
  return (
    <div className={`status-item status-${status}`}>
      <div className="status-icon">{status === 'complete' ? '✓' : icon}</div>
      <div className="status-label">
        {label}
        {isOptional && <span className="optional-tag">optional</span>}
      </div>
      {point && onClear && !isAction && (
        <button
          className="status-clear"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          title={`Clear ${label.toLowerCase()}`}
        >
          ×
        </button>
      )}
    </div>
  )
}

function StatusConnector({ complete }: { complete: boolean }) {
  return (
    <div className={`status-connector ${complete ? 'complete' : ''}`}>
      <div className="connector-line" />
    </div>
  )
}
