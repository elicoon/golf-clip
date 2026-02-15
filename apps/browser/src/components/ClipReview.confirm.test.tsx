/**
 * ClipReview Confirmation Dialog Tests
 *
 * Tests that destructive actions (Escape key and "No Golf Shot" button)
 * show a confirmation dialog before rejecting a shot.
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
  useProcessingStore: Object.assign(
    (...args: unknown[]) => mockUseProcessingStore(...args),
    { getState: () => mockUseProcessingStore() }
  ),
}))

// Mock feedback service
vi.mock('../lib/feedback-service', () => ({
  submitShotFeedback: vi.fn(),
  submitTracerFeedback: vi.fn(),
}))

// Mock ffmpeg-client
vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  getFFmpegInstance: vi.fn(),
  transcodeHevcToH264: vi.fn(),
  estimateTranscodeTime: vi.fn().mockReturnValue({ minMinutes: 1, maxMinutes: 2, formatted: '1-2 minutes' }),
}))

// Mock video-frame-pipeline
vi.mock('../lib/video-frame-pipeline', () => ({
  VideoFramePipeline: vi.fn().mockImplementation(() => ({
    exportWithTracer: vi.fn().mockResolvedValue(new Blob(['mock'], { type: 'video/mp4' })),
  })),
  HevcExportError: class HevcExportError extends Error {},
}))

// Mock trajectory generator
vi.mock('../lib/trajectory-generator', () => ({
  generateTrajectory: vi.fn(() => ({
    points: [],
    animationStart: 0,
    animationEnd: 3,
  })),
}))

describe('ClipReview Confirmation Dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseProcessingStore.mockReturnValue({
      segments: [
        createMockSegment({
          id: 'shot-1',
          confidence: 0.5,
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

  describe('Escape Key', () => {
    it('should show confirmation dialog when Escape is pressed', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Dialog should not be visible initially
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()

      // Press Escape
      fireEvent.keyDown(window, { key: 'Escape' })

      // Dialog should now be visible
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      expect(screen.getByText(/skip this shot/i)).toBeInTheDocument()
    })

    it('should NOT reject the shot immediately when Escape is pressed', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: 'Escape' })

      // Shot should NOT be rejected yet
      expect(mockRejectSegment).not.toHaveBeenCalled()
    })

    it('should reject the shot when Escape dialog is confirmed', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Press Escape to open dialog
      fireEvent.keyDown(window, { key: 'Escape' })

      // Click Confirm
      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

      // Now the shot should be rejected
      expect(mockRejectSegment).toHaveBeenCalledWith('shot-1')
    })

    it('should NOT reject the shot when Escape dialog is cancelled', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Press Escape to open dialog
      fireEvent.keyDown(window, { key: 'Escape' })

      // Click Cancel
      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))

      // Shot should NOT be rejected
      expect(mockRejectSegment).not.toHaveBeenCalled()

      // Dialog should be closed
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })

    it('should close the dialog when Escape is pressed while dialog is open', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // First Escape opens the dialog
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()

      // Second Escape should close the dialog (not reject the shot)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      expect(mockRejectSegment).not.toHaveBeenCalled()
    })
  })

  describe('"No Golf Shot" Button', () => {
    it('should show confirmation dialog when "No Golf Shot" button is clicked', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Click "No Golf Shot" button
      const rejectButton = screen.getByRole('button', { name: /no golf shot/i })
      fireEvent.click(rejectButton)

      // Dialog should be visible
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
    })

    it('should NOT reject the shot immediately when "No Golf Shot" is clicked', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      const rejectButton = screen.getByRole('button', { name: /no golf shot/i })
      fireEvent.click(rejectButton)

      // Shot should NOT be rejected yet
      expect(mockRejectSegment).not.toHaveBeenCalled()
    })

    it('should reject the shot when "No Golf Shot" dialog is confirmed', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Click "No Golf Shot" button
      const rejectButton = screen.getByRole('button', { name: /no golf shot/i })
      fireEvent.click(rejectButton)

      // Confirm the dialog
      fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

      // Now the shot should be rejected
      expect(mockRejectSegment).toHaveBeenCalledWith('shot-1')
    })

    it('should close dialog and keep the shot when cancelled', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Click "No Golf Shot" button
      const rejectButton = screen.getByRole('button', { name: /no golf shot/i })
      fireEvent.click(rejectButton)

      // Cancel the dialog
      fireEvent.click(screen.getByTestId('confirm-dialog-cancel'))

      // Shot should NOT be rejected
      expect(mockRejectSegment).not.toHaveBeenCalled()

      // Dialog should be gone
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
  })

  describe('Dialog Content', () => {
    it('should have Cancel and Confirm buttons with correct labels', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(screen.getByTestId('confirm-dialog-cancel')).toHaveTextContent('Cancel')
      expect(screen.getByTestId('confirm-dialog-confirm')).toHaveTextContent('Skip Shot')
    })
  })
})
