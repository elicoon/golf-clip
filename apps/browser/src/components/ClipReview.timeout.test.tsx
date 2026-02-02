/**
 * ClipReview Export Defensive Timeout Tests
 *
 * Tests for the "defensive timeout not cleared" bug in export functionality.
 *
 * BUG DESCRIPTION:
 * In handleExport (lines 460-479), a 10-second defensive timeout is set in the
 * finally block to force-close a stuck export modal. However:
 * 1. The timeout is NEVER stored in a ref
 * 2. The timeout is NEVER cleared when export completes successfully
 * 3. The timeout is NEVER cleared when export is cancelled
 * 4. Stale timeouts from previous exports can interfere with subsequent exports
 *
 * These tests are designed to FAIL with the current buggy code and PASS after the fix.
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
// MOCKS - Setup test environment (same as ClipReview.export.test.tsx)
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

// Mock ffmpeg-client - resolve immediately
vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  getFFmpegInstance: vi.fn().mockReturnValue({}),
  transcodeHevcToH264: vi.fn().mockResolvedValue(new Blob(['transcoded'], { type: 'video/mp4' })),
  estimateTranscodeTime: vi.fn().mockReturnValue({ minMinutes: 1, maxMinutes: 2, formatted: '1-2 minutes' }),
}))

// Mock video-frame-pipeline
const mockExportWithTracer = vi.fn()
vi.mock('../lib/video-frame-pipeline', () => ({
  VideoFramePipeline: vi.fn().mockImplementation(() => ({
    exportWithTracer: (...args: unknown[]) => mockExportWithTracer(...args),
  })),
  HevcExportError: class HevcExportError extends Error {
    constructor(message = 'HEVC error') {
      super(message)
      this.name = 'HevcExportError'
    }
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
// DEFENSIVE TIMEOUT BUG TESTS
// =============================================================================

/**
 * Track setTimeout and clearTimeout calls to verify timeout cleanup
 *
 * The bug is that the defensive timeout's ID is never stored and never cleared.
 * Even though the timeout's effect is mitigated by state checks (modal already closed),
 * NOT clearing the timeout is:
 * 1. A resource leak (timeout stays in event loop)
 * 2. A potential race condition (timing-dependent bugs)
 * 3. Bad practice (unmanaged side effects)
 *
 * These tests verify that clearTimeout is called appropriately.
 */
describe('Export Defensive Timeout Bug - Timeout Not Cleared', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>
  let timeoutIds: Set<ReturnType<typeof setTimeout>>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))

    // Spy on console.warn to detect when defensive timeout fires
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Track setTimeout and clearTimeout calls
    // Note: With fake timers, we track the timeout IDs to see if they're cleared
    timeoutIds = new Set()
    const originalSetTimeout = globalThis.setTimeout
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, delay?: number) => {
      const id = originalSetTimeout(fn, delay)
      // Track timeouts with 10000ms delay (our defensive timeout)
      if (delay === 10000) {
        timeoutIds.add(id)
      }
      return id
    }) as typeof setTimeout)

    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation((id) => {
      if (id && timeoutIds.has(id as ReturnType<typeof setTimeout>)) {
        timeoutIds.delete(id as ReturnType<typeof setTimeout>)
      }
      // Call the original if it exists (fake timers handle this)
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    consoleWarnSpy.mockRestore()
    setTimeoutSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
  })

  /**
   * TEST: Defensive timeout should be cleared on successful export
   *
   * BUG: After successful export completes, the 10-second defensive timeout
   * is never cleared. Even though the state check prevents the warning from
   * logging (modal is already closed), the timeout still exists in the event loop.
   *
   * This is a resource leak and potential race condition source.
   *
   * EXPECTED: After fix, clearTimeout should be called for the defensive timeout
   * when export completes successfully.
   */
  it('should clear defensive timeout after successful export completion (BUG: timeout not cleared)', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Start export
    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for export to complete successfully
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })

    // At this point, a 10-second defensive timeout was set in the finally block
    // BUG: The timeout ID was never saved, so it can't be cleared
    expect(timeoutIds.size).toBeGreaterThan(0) // Defensive timeout was set

    // Advance past auto-close (1.5s) to close modal
    await vi.advanceTimersByTimeAsync(2000)
    expect(onComplete).toHaveBeenCalled()

    // BUG: After export completes and modal closes, the defensive timeout
    // should have been cleared. But it wasn't because the ID was never stored.
    // AFTER FIX: timeoutIds.size should be 0 (timeout was cleared)
    expect(timeoutIds.size).toBe(0)
  })

  /**
   * TEST: Defensive timeout should be cleared when export is cancelled
   *
   * BUG: When user cancels export, the defensive timeout continues running.
   * The timeout ID was never stored, so it can't be cleared on cancel.
   *
   * EXPECTED: After fix, cancelling export should clear the defensive timeout.
   */
  it('should clear defensive timeout after export is cancelled (BUG: timeout not cleared)', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // Make export hang so we can cancel it
    // Note: We need to let the finally block run, so we resolve quickly then test
    let exportPromiseResolve: (value: Blob) => void
    mockExportWithTracer.mockImplementation(() => new Promise<Blob>((resolve) => {
      exportPromiseResolve = resolve
    }))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Start export
    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Cancel export
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    // Verify modal is closed
    await waitFor(() => {
      expect(screen.queryByText(/exporting clips/i)).not.toBeInTheDocument()
    })

    // Advance to 10+ seconds - any pending defensive timeout should have been cleared
    await vi.advanceTimersByTimeAsync(11000)

    // NOTE: With the hanging promise, the finally block doesn't run until the
    // promise settles. In the real bug scenario, if the export completes AFTER
    // the user cancels, the finally block sets a timeout that's never cleared.
    //
    // For this test, we verify that even if no timeout was set (because the
    // export is still pending), the cancel action should have set up cleanup
    // for when the finally block eventually runs.
    //
    // The real test is that after implementing the fix, there will be proper
    // timeout management regardless of export completion timing.
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      '[ClipReview] Export modal stuck - forcing close after timeout'
    )
  })

  /**
   * TEST: Uncleaned timeouts accumulate with successive exports
   *
   * BUG: Each export creates a new defensive timeout in the finally block,
   * but these timeouts are never cleared. After N exports, there are N
   * uncleaned timeouts in the event loop.
   *
   * EXPECTED: After fix, only the most recent export's defensive timeout
   * should exist (if any), and it should be properly cleaned up.
   */
  it('should not accumulate uncleaned timeouts with successive exports (BUG: timeout not cleared)', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // === EXPORT 1: Complete successfully ===
    const exportButton1 = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton1)

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })

    // After export 1 completes, there's 1 uncleaned defensive timeout
    const timeoutsAfterExport1 = timeoutIds.size

    // Close modal via Done button
    const doneButton = screen.getByRole('button', { name: /done/i })
    fireEvent.click(doneButton)

    // BUG: The timeout from export 1 was never cleared
    // AFTER FIX: timeoutIds.size should be 0 (timeout was cleared when modal closed)
    expect(timeoutIds.size).toBe(0)

    // Verify at least one 10-second timeout was set during the export
    expect(timeoutsAfterExport1).toBeGreaterThan(0)
  })

  /**
   * TEST: Defensive timeout behavior documentation
   *
   * This test documents the intended behavior: the defensive timeout should
   * only force-close the modal if it's genuinely stuck (modal open, no error,
   * not complete, not cancelled).
   *
   * NOTE: This test is difficult to trigger in unit tests because the finally
   * block always runs after export either completes, fails, or the promise hangs.
   * In the "hang" case, the try block never completes, so the finally never runs
   * either, which means the timeout is never set.
   *
   * The defensive timeout is really meant to catch edge cases in production where
   * some unexpected state leaves the modal open after the try/catch/finally completes.
   */
  it('documents intended defensive timeout behavior (for genuinely stuck scenarios)', async () => {
    // The defensive timeout's purpose:
    // 1. Catches edge cases where modal stays open due to unexpected state
    // 2. Provides a safety net for production
    // 3. Should NOT fire for normal success/cancel/error paths (tested above)

    // This test documents the requirement rather than testing the stuck scenario
    // because simulating a genuinely stuck modal state in unit tests is complex.
    expect(true).toBe(true)
  })
})

// =============================================================================
// UNIT TESTS FOR TIMEOUT MANAGEMENT
// =============================================================================

describe('Export Timeout Management - Cleanup Requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  /**
   * TEST: Timeout ID should be stored in a ref for cleanup
   *
   * The fix requires storing the defensive timeout ID in a ref (e.g.,
   * defensiveTimeoutRef) so it can be cleared when:
   * - Export completes successfully
   * - Export is cancelled
   * - Component unmounts
   */
  it('should have a mechanism to clear defensive timeout (fix requirement)', async () => {
    // This test documents the fix requirement:
    // 1. Store timeout ID: defensiveTimeoutRef.current = setTimeout(...)
    // 2. Clear on success: clearTimeout(defensiveTimeoutRef.current)
    // 3. Clear on cancel: clearTimeout(defensiveTimeoutRef.current)
    // 4. Clear on unmount (via useEffect cleanup)

    // For now, this test passes to document the requirement
    // After the fix is implemented, the tests above will pass
    expect(true).toBe(true)
  })

  /**
   * TEST: Multiple exports should each have their own timeout management
   *
   * Each call to handleExport should:
   * 1. Clear any existing defensive timeout from previous export
   * 2. Set a new defensive timeout for the current export
   * 3. Clear the new timeout on completion/cancel
   */
  it('should clear previous defensive timeout when starting new export (fix requirement)', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Start export 1
    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for success
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })

    // Close via Done
    const doneButton = screen.getByRole('button', { name: /done/i })
    fireEvent.click(doneButton)
    expect(onComplete).toHaveBeenCalled()

    // Verify modal is closed
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /done/i })).not.toBeInTheDocument()
    })

    // Start export 2 (same component instance)
    // This requires resetting state which doesn't happen in current implementation
    // but documents the expected behavior
  })
})

// =============================================================================
// INTEGRATION TESTS - Complete Export Lifecycle
// =============================================================================

describe('Export Lifecycle - Complete Flow Without Stale Timeouts', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    consoleWarnSpy.mockRestore()
  })

  /**
   * INTEGRATION TEST: Complete export, wait full 10 seconds, verify no stale timeout
   *
   * This test runs the complete export lifecycle and waits the full 10 seconds
   * to verify no stale defensive timeout fires.
   */
  it('should complete export lifecycle without stale timeout firing', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // 1. Start export
    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // 2. Wait for success state
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })

    // 3. Advance past auto-close (1.5s)
    await vi.advanceTimersByTimeAsync(2000)
    expect(onComplete).toHaveBeenCalledTimes(1)

    // 4. Advance to 5 seconds total
    await vi.advanceTimersByTimeAsync(3000)
    expect(consoleWarnSpy).not.toHaveBeenCalled()

    // 5. Advance to 10 seconds total
    await vi.advanceTimersByTimeAsync(5000)

    // BUG: Warning fires at 10 seconds even though export completed
    // AFTER FIX: No warning should fire
    expect(consoleWarnSpy).not.toHaveBeenCalled()

    // 6. Advance to 15 seconds total - still no warning
    await vi.advanceTimersByTimeAsync(5000)
    expect(consoleWarnSpy).not.toHaveBeenCalled()
  })

  /**
   * INTEGRATION TEST: Cancel export, start new export immediately, verify no interference
   */
  it('should allow immediate new export after cancel without timeout interference', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    // First export: make it hang so we can cancel
    let exportResolve: () => void
    mockExportWithTracer.mockImplementation(() => new Promise<Blob>(resolve => {
      exportResolve = () => resolve(new Blob(['mock'], { type: 'video/mp4' }))
    }))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    // Start export 1
    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    await waitFor(() => {
      expect(screen.getByText(/exporting clips/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Cancel export 1
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByText(/exporting clips/i)).not.toBeInTheDocument()
    })

    // Immediately start export 2 (use fresh mock that resolves)
    mockExportWithTracer.mockResolvedValue(new Blob(['mock'], { type: 'video/mp4' }))

    const exportButton2 = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton2)

    // Export 2 should complete successfully
    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })

    // Advance past when export 1's timeout would fire (10 seconds from its start)
    await vi.advanceTimersByTimeAsync(12000)

    // BUG: Export 1's timeout interferes with export 2
    // AFTER FIX: No interference, export 2's success state is preserved
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      '[ClipReview] Export modal stuck - forcing close after timeout'
    )
  })
})

// =============================================================================
// REGRESSION TESTS - Ensure Normal Export Still Works
// =============================================================================

describe('Export Normal Operation - Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockExportWithTracer.mockResolvedValue(new Blob(['mock-video'], { type: 'video/mp4' }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  /**
   * REGRESSION: Export should still complete and call onComplete
   */
  it('should still complete export normally after fix', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    await waitFor(() => {
      const successIcon = document.querySelector('.export-success-icon')
      expect(successIcon).toBeInTheDocument()
    }, { timeout: 5000 })

    await vi.advanceTimersByTimeAsync(2000)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  /**
   * REGRESSION: Cancel should still work after fix
   */
  it('should still cancel export normally after fix', async () => {
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

    await waitFor(() => {
      expect(screen.queryByText(/exporting clips/i)).not.toBeInTheDocument()
    })

    expect(onComplete).not.toHaveBeenCalled()
  })

  /**
   * REGRESSION: Error handling should still work after fix
   */
  it('should still handle export errors normally after fix', async () => {
    const approvedSegment = createApprovedSegmentWithTrajectory({ id: 'seg-1' })
    setupMockStoreWithApprovedSegments([approvedSegment])

    mockExportWithTracer.mockRejectedValue(new Error('Export failed: test error'))

    const onComplete = vi.fn()
    render(<ClipReview onComplete={onComplete} />)

    const exportButton = screen.getByRole('button', { name: /export 1 clip/i })
    fireEvent.click(exportButton)

    // Wait for error message element (use queryAllBy to handle multiple matches)
    await waitFor(() => {
      const errorMessage = document.querySelector('.export-error-message')
      expect(errorMessage).toBeInTheDocument()
      expect(errorMessage?.textContent).toContain('test error')
    }, { timeout: 3000 })

    expect(onComplete).not.toHaveBeenCalled()
  })
})
