/**
 * ClipReview Feedback Error Display Tests
 *
 * Tests that feedback submission errors (e.g. Supabase connection failures)
 * are shown to the user as visible, non-blocking banners.
 *
 * Bug: feedback-service.ts returns { success: false, error: "..." } but
 * ClipReview.tsx was fire-and-forgetting the calls, so errors were silent.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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

// Mock feedback service — mocks are hoisted, we'll configure per-test
const mockSubmitShotFeedback = vi.fn()
const mockSubmitTracerFeedback = vi.fn()
vi.mock('../lib/feedback-service', () => ({
  submitShotFeedback: (...args: unknown[]) => mockSubmitShotFeedback(...args),
  submitTracerFeedback: (...args: unknown[]) => mockSubmitTracerFeedback(...args),
}))

// Mock video-frame-pipeline-v4
vi.mock('../lib/video-frame-pipeline-v4', () => ({
  VideoFramePipelineV4: vi.fn().mockImplementation(() => ({
    exportWithTracer: vi.fn().mockResolvedValue(new Blob(['mock'], { type: 'video/mp4' })),
  })),
  isVideoFrameCallbackSupported: vi.fn().mockReturnValue(true),
  ExportTimeoutError: class ExportTimeoutError extends Error {
    constructor(message: string) { super(message); this.name = 'ExportTimeoutError' }
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

// Mock ffmpeg-client
vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  muxAudioIntoClip: vi.fn(),
}))

/** Flush all microtasks (pending promise callbacks) */
async function flushPromises() {
  // Multiple rounds to handle chained .then() callbacks
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}

describe('ClipReview Feedback Error Display', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mock store with a segment needing review
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

    // Default: feedback succeeds
    mockSubmitShotFeedback.mockResolvedValue({ success: true })
    mockSubmitTracerFeedback.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    cleanup()
  })

  it('should show error banner when shot feedback submission fails on reject', async () => {
    // Configure feedback to fail
    mockSubmitShotFeedback.mockResolvedValue({
      success: false,
      error: "Feedback couldn't be saved — check your connection",
    })

    render(<ClipReview onComplete={vi.fn()} />)

    // No error initially
    expect(screen.queryByRole('alert')).toBeNull()

    // Click "No Golf Shot" to reject
    fireEvent.click(screen.getByRole('button', { name: /no golf shot/i }))

    // Confirm the dialog
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

    // Flush promises so the .then() callback executes
    await flushPromises()

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent).toContain("Feedback couldn't be saved")
  })

  it('should show error banner when shot feedback submission fails on approve', async () => {
    // Configure feedback to fail
    mockSubmitShotFeedback.mockResolvedValue({
      success: false,
      error: "Feedback couldn't be saved — check your connection",
    })

    render(<ClipReview onComplete={vi.fn()} />)

    // Mark landing by clicking the canvas to transition to 'reviewing' step
    const canvas = document.querySelector('canvas')
    expect(canvas).not.toBeNull()
    const rect = { left: 0, top: 0, width: 800, height: 600 }
    Object.defineProperty(canvas!, 'getBoundingClientRect', { value: () => rect })
    fireEvent.click(canvas!, { clientX: 400, clientY: 300 })

    // Approve should now be enabled
    const approveButton = screen.getByRole('button', { name: /approve/i })
    expect(approveButton).not.toBeDisabled()

    fireEvent.click(approveButton)

    // Flush promises so the .then() callback executes
    await flushPromises()

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent).toContain("Feedback couldn't be saved")
  })

  it('should NOT show error banner when feedback succeeds', async () => {
    // Both feedback calls succeed (default)
    render(<ClipReview onComplete={vi.fn()} />)

    // Click "No Golf Shot" to reject
    fireEvent.click(screen.getByRole('button', { name: /no golf shot/i }))
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

    await flushPromises()

    // No error should appear
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should allow dismissing the error banner by clicking dismiss button', async () => {
    mockSubmitShotFeedback.mockResolvedValue({
      success: false,
      error: "Feedback couldn't be saved — check your connection",
    })

    render(<ClipReview onComplete={vi.fn()} />)

    // Reject to trigger error
    fireEvent.click(screen.getByRole('button', { name: /no golf shot/i }))
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

    await flushPromises()

    expect(screen.getByRole('alert')).toBeInTheDocument()

    // Dismiss the error
    fireEvent.click(screen.getByLabelText('Dismiss'))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('should show tracer feedback error when tracer feedback fails on approve', async () => {
    // Shot feedback succeeds but tracer feedback fails
    mockSubmitShotFeedback.mockResolvedValue({ success: true })
    mockSubmitTracerFeedback.mockResolvedValue({
      success: false,
      error: "Feedback couldn't be saved — check your connection",
    })

    render(<ClipReview onComplete={vi.fn()} />)

    // Mark landing to transition to 'reviewing' step
    const canvas = document.querySelector('canvas')
    const rect = { left: 0, top: 0, width: 800, height: 600 }
    Object.defineProperty(canvas!, 'getBoundingClientRect', { value: () => rect })
    fireEvent.click(canvas!, { clientX: 400, clientY: 300 })

    // Approve
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))

    await flushPromises()

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent).toContain("Feedback couldn't be saved")
  })

  it('error banner should be non-blocking (user can still interact with UI)', async () => {
    mockSubmitShotFeedback.mockResolvedValue({
      success: false,
      error: "Feedback couldn't be saved — check your connection",
    })

    // Setup with 2 shots so after rejecting the first, UI remains interactive
    mockUseProcessingStore.mockReturnValue({
      segments: [
        createMockSegment({
          id: 'shot-1',
          confidence: 0.5,
          approved: 'pending',
          objectUrl: 'blob:http://localhost/mock-video-1',
        }),
        createMockSegment({
          id: 'shot-2',
          confidence: 0.4,
          approved: 'pending',
          objectUrl: 'blob:http://localhost/mock-video-2',
        }),
      ],
      updateSegment: mockUpdateSegment,
      approveSegment: mockApproveSegment,
      rejectSegment: mockRejectSegment,
    })

    render(<ClipReview onComplete={vi.fn()} />)

    // Reject first shot
    fireEvent.click(screen.getByRole('button', { name: /no golf shot/i }))
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'))

    await flushPromises()

    // Error banner should appear
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // The "No Golf Shot" button should still be clickable (non-blocking)
    const rejectButton = screen.queryByRole('button', { name: /no golf shot/i })
    if (rejectButton) {
      expect(rejectButton).not.toBeDisabled()
    }
  })
})
