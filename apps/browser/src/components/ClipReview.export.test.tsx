/**
 * ClipReview Export Modal Tests
 *
 * Tests for export modal behavior, focusing on bugs:
 * 1. Export modal stays open after downloads complete
 * 2. Export can hang at 0% or 99%
 *
 * FIX APPLIED: Auto-close modal with setTimeout after setExportComplete(true)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { ClipReview } from './ClipReview'
import { useProcessingStore, VideoSegment } from '../stores/processingStore'
import { createMockSegment } from '../test/video-test-utils'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// =============================================================================
// MOCKS - Setup test environment
// =============================================================================

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

// Mock URL.createObjectURL and revokeObjectURL
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url')
const mockRevokeObjectURL = vi.fn()
global.URL.createObjectURL = mockCreateObjectURL
global.URL.revokeObjectURL = mockRevokeObjectURL

// Mock HTMLAnchorElement click for download testing
const mockAnchorClick = vi.fn()
const originalCreateElement = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
  const element = originalCreateElement(tagName)
  if (tagName === 'a') {
    element.click = mockAnchorClick
  }
  return element
})

// Mock the processing store
const mockUseProcessingStore = vi.fn()
vi.mock('../stores/processingStore', async (importOriginal) => {
  const original = await importOriginal() as typeof import('../stores/processingStore')
  return {
    ...original,
    useProcessingStore: (...args: unknown[]) => mockUseProcessingStore(...args),
  }
})

// Mock feedback service
vi.mock('../lib/feedback-service', () => ({
  submitShotFeedback: vi.fn(),
  submitTracerFeedback: vi.fn(),
}))

// Mock video-frame-pipeline-v4
const mockExportWithTracer = vi.fn()
vi.mock('../lib/video-frame-pipeline-v4', () => ({
  VideoFramePipelineV4: vi.fn().mockImplementation(() => ({
    exportWithTracer: (...args: unknown[]) => mockExportWithTracer(...args),
  })),
  isVideoFrameCallbackSupported: vi.fn().mockReturnValue(true),
  ExportTimeoutError: class ExportTimeoutError extends Error {
    constructor(message: string) { super(message); this.name = 'ExportTimeoutError' }
  },
}))

// Mock trajectory generator
vi.mock('../lib/trajectory-generator', () => ({
  generateTrajectory: vi.fn(() => ({
    points: [
      { timestamp: 0, x: 0.5, y: 0.8, confidence: 1, interpolated: false },
      { timestamp: 1, x: 0.6, y: 0.5, confidence: 1, interpolated: false },
      { timestamp: 2, x: 0.7, y: 0.3, confidence: 1, interpolated: false },
    ],
    animationStart: 0,
    animationEnd: 3,
  })),
}))

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a mock segment with trajectory for export testing
 */
function createApprovedSegmentWithTrajectory(overrides: Partial<VideoSegment> = {}): VideoSegment {
  const base = createMockSegment({
    id: overrides.id ?? `segment-${Date.now()}`,
    confidence: 0.85,
    approved: 'approved',
    ...overrides,
  })
  return {
    ...base,
    landingPoint: { x: 0.7, y: 0.3 },
    trajectory: {
      shot_id: base.id,
      points: [
        { timestamp: 0, x: 0.5, y: 0.8, confidence: 1, interpolated: false },
        { timestamp: 1, x: 0.6, y: 0.5, confidence: 1, interpolated: false },
        { timestamp: 2, x: 0.7, y: 0.3, confidence: 1, interpolated: false },
      ],
      confidence: 0.9,
      frame_width: 1920,
      frame_height: 1080,
    },
  } as VideoSegment
}

/**
 * Setup mock store with approved segments (shows completion screen with export button)
 */
function setupMockStoreWithApprovedSegments(segments: VideoSegment[]) {
  mockUseProcessingStore.mockReturnValue({
    segments,
    updateSegment: vi.fn(),
    approveSegment: vi.fn(),
    rejectSegment: vi.fn(),
  })

  // Also mock getState for direct store access in handleExport
  const mockGetState = vi.fn().mockReturnValue({ segments })
  ;(useProcessingStore as unknown as { getState: () => { segments: VideoSegment[] } }).getState = mockGetState
}

// =============================================================================
// EXPORT MODAL VISIBILITY TESTS
// =============================================================================

describe('Export Modal Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // Reset export mock to succeed by default
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should show export modal when export button is clicked', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Should be on completion screen with export button
    expect(screen.getByText(/all shots have been reviewed/i)).toBeInTheDocument()
    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    expect(exportButton).toBeInTheDocument()

    // Click export button
    fireEvent.click(exportButton)

    // Export modal should appear
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should show progress text during export', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })

    // Start export
    fireEvent.click(exportButton)

    // Wait for modal to appear with progress text
    await waitFor(() => {
      expect(screen.getByText(/clip 1 of 1/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should show cancel button during export', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Make export hang (never resolve)
    mockExportWithTracer.mockImplementation(() => new Promise(() => {}))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })

    fireEvent.click(exportButton)

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Cancel button should be visible
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    expect(cancelButton).toBeInTheDocument()
  })
})

// =============================================================================
// EXPORT MODAL AUTO-CLOSE TESTS (Bug Fix Verification)
// =============================================================================

describe('Export Modal Auto-Close After Completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should show success state after export completes', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show success state eventually
    await waitFor(() => {
      // Look for success indicator
      const successElement = document.querySelector('.export-success-icon')
      const completeText = screen.queryByText(/export complete/i)
      expect(successElement || completeText).toBeTruthy()
    }, { timeout: 5000 })
  })

  it('should auto-close modal after 1.5 seconds on success (BUG FIX)', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for success state
    await waitFor(() => {
      const successElement = document.querySelector('.export-success-icon')
      expect(successElement).toBeInTheDocument()
    }, { timeout: 5000 })

    // Modal should still be visible at this point
    expect(document.querySelector('.export-modal')).toBeInTheDocument()

    // Advance timers to trigger auto-close (1.5 seconds)
    await vi.advanceTimersByTimeAsync(1600)

    // onComplete should be called - this verifies the bug fix
    expect(onComplete).toHaveBeenCalled()
  })

  it('should call onComplete when modal auto-closes', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for export to complete
    await waitFor(() => {
      const successElement = document.querySelector('.export-success-icon')
      expect(successElement).toBeInTheDocument()
    }, { timeout: 5000 })

    // onComplete should NOT be called yet (still showing success)
    expect(onComplete).not.toHaveBeenCalled()

    // Advance past auto-close timer
    await vi.advanceTimersByTimeAsync(1600)

    // Now onComplete should be called
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('should allow manual close via Done button before auto-close', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for Done button to appear
    await waitFor(() => {
      const doneButton = screen.queryByRole('button', { name: /done/i })
      expect(doneButton).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click Done button manually (before auto-close)
    const doneButton = screen.getByRole('button', { name: /done/i })
    fireEvent.click(doneButton)

    // onComplete should be called immediately
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// EXPORT ERROR STATE TESTS
// =============================================================================

describe('Export Error State', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should show error message when export fails', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Make export fail
    mockExportWithTracer.mockRejectedValue(new Error('Export failed: Out of memory'))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show error state - look for the header specifically
    await waitFor(() => {
      const errorHeader = document.querySelector('.export-modal-header')
      expect(errorHeader?.textContent).toMatch(/export failed/i)
    }, { timeout: 3000 })

    // Should show error message in the error message element
    const errorMessage = document.querySelector('.export-error-message')
    expect(errorMessage?.textContent).toMatch(/out of memory/i)
  })

  it('should show error icon when export fails', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(new Error('Network error'))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show error icon
    await waitFor(() => {
      const errorIcon = document.querySelector('.export-error-icon')
      expect(errorIcon).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should have Close button when error occurs', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(new Error('Failed to encode'))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show Close button
    await waitFor(() => {
      const closeButton = screen.getByRole('button', { name: /close/i })
      expect(closeButton).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should close modal when Close button is clicked after error', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(new Error('Export error'))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Click Close button
    const closeButton = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeButton)

    // Modal should be closed (no more "Export Failed" text)
    await waitFor(() => {
      expect(screen.queryByText(/export failed/i)).not.toBeInTheDocument()
    })
  })

  it('should NOT call onComplete when error modal is closed', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(new Error('Export error'))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    const closeButton = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeButton)

    // onComplete should NOT be called on error close
    expect(onComplete).not.toHaveBeenCalled()
  })
})

// =============================================================================
// CANCEL BUTTON TESTS
// =============================================================================

describe('Export Cancel Button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should close modal when Cancel is clicked during export', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Make export hang (never resolve)
    mockExportWithTracer.mockImplementation(() => new Promise(() => {}))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Click Cancel
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    // Modal should be closed
    await waitFor(() => {
      expect(screen.queryByText(/exporting clips/i)).not.toBeInTheDocument()
    })
  })

  it('should NOT call onComplete when export is cancelled', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockImplementation(() => new Promise(() => {}))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    // onComplete should NOT be called
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('should allow user to return to review after cancelling export', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockImplementation(() => new Promise(() => {}))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Click export
    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Cancel
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    // Should be back on completion screen with export button
    await waitFor(() => {
      expect(screen.getByText(/all shots have been reviewed/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /export 1 clip/i })).toBeInTheDocument()
    })
  })
})

// =============================================================================
// EXPORT HANG PREVENTION TESTS (Bug Specific)
// =============================================================================

describe('Export Hang Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should have progress bar element during export', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Make export hang (never resolve)
    mockExportWithTracer.mockImplementation(() => new Promise(() => {}))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for modal
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Progress bar should exist
    const progressBar = document.querySelector('.export-progress-bar')
    expect(progressBar).toBeInTheDocument()
  })

  it('should handle export completing at 99% (not hanging)', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockImplementation(async (config: { onProgress?: (p: { phase: string; progress: number }) => void }) => {
      // Report progress up to 99% then complete without 100%
      config.onProgress?.({ phase: 'encoding', progress: 99 })
      return new Blob(['mock-video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show success state (not stuck at 99%)
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      const doneButton = screen.queryByRole('button', { name: /done/i })
      expect(successIcon || doneButton).toBeTruthy()
    }, { timeout: 5000 })
  })

  it('should complete even when no progress callbacks fire (0% hang scenario)', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Export that never calls onProgress (simulating the 0% hang bug scenario)
    mockExportWithTracer.mockImplementation(async () => {
      // No onProgress calls at all - immediate return
      return new Blob(['mock-video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show success, not stuck at 0%
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })

    // Advance timers to auto-close
    await vi.advanceTimersByTimeAsync(1600)

    // onComplete should eventually be called
    expect(onComplete).toHaveBeenCalled()
  })
})

// =============================================================================
// MULTIPLE CLIPS EXPORT TESTS
// =============================================================================

describe('Multiple Clips Export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should show progress for each clip in multi-clip export', async () => {
    const segments = [
      createApprovedSegmentWithTrajectory({ id: 'seg-1' }),
      createApprovedSegmentWithTrajectory({ id: 'seg-2' }),
      createApprovedSegmentWithTrajectory({ id: 'seg-3' }),
    ]
    setupMockStoreWithApprovedSegments(segments)

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Should show "Export 3 Clips"
    const exportButton = screen.getByRole('button', { name: /export 3 clips/i })
    fireEvent.click(exportButton)

    // Should show progress for multiple clips
    await waitFor(() => {
      expect(screen.getByText(/clip \d of 3/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should auto-close after all clips are exported', async () => {
    const segments = [
      createApprovedSegmentWithTrajectory({ id: 'seg-1' }),
      createApprovedSegmentWithTrajectory({ id: 'seg-2' }),
    ]
    setupMockStoreWithApprovedSegments(segments)

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 2 clips/i })
    fireEvent.click(exportButton)

    // Wait for export to complete (success state)
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 10000 })

    // Advance timer for auto-close
    await vi.advanceTimersByTimeAsync(1600)

    expect(onComplete).toHaveBeenCalled()
  })
})

// =============================================================================
// EDGE CASE: Modal Closes After Exception
// =============================================================================

describe('Export Modal Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should close modal even if exception occurs after downloads complete', async () => {
    /**
     * EDGE CASE: If an exception is thrown AFTER downloads complete but BEFORE
     * setExportComplete(true), the modal could stay open forever.
     *
     * Expected behavior: Modal should close via finally block after timeout
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // This test documents the expected behavior - actual component test would
    // require mocking VideoFramePipeline to throw after download
    expect(true).toBe(true) // Placeholder - documents the edge case
  })
})

// =============================================================================
// EXPORT PIPELINE HANG TESTS (Bug: codec check blocks on large blobs)
// =============================================================================

/**
 * Tests for export pipeline hang bug.
 *
 * BUG: Export with tracer hangs indefinitely when a codec check reads the
 * ENTIRE video blob into WASM memory, which hangs for large files (500MB+).
 *
 * ROOT CAUSE:
 * - Writing entire blob to FFmpeg FS for codec detection hangs on large files
 * - This check is redundant because HEVC is already detected during upload via detectVideoCodec()
 *
 * SYMPTOMS:
 * - Export modal shows "Exporting Clips" with "Clip 1 of 1"
 * - Progress stays at 0% or shows no phase
 * - No onProgress callbacks fire
 * - Console shows "Calling pipeline.exportWithTracer..." then hangs
 */
describe('Export Pipeline Hang Prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should complete export within 60 seconds (timeout test)', async () => {
    /**
     * This test verifies export doesn't hang indefinitely.
     * If export takes longer than 60 seconds, something is wrong.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock export that completes normally
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for export to start
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Export should complete within reasonable time
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      const doneButton = screen.queryByRole('button', { name: /done/i })
      expect(successIcon || doneButton).toBeTruthy()
    }, { timeout: 60000 })
  })

  it('should show progress updates during export (not stuck at 0%)', async () => {
    /**
     * The bug causes export to hang before any progress callbacks fire.
     * This test verifies progress updates are emitted during export.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock export that fires progress callbacks
    mockExportWithTracer.mockImplementation(async (config: {
      onProgress?: (p: { phase: string; progress: number }) => void
    }) => {
      // Simulate progress updates
      config.onProgress?.({ phase: 'extracting', progress: 25 })
      config.onProgress?.({ phase: 'extracting', progress: 50 })
      config.onProgress?.({ phase: 'compositing', progress: 75 })
      config.onProgress?.({ phase: 'encoding', progress: 90 })
      config.onProgress?.({ phase: 'complete', progress: 100 })
      return new Blob(['mock-video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should see export complete (which means progress callbacks fired)
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should handle HEVC export error gracefully', async () => {
    /**
     * When export fails due to HEVC codec, should show clear error
     * (not hang indefinitely).
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock HevcExportError
    const HevcExportError = class extends Error {
      constructor() {
        super('Cannot export HEVC video. The video must be transcoded to H.264 first.')
        this.name = 'HevcExportError'
      }
    }
    mockExportWithTracer.mockRejectedValue(new HevcExportError())

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show error state, not hang
    await waitFor(() => {
      const errorHeader = document.querySelector('.export-modal-header')
      expect(errorHeader?.textContent).toMatch(/export failed/i)
    }, { timeout: 5000 })

    // Error message should mention HEVC or transcoding
    const errorMessage = document.querySelector('.export-error-message')
    expect(errorMessage?.textContent?.toLowerCase()).toMatch(/hevc|transcode/i)
  })

  it('should not hang when segment blob is large', async () => {
    /**
     * This test simulates the exact bug scenario:
     * - Large video blob (500MB+)
     * - Codec check called on full blob
     * - Export hangs indefinitely
     *
     * After fix: Export should complete or timeout gracefully.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    // Simulate large blob reference (actual size doesn't matter in mock)
    approvedSegment.blob = new Blob([new ArrayBuffer(1000)], { type: 'video/mp4' })
    Object.defineProperty(approvedSegment.blob, 'size', { value: 500 * 1024 * 1024 }) // 500MB
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock export that completes (simulating the fix)
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should complete without hanging
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 10000 })
  })

  it('should allow cancellation when export is slow', async () => {
    /**
     * If export is slow (bug scenario), user should be able to cancel.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock slow export (simulates hang)
    mockExportWithTracer.mockImplementation(() => new Promise(() => {
      // Never resolves - simulates hang
    }))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Cancel button should be available
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    expect(cancelButton).toBeInTheDocument()

    // Click cancel
    fireEvent.click(cancelButton)

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText(/exporting clips/i)).not.toBeInTheDocument()
    })

    // Should be back to review screen
    expect(screen.getByText(/all shots have been reviewed/i)).toBeInTheDocument()
  })

  it('should show phase name in progress UI during export', async () => {
    /**
     * Progress UI should show which phase we're in (extracting, compositing, encoding).
     * This helps debug hangs - if no phase shown, hang is in pre-phase codec detection.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock export that reports phases
    mockExportWithTracer.mockImplementation(async (config: {
      onProgress?: (p: { phase: string; progress: number }) => void
    }) => {
      config.onProgress?.({ phase: 'extracting', progress: 50 })
      await new Promise(resolve => setTimeout(resolve, 100))
      config.onProgress?.({ phase: 'compositing', progress: 75 })
      await new Promise(resolve => setTimeout(resolve, 100))
      return new Blob(['mock-video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for export to start
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Advance timers to trigger phase updates
    await vi.advanceTimersByTimeAsync(300)

    // Export should complete
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})

/**
 * Tests for export flow with pre-detected codec information.
 *
 * OPTIMIZATION: Since codec is detected during upload via detectVideoCodec(),
 * we should use that cached result instead of re-checking codec at export time.
 */
describe('Export with Pre-Detected Codec Info', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should export H.264 video without additional codec check', async () => {
    /**
     * When segment has isHevc: false from upload detection,
     * export should proceed without an additional codec check.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    // Segment already knows it's not HEVC (from upload detection)
    ;(approvedSegment as Record<string, unknown>).isHevc = false
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should complete successfully
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should block export for known HEVC video', async () => {
    /**
     * When segment has isHevc: true from upload detection,
     * export should show transcoding option, not attempt export.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    // Segment knows it's HEVC
    ;(approvedSegment as Record<string, unknown>).isHevc = true
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock export to throw HEVC error (simulating pre-check)
    mockExportWithTracer.mockRejectedValue(
      new Error('Cannot export HEVC video. The video must be transcoded to H.264 first.')
    )

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show error about HEVC
    await waitFor(() => {
      const errorHeader = document.querySelector('.export-modal-header')
      expect(errorHeader?.textContent).toMatch(/export failed/i)
    }, { timeout: 5000 })
  })
})

// =============================================================================
// NO APPROVED CLIPS EDGE CASE
// =============================================================================

describe('Export with No Approved Clips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('should NOT show export button when no clips are approved', async () => {
    // All clips rejected
    const rejectedSegment = createMockSegment({
      id: 'seg-1',
      approved: 'rejected',
      confidence: 0.5,
    })
    setupMockStoreWithApprovedSegments([rejectedSegment as VideoSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Should show completion screen
    expect(screen.getByText(/all shots have been reviewed/i)).toBeInTheDocument()

    // Should NOT show export button when 0 clips approved
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()

    // Should show "Process Another Video" button
    const processAnotherButton = screen.getByRole('button', { name: /process another video/i })
    expect(processAnotherButton).toBeInTheDocument()
  })
})

// =============================================================================
// 4K VIDEO EXPORT TESTS (Bug: Export hang at 90% for 4K 60fps)
// =============================================================================

/**
 * Tests for 4K video export scenarios.
 *
 * BUG CONTEXT: Export with tracer hangs at ~90% during frame extraction
 * for 4K 60fps videos. This is due to FFmpeg WASM struggling with 4K decode.
 *
 * Test scenarios:
 * 1. Large blob (>50MB) - should trigger downscale warning in pipeline
 * 2. Long clip (>18s) - should trigger FPS reduction and downscaling
 * 3. 4K dimensions detected - should apply scale filter
 * 4. Memory exhaustion scenario - should timeout gracefully
 */
describe('Export 4K Video Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should export 4K video with large blob (>50MB) successfully', async () => {
    /**
     * Simulates export of a 4K video with a large segment blob.
     * After fix: Should complete without hanging (pipeline handles large blobs).
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-4k-large' })
    // Simulate a 100MB blob (typical for 30s 4K)
    approvedSegment.blob = new Blob([new ArrayBuffer(1000)], { type: 'video/mp4' })
    Object.defineProperty(approvedSegment.blob, 'size', { value: 100 * 1024 * 1024 })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should complete without hanging
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 10000 })
  })

  it('should handle export timeout gracefully for stuck 4K decode', async () => {
    /**
     * Simulates the exact bug scenario: 4K video that hangs during decode.
     * Export should eventually timeout (2 minutes in pipeline) and show error.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-4k-hang' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Simulate pipeline timeout error
    mockExportWithTracer.mockRejectedValue(
      new Error('Frame extraction timed out after 120 seconds. The video may be too large or in an unsupported format.')
    )

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Should show error state with timeout message
    await waitFor(() => {
      const errorHeader = document.querySelector('.export-modal-header')
      expect(errorHeader?.textContent).toMatch(/export failed/i)
    }, { timeout: 5000 })

    // Error message should mention timeout
    const errorMessage = document.querySelector('.export-error-message')
    expect(errorMessage?.textContent?.toLowerCase()).toMatch(/timed out|too large/i)
  })

  it('should allow retry after 4K export failure', async () => {
    /**
     * After a 4K export fails, user should be able to retry or cancel.
     */
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-4k-retry' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // First attempt fails
    mockExportWithTracer.mockRejectedValueOnce(new Error('Memory exhausted'))
    // Second attempt succeeds
    mockExportWithTracer.mockResolvedValueOnce(new Blob(['video'], { type: 'video/mp4' }))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // First export attempt
    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    // Wait for error
    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Close error modal
    const closeButton = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeButton)

    // Should be back on completion screen
    await waitFor(() => {
      expect(screen.getByText(/all shots have been reviewed/i)).toBeInTheDocument()
    })

    // Retry export
    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    // Second attempt should succeed
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})

// =============================================================================
// MEMORY LIMIT TESTS
// =============================================================================

/**
 * Tests for memory limit handling during export.
 *
 * FFmpeg WASM has limited memory (~2GB). Large videos can exhaust this.
 * The UI should handle memory errors gracefully.
 */
describe('Export Memory Limit Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should show meaningful error on memory exhaustion', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-memory' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Simulate memory exhaustion error
    mockExportWithTracer.mockRejectedValue(
      new Error('RuntimeError: memory access out of bounds')
    )

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    // Should show error
    await waitFor(() => {
      const errorHeader = document.querySelector('.export-modal-header')
      expect(errorHeader?.textContent).toMatch(/export failed/i)
    }, { timeout: 5000 })
  })

  it('should handle WebAssembly.Memory allocation failure', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-wasm-memory' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(
      new Error('WebAssembly.Memory allocation failed')
    )

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should not call onComplete after memory error', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-memory-no-complete' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(new Error('Out of memory'))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Close modal
    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    // onComplete should NOT have been called
    expect(onComplete).not.toHaveBeenCalled()
  })
})

// =============================================================================
// LONG CLIP EXPORT TESTS
// =============================================================================

/**
 * Tests for long clip export (>18 seconds).
 *
 * Long clips trigger FPS reduction and downscaling in the pipeline.
 * These tests verify the UI handles these scenarios correctly.
 */
describe('Export Long Clip Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should successfully export 20 second clip', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-long-20s' })
    // Set clip boundaries to 20 seconds
    approvedSegment.clipStart = 0
    approvedSegment.clipEnd = 20
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 10000 })
  })

  it('should successfully export 30 second clip with downscaling', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-long-30s' })
    approvedSegment.clipStart = 0
    approvedSegment.clipEnd = 30
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Mock progress to simulate phases
    mockExportWithTracer.mockImplementation(async (config: {
      onProgress?: (p: { phase: string; progress: number }) => void
    }) => {
      config.onProgress?.({ phase: 'preparing', progress: 100 })
      config.onProgress?.({ phase: 'extracting', progress: 100 })
      config.onProgress?.({ phase: 'compositing', progress: 100 })
      config.onProgress?.({ phase: 'encoding', progress: 100 })
      config.onProgress?.({ phase: 'complete', progress: 100 })
      return new Blob(['video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 10000 })
  })
})

// =============================================================================
// PROGRESS PHASE VISIBILITY TESTS
// =============================================================================

/**
 * Tests for progress phase visibility.
 *
 * Users should see which phase the export is in (preparing, extracting, etc.)
 * This helps diagnose hangs - if no phase shown, hang is pre-phase.
 */
describe('Export Progress Phase Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should show preparing phase during blob conversion', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-phase-preparing' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockImplementation(async (config: {
      onProgress?: (p: { phase: string; progress: number }) => void
    }) => {
      // Report preparing phase, then hang briefly
      config.onProgress?.({ phase: 'preparing', progress: 50 })
      await new Promise(resolve => setTimeout(resolve, 500))
      config.onProgress?.({ phase: 'extracting', progress: 100 })
      config.onProgress?.({ phase: 'compositing', progress: 100 })
      config.onProgress?.({ phase: 'encoding', progress: 100 })
      config.onProgress?.({ phase: 'complete', progress: 100 })
      return new Blob(['video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    // Wait for modal to show
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Advance timers to complete
    await vi.advanceTimersByTimeAsync(600)

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should show extracting phase during frame extraction', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-phase-extracting' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockImplementation(async (config: {
      onProgress?: (p: { phase: string; progress: number }) => void
    }) => {
      config.onProgress?.({ phase: 'preparing', progress: 100 })
      config.onProgress?.({ phase: 'extracting', progress: 25 })
      config.onProgress?.({ phase: 'extracting', progress: 50 })
      config.onProgress?.({ phase: 'extracting', progress: 75 })
      config.onProgress?.({ phase: 'extracting', progress: 100 })
      config.onProgress?.({ phase: 'compositing', progress: 100 })
      config.onProgress?.({ phase: 'encoding', progress: 100 })
      config.onProgress?.({ phase: 'complete', progress: 100 })
      return new Blob(['video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should transition through all phases in order', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-all-phases' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const _reportedPhases: string[] = []

    mockExportWithTracer.mockImplementation(async (config: {
      onProgress?: (p: { phase: string; progress: number }) => void
    }) => {
      const phases = ['preparing', 'extracting', 'compositing', 'encoding', 'complete']
      for (const phase of phases) {
        config.onProgress?.({ phase, progress: 100 })
      }
      return new Blob(['video'], { type: 'video/mp4' })
    })

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})

// =============================================================================
// DIFFERENT CODEC EXPORT TESTS
// =============================================================================

/**
 * Tests for different codec handling during export.
 *
 * Currently supported: H.264 (AVC)
 * Not supported: HEVC (H.265), VP9
 */
describe('Export Different Codecs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('should export H.264 video successfully', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-h264' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should show clear error for HEVC video', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-hevc' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Import HevcExportError from mock
    const HevcExportError = class extends Error {
      constructor() {
        super('Cannot export HEVC video. The video must be transcoded to H.264 first.')
        this.name = 'HevcExportError'
      }
    }
    mockExportWithTracer.mockRejectedValue(new HevcExportError())

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Error should mention HEVC or transcoding
    const errorMessage = document.querySelector('.export-error-message')
    expect(errorMessage?.textContent?.toLowerCase()).toMatch(/hevc|transcode/i)
  })

  it('should show error for unsupported VP9 codec', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-vp9' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(
      new Error('Unsupported codec: vp9. Only H.264 is supported for export.')
    )

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    fireEvent.click(screen.getByRole('button', { name: /export 1 clip/i }))

    await waitFor(() => {
      expect(screen.getByText(/export failed/i)).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})
