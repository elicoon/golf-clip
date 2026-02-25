/**
 * ClipReview Layout Tests
 *
 * Tests for the layout fix from bug-clipreview-redundant-nav-buttons.md
 *
 * Bug was:
 * - "No Golf Shot / Approve Shot" buttons were below the video instead of above
 * - Previous/Next buttons were showing (redundant)
 *
 * Fix (now committed):
 * - Buttons moved above video (after Scrubber, before video-container)
 * - Previous/Next buttons removed from visible UI (keyboard shortcuts remain)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { createMockSegment } from '../test/video-test-utils'
import { ClipReview } from './ClipReview'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Mock ResizeObserver for jsdom
class MockResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

// Mock HTMLCanvasElement getContext for jsdom
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn().mockReturnValue({ data: [] }),
  putImageData: vi.fn(),
  createImageData: vi.fn().mockReturnValue([]),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  fillText: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 0 }),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  scale: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  canvas: { width: 800, height: 600 },
}) as unknown as typeof HTMLCanvasElement.prototype.getContext

// Mock the processing store
const mockUpdateSegment = vi.fn()
const mockApproveSegment = vi.fn()
const mockRejectSegment = vi.fn()
const mockUseProcessingStore = vi.fn()
vi.mock('../stores/processingStore', () => ({
  useProcessingStore: Object.assign((...args: unknown[]) => mockUseProcessingStore(...args), {
    getState: () => mockUseProcessingStore(),
  }),
}))

// Mock feedback service
vi.mock('../lib/feedback-service', () => ({
  submitShotFeedback: vi.fn(),
  submitTracerFeedback: vi.fn(),
}))

// Mock video-frame-pipeline-v4
vi.mock('../lib/video-frame-pipeline-v4', () => ({
  VideoFramePipelineV4: vi.fn().mockImplementation(() => ({
    exportWithTracer: vi.fn().mockResolvedValue(new Blob(['mock'], { type: 'video/mp4' })),
  })),
  isVideoFrameCallbackSupported: vi.fn().mockReturnValue(true),
  ExportTimeoutError: class ExportTimeoutError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ExportTimeoutError'
    }
  },
}))

// Mock trajectory generator
vi.mock('../lib/trajectory-generator', () => ({
  generateTrajectory: vi.fn(() => ({
    points: [],
    animationStart: 0,
    animationEnd: 3,
  })),
}))

/**
 * Helper to create multiple mock segments for navigation tests
 */
function createMultipleMockSegments(count: number) {
  return Array.from({ length: count }, (_, i) =>
    createMockSegment({
      id: `shot-${i + 1}`,
      confidence: 0.5, // Below 0.7 threshold, needs review
      approved: 'pending',
      objectUrl: `blob:http://localhost/mock-video-${i + 1}`,
    }),
  )
}

describe('ClipReview Layout - Button Positioning Bug Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Setup mock store with segments needing review
    mockUseProcessingStore.mockReturnValue({
      segments: [
        createMockSegment({
          id: 'shot-1',
          confidence: 0.5, // Below 0.7 threshold, needs review
          approved: 'pending',
          objectUrl: 'blob:http://localhost/mock-video-1',
        }),
      ],
      updateSegment: mockUpdateSegment,
      approveSegment: mockApproveSegment,
      rejectSegment: mockRejectSegment,
    })
  })

  afterEach(() => {
    cleanup()
  })

  describe('Review Action Buttons Position', () => {
    it('should render review-actions div AFTER scrubber in the DOM', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const clipReview = document.querySelector('.clip-review')
      const reviewActions = document.querySelector('.review-actions')

      expect(clipReview).not.toBeNull()
      expect(reviewActions).not.toBeNull()

      // Get all children of clip-review to check order
      const children = Array.from(clipReview!.children)
      const reviewActionsIndex = children.findIndex((el) => el.classList.contains('review-actions'))
      const scrubberIndex = children.findIndex(
        (el) => el.classList.contains('scrubber') || el.classList.contains('scrubber-container'),
      )

      // review-actions should come AFTER scrubber (below timeline)
      expect(reviewActionsIndex).toBeGreaterThanOrEqual(0)
      expect(scrubberIndex).toBeGreaterThanOrEqual(0)
      expect(reviewActionsIndex).toBeGreaterThan(scrubberIndex)
    })

    it('should position video-container before scrubber, review-actions after scrubber', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const clipReview = document.querySelector('.clip-review')
      expect(clipReview).not.toBeNull()

      const children = Array.from(clipReview!.children)

      const scrubberIndex = children.findIndex(
        (el) => el.classList.contains('scrubber') || el.classList.contains('scrubber-container'),
      )
      const reviewActionsIndex = children.findIndex((el) => el.classList.contains('review-actions'))
      const videoContainerIndex = children.findIndex((el) =>
        el.classList.contains('video-container'),
      )
      const transportIndex = children.findIndex((el) =>
        el.className.includes('video-transport-controls'),
      )

      // Expected order: video-container -> transport -> scrubber -> review-actions
      expect(videoContainerIndex).toBeLessThan(transportIndex)
      expect(transportIndex).toBeLessThan(scrubberIndex)
      expect(scrubberIndex).toBeLessThan(reviewActionsIndex)
    })

    it('should have review-actions present in the DOM', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const reviewActions = document.querySelector('.review-actions')
      expect(reviewActions).not.toBeNull()
    })

    it('should have both "No Golf Shot" and "Approve Shot" buttons in review-actions', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const reviewActions = document.querySelector('.review-actions')
      expect(reviewActions).not.toBeNull()

      // Check buttons are inside review-actions
      const noGolfShotButton = screen.getByRole('button', { name: /no golf shot/i })
      const approveButton = screen.getByRole('button', { name: /approve/i })

      expect(reviewActions!.contains(noGolfShotButton)).toBe(true)
      expect(reviewActions!.contains(approveButton)).toBe(true)
    })
  })

  describe('No Previous/Next Buttons in Visible UI', () => {
    it('should NOT have any "Previous" button in the visible UI', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Query for buttons with "Previous" text - should find none
      const previousButtons = screen.queryAllByRole('button', { name: /previous/i })
      expect(previousButtons).toHaveLength(0)
    })

    it('should NOT have any "Next" button in the visible UI', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Query for buttons with "Next" text - should find none
      const nextButtons = screen.queryAllByRole('button', { name: /next/i })
      expect(nextButtons).toHaveLength(0)
    })

    it('should NOT have a playback-controls div with shot navigation', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // The old playback-controls div had Previous/Next buttons
      // It should not exist at all now
      const playbackControls = document.querySelector('.playback-controls')
      expect(playbackControls).toBeNull()
    })

    it('should have video-transport-controls but NOT with Previous/Next shot buttons', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const transportControls = document.querySelector('.video-transport-controls')
      expect(transportControls).not.toBeNull()

      // Transport controls should have playback buttons (play/pause, frame step)
      // but NOT Previous/Next shot buttons
      if (transportControls) {
        const buttonTexts = Array.from(transportControls.querySelectorAll('button')).map(
          (b) => b.textContent?.toLowerCase() || '',
        )

        // Should NOT contain "previous" or "next"
        expect(buttonTexts.some((t) => t.includes('previous'))).toBe(false)
        expect(buttonTexts.some((t) => t.includes('next'))).toBe(false)
      }
    })

    it('should verify no "Prev" or "Next" text exists in any button', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Check ALL buttons in the component
      const allButtons = screen.getAllByRole('button')
      const buttonTexts = allButtons.map((b) => b.textContent?.toLowerCase() || '')

      // None should contain "prev", "previous", or "next"
      for (const text of buttonTexts) {
        expect(text).not.toContain('prev')
        expect(text).not.toContain('next')
      }
    })
  })

  describe('Keyboard Shortcuts for Navigation Still Work', () => {
    beforeEach(() => {
      // Setup mock store with multiple segments for navigation
      mockUseProcessingStore.mockReturnValue({
        segments: createMultipleMockSegments(3),
        updateSegment: mockUpdateSegment,
        approveSegment: mockApproveSegment,
        rejectSegment: mockRejectSegment,
      })
    })

    it('should show keyboard hints including ArrowUp/ArrowDown for navigation', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Look for keyboard hints section
      const keyboardHints = document.querySelector('.keyboard-hints')
      expect(keyboardHints).not.toBeNull()

      if (keyboardHints) {
        const hintsText = keyboardHints.textContent || ''
        // Should mention arrow keys for prev/next shot navigation
        expect(hintsText).toContain('Prev/Next shot')
      }
    })

    it('should navigate to previous shot on ArrowUp key press', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Initially on shot 1 of 3
      expect(screen.getByText('1 of 3')).toBeInTheDocument()

      // Navigate to shot 2 first (using ArrowDown)
      fireEvent.keyDown(window, { key: 'ArrowDown' })

      // Now we should be on shot 2
      expect(screen.getByText('2 of 3')).toBeInTheDocument()

      // Navigate back to shot 1 using ArrowUp
      fireEvent.keyDown(window, { key: 'ArrowUp' })

      // Should be back on shot 1
      expect(screen.getByText('1 of 3')).toBeInTheDocument()
    })

    it('should navigate to next shot on ArrowDown key press', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Initially on shot 1 of 3
      expect(screen.getByText('1 of 3')).toBeInTheDocument()

      // Navigate forward using ArrowDown
      fireEvent.keyDown(window, { key: 'ArrowDown' })

      // Should now be on shot 2
      expect(screen.getByText('2 of 3')).toBeInTheDocument()
    })

    it('should not navigate past first shot on ArrowUp', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Initially on shot 1 of 3
      expect(screen.getByText('1 of 3')).toBeInTheDocument()

      // Try to go backwards from first shot
      fireEvent.keyDown(window, { key: 'ArrowUp' })

      // Should still be on shot 1
      expect(screen.getByText('1 of 3')).toBeInTheDocument()
    })

    it('should not navigate past last shot on ArrowDown', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Navigate to last shot
      fireEvent.keyDown(window, { key: 'ArrowDown' }) // Shot 2
      fireEvent.keyDown(window, { key: 'ArrowDown' }) // Shot 3

      expect(screen.getByText('3 of 3')).toBeInTheDocument()

      // Try to go forward from last shot
      fireEvent.keyDown(window, { key: 'ArrowDown' })

      // Should still be on shot 3
      expect(screen.getByText('3 of 3')).toBeInTheDocument()
    })
  })

  describe('Button Functionality Still Works', () => {
    it('should NOT call approveSegment when Approve Shot button is clicked before landing is marked', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Approve button should be disabled in marking_landing state
      const approveButton = screen.getByRole('button', { name: /approve/i })
      expect(approveButton).toBeDisabled()
      fireEvent.click(approveButton)

      // Should NOT approve — user hasn't marked landing yet
      expect(mockApproveSegment).not.toHaveBeenCalled()
    })

    it('should reject immediately when No Golf Shot button is clicked', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const rejectButton = screen.getByRole('button', { name: /no golf shot/i })
      fireEvent.click(rejectButton)

      expect(mockRejectSegment).toHaveBeenCalledWith('shot-1')
    })

    it('should reject immediately on Escape key', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(mockRejectSegment).toHaveBeenCalledWith('shot-1')
    })

    it('should NOT approve on Enter key when in marking_landing step', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Press Enter before marking landing — should NOT approve
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(mockApproveSegment).not.toHaveBeenCalled()
    })
  })

  describe('Landing Mark Enforcement', () => {
    it('should have Approve button disabled when landing has not been marked', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const approveButton = screen.getByRole('button', { name: /approve/i })
      expect(approveButton).toBeDisabled()
    })

    it('should have "No Golf Shot" button always enabled regardless of review step', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const rejectButton = screen.getByRole('button', { name: /no golf shot/i })
      expect(rejectButton).not.toBeDisabled()
    })

    it('should enable Approve button after landing is marked and trajectory generated', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Initially disabled
      const approveButton = screen.getByRole('button', { name: /approve/i })
      expect(approveButton).toBeDisabled()

      // Simulate clicking on the video to mark landing (triggers canvas click handler)
      // The TrajectoryEditor canvas overlays the video, so we find it and fire click
      const canvas = document.querySelector('canvas')
      expect(canvas).not.toBeNull()
      // Simulate a click at (0.5, 0.5) on canvas — triggers handleCanvasClick
      const rect = { left: 0, top: 0, width: 800, height: 600 }
      Object.defineProperty(canvas!, 'getBoundingClientRect', { value: () => rect })
      fireEvent.click(canvas!, { clientX: 400, clientY: 300 })

      // After marking landing, reviewStep transitions to 'reviewing' and button should be enabled
      const updatedApproveButton = screen.getByRole('button', { name: /approve/i })
      expect(updatedApproveButton).not.toBeDisabled()
    })
  })

  describe('Layout Structure Verification', () => {
    it('should have correct DOM structure order', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const clipReview = document.querySelector('.clip-review')
      expect(clipReview).not.toBeNull()

      const children = Array.from(clipReview!.children)
      const classNames = children.map((el) => el.className)

      // Expected structure (in order):
      // 1. review-header
      // 2. marking-instruction
      // 3. video-container
      // 4. video-transport-controls (BELOW video)
      // 5. scrubber-container (Scrubber component, BELOW video)
      // 6. review-actions (BELOW scrubber)
      // ... other elements below

      const headerIndex = classNames.findIndex((c) => c.includes('review-header'))
      const reviewActionsIndex = classNames.findIndex((c) => c.includes('review-actions'))
      const videoContainerIndex = classNames.findIndex((c) => c.includes('video-container'))
      const transportIndex = classNames.findIndex((c) => c.includes('video-transport-controls'))
      const scrubberIndex = classNames.findIndex((c) => c.includes('scrubber-container'))

      // All should exist
      expect(headerIndex).toBeGreaterThanOrEqual(0)
      expect(reviewActionsIndex).toBeGreaterThanOrEqual(0)
      expect(videoContainerIndex).toBeGreaterThanOrEqual(0)
      expect(transportIndex).toBeGreaterThanOrEqual(0)
      expect(scrubberIndex).toBeGreaterThanOrEqual(0)

      // Verify order: header -> video -> transport -> scrubber -> actions
      expect(headerIndex).toBeLessThan(videoContainerIndex)
      expect(videoContainerIndex).toBeLessThan(transportIndex)
      expect(transportIndex).toBeLessThan(scrubberIndex)
      expect(scrubberIndex).toBeLessThan(reviewActionsIndex)
    })

    it('should not have redundant navigation sections', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Count sections that could contain navigation
      const reviewActions = document.querySelectorAll('.review-actions')
      const playbackControls = document.querySelectorAll('.playback-controls')
      const navigationControls = document.querySelectorAll('.navigation-controls')
      const shotNavigation = document.querySelectorAll('.shot-navigation')

      // Should have exactly one review-actions section
      expect(reviewActions).toHaveLength(1)

      // Should NOT have these redundant sections
      expect(playbackControls).toHaveLength(0)
      expect(navigationControls).toHaveLength(0)
      expect(shotNavigation).toHaveLength(0)
    })
  })

  describe('Accessibility', () => {
    it('should have accessible button labels for review actions', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Both buttons should be accessible
      expect(screen.getByRole('button', { name: /no golf shot/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /approve shot/i })).toBeInTheDocument()
    })

    it('should have keyboard navigation hints visible', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const hints = document.querySelector('.keyboard-hints')
      expect(hints).not.toBeNull()

      // Hints should include relevant shortcuts
      const hintsText = hints!.textContent || ''
      expect(hintsText).toContain('Enter')
      expect(hintsText).toContain('Esc')
      expect(hintsText).toContain('Approve')
      expect(hintsText).toContain('Reject')
    })
  })
})

describe('ClipReview Layout - Completion State', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Setup mock store with all shots already reviewed (shows completion screen)
    mockUseProcessingStore.mockReturnValue({
      segments: [
        createMockSegment({
          id: 'shot-1',
          confidence: 0.5,
          approved: 'approved', // Already approved
        }),
      ],
      updateSegment: mockUpdateSegment,
      approveSegment: mockApproveSegment,
      rejectSegment: mockRejectSegment,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('should show completion screen when all shots are reviewed', () => {
    render(<ClipReview onComplete={vi.fn()} />)

    expect(screen.getByText(/all shots have been reviewed/i)).toBeInTheDocument()
  })

  it('should not have review-actions div in completion state', () => {
    render(<ClipReview onComplete={vi.fn()} />)

    // In completion state, we show different UI
    const reviewActions = document.querySelector('.review-actions')
    expect(reviewActions).toBeNull()
  })

  it('should not have Previous/Next buttons in completion state', () => {
    render(<ClipReview onComplete={vi.fn()} />)

    const previousButtons = screen.queryAllByRole('button', { name: /previous/i })
    const nextButtons = screen.queryAllByRole('button', { name: /next/i })

    expect(previousButtons).toHaveLength(0)
    expect(nextButtons).toHaveLength(0)
  })
})

describe('ClipReview Layout - Single Shot vs Multiple Shots', () => {
  afterEach(() => {
    cleanup()
  })

  it('should have same layout structure for single shot as multiple shots', () => {
    // Single shot
    mockUseProcessingStore.mockReturnValue({
      segments: createMultipleMockSegments(1),
      updateSegment: mockUpdateSegment,
      approveSegment: mockApproveSegment,
      rejectSegment: mockRejectSegment,
    })

    const { container: singleContainer } = render(<ClipReview onComplete={vi.fn()} />)
    const singleStructure = Array.from(
      singleContainer.querySelector('.clip-review')?.children || [],
    ).map((el) => el.className)

    cleanup()

    // Multiple shots
    mockUseProcessingStore.mockReturnValue({
      segments: createMultipleMockSegments(5),
      updateSegment: mockUpdateSegment,
      approveSegment: mockApproveSegment,
      rejectSegment: mockRejectSegment,
    })

    const { container: multiContainer } = render(<ClipReview onComplete={vi.fn()} />)
    const multiStructure = Array.from(
      multiContainer.querySelector('.clip-review')?.children || [],
    ).map((el) => el.className)

    // Structure should be identical (same elements in same order)
    expect(singleStructure.length).toBe(multiStructure.length)
    singleStructure.forEach((className, index) => {
      expect(className).toBe(multiStructure[index])
    })
  })

  it('should NOT show Previous/Next buttons regardless of shot count', () => {
    // Test with 1 shot
    mockUseProcessingStore.mockReturnValue({
      segments: createMultipleMockSegments(1),
      updateSegment: mockUpdateSegment,
      approveSegment: mockApproveSegment,
      rejectSegment: mockRejectSegment,
    })

    render(<ClipReview onComplete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()

    cleanup()

    // Test with 5 shots
    mockUseProcessingStore.mockReturnValue({
      segments: createMultipleMockSegments(5),
      updateSegment: mockUpdateSegment,
      approveSegment: mockApproveSegment,
      rejectSegment: mockRejectSegment,
    })

    render(<ClipReview onComplete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /previous/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
  })
})
