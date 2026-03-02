/**
 * App.tsx Tests
 *
 * Tests for the top-level App component including:
 * - Empty state when processing completes with zero shots detected
 * - Happy-path: segments present does not show empty state
 *
 * @vitest-environment jsdom
 */

/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import App from './App'
import type { VideoSegment } from './stores/processingStore'

expect.extend(matchers)

type StoreStatus = 'idle' | 'loading' | 'processing' | 'ready' | 'error'

interface MockStore {
  status: StoreStatus
  segments: VideoSegment[]
  error: string | null
  reset: ReturnType<typeof vi.fn>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  videos: Map<string, any>
  activeVideoId: string | null
}

// Stable mock reset fn
const { mockReset } = vi.hoisted(() => ({
  mockReset: vi.fn(),
}))

let mockStoreReturn: MockStore = {
  status: 'idle',
  segments: [],
  error: null,
  reset: mockReset,
  videos: new Map(),
  activeVideoId: null,
}

vi.mock('./stores/processingStore', () => ({
  useProcessingStore: () => mockStoreReturn,
}))

vi.mock('./components/VideoDropzone', () => ({
  VideoDropzone: () => <div data-testid="video-dropzone" />,
}))

vi.mock('./components/WalkthroughSteps', () => ({
  WalkthroughSteps: () => <div data-testid="walkthrough-steps" />,
}))

vi.mock('./components/ClipReview', () => ({
  ClipReview: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="clip-review">
      <button onClick={onComplete}>Complete</button>
    </div>
  ),
}))

const baseStore = (): MockStore => ({
  status: 'idle',
  segments: [],
  error: null,
  reset: mockReset,
  videos: new Map(),
  activeVideoId: null,
})

describe('App — zero-shots empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreReturn = baseStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows no-shots message when status is ready with empty segments', () => {
    mockStoreReturn = { ...baseStore(), status: 'ready', segments: [] }

    render(<App />)

    expect(screen.getByText('No shots detected')).toBeInTheDocument()
    expect(screen.getByText('No golf shot sounds were detected in your video')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Another Video' })).toBeInTheDocument()
  })

  it('does not navigate away from upload view when segments is empty', () => {
    mockStoreReturn = { ...baseStore(), status: 'ready', segments: [] }

    render(<App />)

    expect(screen.getByTestId('video-dropzone')).toBeInTheDocument()
    expect(screen.queryByTestId('clip-review')).not.toBeInTheDocument()
  })

  it('calls reset when Try Another Video is clicked', () => {
    mockStoreReturn = { ...baseStore(), status: 'ready', segments: [] }

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Try Another Video' }))

    expect(mockReset).toHaveBeenCalledTimes(1)
  })

  it('does not show no-shots message when status is idle', () => {
    mockStoreReturn = { ...baseStore(), status: 'idle', segments: [] }

    render(<App />)

    expect(screen.queryByText('No shots detected')).not.toBeInTheDocument()
  })

  it('does not show no-shots message when status is processing', () => {
    mockStoreReturn = { ...baseStore(), status: 'processing', segments: [] }

    render(<App />)

    expect(screen.queryByText('No shots detected')).not.toBeInTheDocument()
  })
})

describe('App — happy path with segments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreReturn = baseStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not show no-shots message when segments are present and status is ready', () => {
    mockStoreReturn = {
      ...baseStore(),
      status: 'ready',
      segments: [{ id: 'seg-1', approved: 'pending' } as VideoSegment],
    }

    render(<App />)

    expect(screen.queryByText('No shots detected')).not.toBeInTheDocument()
  })
})
