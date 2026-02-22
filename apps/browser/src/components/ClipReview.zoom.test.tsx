/**
 * ClipReview Zoom and Pan Tests
 *
 * Tests for keyboard-driven zoom (1x-4x) and drag-to-pan controls.
 * Verifies zoom state management, keyboard shortcuts, pan clamping,
 * and zoom reset on shot navigation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { ClipReview } from './ClipReview'

expect.extend(matchers)

// Mock ResizeObserver
class MockResizeObserver {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

// Mock canvas context
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(), clearRect: vi.fn(), setTransform: vi.fn(),
  drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
  beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  closePath: vi.fn(), stroke: vi.fn(), arc: vi.fn(),
  fill: vi.fn(), measureText: vi.fn().mockReturnValue({ width: 0 }),
  transform: vi.fn(), rect: vi.fn(), clip: vi.fn(),
  scale: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
  quadraticCurveTo: vi.fn(),
  canvas: { width: 800, height: 600 },
  fillText: vi.fn(), getImageData: vi.fn().mockReturnValue({ data: [] }),
  putImageData: vi.fn(), createImageData: vi.fn().mockReturnValue([]),
}) as unknown as typeof HTMLCanvasElement.prototype.getContext

// Mock segments - two shots needing review (confidence < 0.7)
const mockSegments = [
  {
    id: 'shot-1',
    startTime: 0,
    endTime: 10,
    clipStart: 1,
    clipEnd: 8,
    strikeTime: 3,
    confidence: 0.5,
    approved: 'pending' as const,
    objectUrl: 'blob:test',
    blob: new Blob(),
  },
  {
    id: 'shot-2',
    startTime: 10,
    endTime: 20,
    clipStart: 11,
    clipEnd: 18,
    strikeTime: 13,
    confidence: 0.5,
    approved: 'pending' as const,
    objectUrl: 'blob:test2',
    blob: new Blob(),
  },
]

vi.mock('../stores/processingStore', () => ({
  useProcessingStore: vi.fn(() => ({
    segments: mockSegments,
    updateSegment: vi.fn(),
    approveSegment: vi.fn(),
    rejectSegment: vi.fn(),
    videos: new Map(),
    activeVideoId: null,
    updateVideoSegment: vi.fn(),
    approveVideoSegment: vi.fn(),
    rejectVideoSegment: vi.fn(),
  })),
}))

vi.mock('../lib/feedback-service', () => ({
  submitShotFeedback: vi.fn(),
  submitTracerFeedback: vi.fn(),
}))

vi.mock('../lib/video-frame-pipeline-v4', () => ({
  VideoFramePipelineV4: vi.fn(),
  isVideoFrameCallbackSupported: vi.fn(() => true),
  checkWebCodecsSupport: vi.fn(() => null),
  ExportTimeoutError: class ExportTimeoutError extends Error {
    constructor(message: string) { super(message); this.name = 'ExportTimeoutError' }
  },
}))

vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn(),
  muxAudioIntoClip: vi.fn(),
}))

vi.mock('../lib/trajectory-generator', () => ({
  generateTrajectory: vi.fn(() => ({
    points: [],
    apex_point: null,
    frame_width: 1920,
    frame_height: 1080,
  })),
}))

describe('ClipReview Zoom Controls', () => {
  afterEach(() => cleanup())

  describe('Keyboard shortcuts', () => {
    it('zooms in with = key and shows zoom indicator', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: '=' })
      expect(screen.getByText(/1\.5x zoom/)).toBeInTheDocument()
    })

    it('zooms in with + key', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: '+' })
      expect(screen.getByText(/1\.5x zoom/)).toBeInTheDocument()
    })

    it('zooms in incrementally by 0.5x steps', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: '=' })
      expect(screen.getByText(/1\.5x zoom/)).toBeInTheDocument()

      fireEvent.keyDown(window, { key: '=' })
      expect(screen.getByText(/2\.0x zoom/)).toBeInTheDocument()

      fireEvent.keyDown(window, { key: '=' })
      expect(screen.getByText(/2\.5x zoom/)).toBeInTheDocument()
    })

    it('clamps zoom at 4x maximum', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Press = 8 times to try to reach 5x (should clamp at 4x)
      for (let i = 0; i < 8; i++) {
        fireEvent.keyDown(window, { key: '=' })
      }

      expect(screen.getByText(/4\.0x zoom/)).toBeInTheDocument()
    })

    it('zooms out with - key', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Zoom in first
      fireEvent.keyDown(window, { key: '=' })
      fireEvent.keyDown(window, { key: '=' })
      expect(screen.getByText(/2\.0x zoom/)).toBeInTheDocument()

      // Zoom out
      fireEvent.keyDown(window, { key: '-' })
      expect(screen.getByText(/1\.5x zoom/)).toBeInTheDocument()
    })

    it('clamps zoom at 1x minimum and hides indicator', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Zoom in then out past 1x
      fireEvent.keyDown(window, { key: '=' })
      fireEvent.keyDown(window, { key: '-' })
      fireEvent.keyDown(window, { key: '-' })
      fireEvent.keyDown(window, { key: '-' })

      // No zoom indicator at 1x
      expect(screen.queryByText(/\dx zoom/)).not.toBeInTheDocument()
    })

    it('resets zoom with 0 key', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Zoom in
      fireEvent.keyDown(window, { key: '=' })
      fireEvent.keyDown(window, { key: '=' })
      fireEvent.keyDown(window, { key: '=' })
      expect(screen.getByText(/2\.5x zoom/)).toBeInTheDocument()

      // Reset
      fireEvent.keyDown(window, { key: '0' })
      expect(screen.queryByText(/\dx zoom/)).not.toBeInTheDocument()
    })

    it('does not zoom when typing in input fields', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Simulate keydown with target being an input element
      const input = document.createElement('input')
      document.body.appendChild(input)
      fireEvent.keyDown(input, { key: '=', target: input })

      // No zoom indicator should appear
      expect(screen.queryByText(/\dx zoom/)).not.toBeInTheDocument()
      document.body.removeChild(input)
    })
  })

  describe('CSS classes', () => {
    it('adds zoomed class to video-container when zoom > 1x', () => {
      const { container } = render(<ClipReview onComplete={vi.fn()} />)

      const videoContainer = container.querySelector('.video-container')
      expect(videoContainer).not.toHaveClass('zoomed')

      fireEvent.keyDown(window, { key: '=' })
      expect(videoContainer).toHaveClass('zoomed')
    })

    it('removes zoomed class when zoom returns to 1x', () => {
      const { container } = render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: '=' })
      const videoContainer = container.querySelector('.video-container')
      expect(videoContainer).toHaveClass('zoomed')

      fireEvent.keyDown(window, { key: '-' })
      expect(videoContainer).not.toHaveClass('zoomed')
    })

    it('applies scale transform to video-zoom-content when zoomed', () => {
      const { container } = render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: '=' })
      fireEvent.keyDown(window, { key: '=' })

      const zoomContent = container.querySelector('.video-zoom-content') as HTMLElement
      expect(zoomContent).toBeTruthy()
      expect(zoomContent.style.transform).toContain('scale(2)')
    })

    it('has no transform at 1x zoom', () => {
      const { container } = render(<ClipReview onComplete={vi.fn()} />)

      const zoomContent = container.querySelector('.video-zoom-content') as HTMLElement
      expect(zoomContent).toBeTruthy()
      expect(zoomContent.style.transform).toBeFalsy()
    })
  })

  describe('Shot navigation reset', () => {
    it('resets zoom when navigating to next shot', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      // Zoom in
      fireEvent.keyDown(window, { key: '=' })
      fireEvent.keyDown(window, { key: '=' })
      expect(screen.getByText(/2\.0x zoom/)).toBeInTheDocument()

      // Navigate to next shot
      fireEvent.keyDown(window, { key: 'ArrowDown' })

      // Zoom should reset
      expect(screen.queryByText(/\dx zoom/)).not.toBeInTheDocument()
    })
  })

  describe('Keyboard hints', () => {
    it('shows zoom keyboard hints', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      expect(screen.getByText(/Zoom/)).toBeInTheDocument()
      expect(screen.getByText(/Reset zoom/)).toBeInTheDocument()
    })
  })

  describe('Zoom indicator text', () => {
    it('shows drag and reset instructions in zoom indicator', () => {
      render(<ClipReview onComplete={vi.fn()} />)

      fireEvent.keyDown(window, { key: '=' })

      const indicator = screen.getByText(/1\.5x zoom/)
      expect(indicator.textContent).toContain('drag to pan')
      expect(indicator.textContent).toContain('press 0 to reset')
    })
  })
})
