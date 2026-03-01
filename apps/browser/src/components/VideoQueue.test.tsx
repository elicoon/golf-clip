// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { VideoQueue } from './VideoQueue'
import type { VideoState } from '../stores/processingStore'

expect.extend(matchers)

const mockSetActiveVideo = vi.fn()

vi.mock('../stores/processingStore', () => ({
  useProcessingStore: vi.fn(),
}))

import { useProcessingStore } from '../stores/processingStore'

function makeVideo(overrides: Partial<VideoState> = {}): VideoState {
  return {
    id: 'vid-1',
    fileName: 'shot.mp4',
    fileDuration: null,
    status: 'ready',
    error: null,
    progress: 0,
    progressMessage: '',
    strikes: [],
    segments: [],
    currentSegmentIndex: 0,
    ...overrides,
  }
}

function setupStore(videos: VideoState[], activeVideoId: string | null = null) {
  const map = new Map(videos.map(v => [v.id, v]))
  vi.mocked(useProcessingStore).mockReturnValue({
    videos: map,
    activeVideoId,
    setActiveVideo: mockSetActiveVideo,
  } as ReturnType<typeof useProcessingStore>)
}

describe('VideoQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when queue is empty', () => {
    setupStore([])
    const { container } = render(<VideoQueue />)
    expect(container.firstChild).toBeNull()
  })

  it('shows video count in heading', () => {
    setupStore([makeVideo({ id: 'v1' }), makeVideo({ id: 'v2' })])
    render(<VideoQueue />)
    expect(screen.getByText('Videos (2)')).toBeInTheDocument()
  })

  it('renders file name for each video', () => {
    setupStore([
      makeVideo({ id: 'v1', fileName: 'round1.mp4' }),
      makeVideo({ id: 'v2', fileName: 'round2.mp4' }),
    ])
    render(<VideoQueue />)
    expect(screen.getByTitle('round1.mp4')).toBeInTheDocument()
    expect(screen.getByTitle('round2.mp4')).toBeInTheDocument()
  })

  it('shows "OK" status icon for ready video', () => {
    setupStore([makeVideo({ status: 'ready' })])
    render(<VideoQueue />)
    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('shows "!" status icon for error video', () => {
    setupStore([makeVideo({ status: 'error', error: 'Failed to load' })])
    render(<VideoQueue />)
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('shows "*" status icon for processing video', () => {
    setupStore([makeVideo({ status: 'processing', progress: 45 })])
    render(<VideoQueue />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('shows "..." status icon for pending video', () => {
    setupStore([makeVideo({ status: 'pending' })])
    render(<VideoQueue />)
    const icons = screen.getAllByText('...')
    expect(icons.length).toBeGreaterThanOrEqual(1)
  })

  it('shows progress percentage for processing video', () => {
    setupStore([makeVideo({ status: 'processing', progress: 72 })])
    render(<VideoQueue />)
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('shows shot count for ready video with segments', () => {
    const video = makeVideo({
      status: 'ready',
      segments: [{ id: 's1' } as never, { id: 's2' } as never],
    })
    setupStore([video])
    render(<VideoQueue />)
    expect(screen.getByText('2 shots')).toBeInTheDocument()
  })

  it('shows singular "shot" for ready video with 1 segment', () => {
    const video = makeVideo({
      status: 'ready',
      segments: [{ id: 's1' } as never],
    })
    setupStore([video])
    render(<VideoQueue />)
    expect(screen.getByText('1 shot')).toBeInTheDocument()
  })

  it('shows Error label for error video', () => {
    setupStore([makeVideo({ status: 'error', error: 'Something went wrong' })])
    render(<VideoQueue />)
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('shows progress percentage for loading video', () => {
    setupStore([makeVideo({ status: 'loading', progress: 30 })])
    render(<VideoQueue />)
    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('marks active video with queue-item-active class', () => {
    setupStore([makeVideo({ id: 'v1', fileName: 'shot.mp4' })], 'v1')
    render(<VideoQueue />)
    expect(screen.getByRole('button', { name: /shot\.mp4/i })).toHaveClass('queue-item-active')
  })

  it('calls setActiveVideo when a video item is clicked', () => {
    setupStore([makeVideo({ id: 'v1', fileName: 'clip.mp4' })])
    render(<VideoQueue />)

    fireEvent.click(screen.getByTitle('clip.mp4'))

    expect(mockSetActiveVideo).toHaveBeenCalledTimes(1)
    expect(mockSetActiveVideo).toHaveBeenCalledWith('v1')
  })
})
