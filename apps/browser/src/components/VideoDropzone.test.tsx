/**
 * VideoDropzone Tests
 *
 * Tests for the VideoDropzone component including:
 * - Basic rendering
 * - File upload handling
 * - HEVC detection marking files as errors (for background processing)
 *
 * Note: The HEVC modal functionality was replaced with error marking when
 * multi-file background processing was implemented. HEVC files are now
 * marked with an error status instead of showing an interactive modal.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { VideoDropzone } from './VideoDropzone'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Track mock calls for assertions - use vi.hoisted to make available in vi.mock
const { mockAddVideo, mockSetVideoError } = vi.hoisted(() => ({
  mockAddVideo: vi.fn(),
  mockSetVideoError: vi.fn(),
}))

// Mock ffmpeg-client
vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  detectVideoCodec: vi.fn(),
  transcodeHevcToH264: vi.fn(),
  estimateTranscodeTime: vi.fn().mockReturnValue({
    minMinutes: 2,
    maxMinutes: 4,
    formatted: '2-4 minutes',
  }),
  formatRemainingTime: vi.fn().mockReturnValue('2 min remaining'),
  SUPPORTED_CODECS: ['H.264', 'VP8', 'VP9'],
}))

// Mock streaming-processor
vi.mock('../lib/streaming-processor', () => ({
  processVideoFile: vi.fn().mockResolvedValue(undefined),
}))

// Mock the store - need both hook return and getState for processFileInBackground
vi.mock('../stores/processingStore', () => {
  const mockStoreState = {
    status: 'idle',
    progress: 0,
    progressMessage: '',
    fileName: '',
    setProgress: vi.fn(),
    setStatus: vi.fn(),
    addVideo: mockAddVideo,
    setVideoError: mockSetVideoError,
  }

  const mockUseProcessingStore = Object.assign(() => mockStoreState, {
    getState: () => mockStoreState,
  })

  return {
    useProcessingStore: mockUseProcessingStore,
  }
})

describe('VideoDropzone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders dropzone initially', () => {
    render(<VideoDropzone />)
    expect(screen.getByText('Drop your golf video here')).toBeInTheDocument()
    expect(screen.getByText('Select File')).toBeInTheDocument()
  })

  describe('file upload handling', () => {
    it('processes valid video files via background processing', async () => {
      const { detectVideoCodec } = await import('../lib/ffmpeg-client')
      const { processVideoFile } = await import('../lib/streaming-processor')

      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'h264',
        isHevc: false,
        isPlayable: true,
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mp4', { type: 'video/mp4' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(mockAddVideo).toHaveBeenCalledWith(expect.any(String), 'test.mp4')
      })

      await waitFor(() => {
        expect(processVideoFile).toHaveBeenCalledWith(file, expect.any(String))
      })
    })

    it('marks HEVC files as errors in background processing mode', async () => {
      const { detectVideoCodec } = await import('../lib/ffmpeg-client')
      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'hevc',
        isHevc: true,
        isPlayable: false,
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mov', { type: 'video/quicktime' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      // Should add video first
      await waitFor(() => {
        expect(mockAddVideo).toHaveBeenCalledWith(expect.any(String), 'test.mov')
      })

      // Then mark it as error due to HEVC
      await waitFor(() => {
        expect(mockSetVideoError).toHaveBeenCalledWith(
          expect.any(String),
          'HEVC codec detected - needs transcoding',
        )
      })
    })

    it('handles multiple file uploads', async () => {
      const { detectVideoCodec } = await import('../lib/ffmpeg-client')
      const { processVideoFile } = await import('../lib/streaming-processor')

      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'h264',
        isHevc: false,
        isPlayable: true,
      })

      render(<VideoDropzone />)

      const file1 = new File(['video1'], 'test1.mp4', { type: 'video/mp4' })
      const file2 = new File(['video2'], 'test2.mp4', { type: 'video/mp4' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file1, file2] } })

      await waitFor(() => {
        expect(mockAddVideo).toHaveBeenCalledTimes(2)
      })

      await waitFor(() => {
        expect(processVideoFile).toHaveBeenCalledTimes(2)
      })
    })

    it('skips invalid file types', async () => {
      render(<VideoDropzone />)

      // Create an invalid file type
      const file = new File(['text'], 'test.txt', { type: 'text/plain' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      // Should not call addVideo for invalid file
      await waitFor(() => {
        expect(mockAddVideo).not.toHaveBeenCalled()
      })
    })
  })
})
