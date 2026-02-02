// apps/browser/src/components/ReviewActions.tsx
// Header component that uses handlers registered by ClipReview

import { useReviewActionsStore } from '../stores/reviewActionsStore'

export function ReviewActions() {
  const { handleApprove, handleReject, currentIndex, totalShots } = useReviewActionsStore()

  // Don't render if handlers aren't registered (ClipReview not mounted or no current shot)
  if (!handleApprove || !handleReject) {
    return null
  }

  return (
    <>
      <div className="review-header-info">
        <span className="review-title">Review Shots</span>
        <span className="review-progress">{currentIndex + 1} of {totalShots}</span>
      </div>
      <div className="review-actions">
        <button onClick={handleReject} className="btn-no-shot">
          ✕ No Golf Shot
        </button>
        <button onClick={handleApprove} className="btn-primary btn-large">
          ✓ Approve Shot
        </button>
      </div>
    </>
  )
}
