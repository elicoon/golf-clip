import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Simple confirmation dialog modal.
 * Cancel button is focused by default to prevent accidental confirmations.
 */
export function ConfirmDialog({
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus Cancel button on mount so Enter = cancel (safe default)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // Handle Escape inside dialog = cancel (close the dialog, don't propagate)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onCancel()
      }
    }
    // Use capture to intercept before ClipReview's handler
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onCancel])

  return (
    <div className="confirm-dialog-overlay" data-testid="confirm-dialog" role="dialog" aria-modal="true">
      <div className="confirm-dialog">
        <p className="confirm-dialog-message" id="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="btn-secondary"
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="btn-danger"
            data-testid="confirm-dialog-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
