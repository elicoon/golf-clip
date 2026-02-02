// apps/browser/src/stores/reviewActionsStore.ts
// Store for sharing review action handlers and progress between ClipReview and header

import { create } from 'zustand'

interface ReviewActionsState {
  // Handlers registered by ClipReview
  handleApprove: (() => void) | null
  handleReject: (() => void) | null

  // Progress info for header display
  currentIndex: number
  totalShots: number

  // Actions to register/unregister handlers
  setHandlers: (approve: () => void, reject: () => void) => void
  setProgress: (current: number, total: number) => void
  clearHandlers: () => void
}

export const useReviewActionsStore = create<ReviewActionsState>((set) => ({
  handleApprove: null,
  handleReject: null,
  currentIndex: 0,
  totalShots: 0,

  setHandlers: (approve, reject) => set({
    handleApprove: approve,
    handleReject: reject,
  }),

  setProgress: (current, total) => set({
    currentIndex: current,
    totalShots: total,
  }),

  clearHandlers: () => set({
    handleApprove: null,
    handleReject: null,
    currentIndex: 0,
    totalShots: 0,
  }),
}))
