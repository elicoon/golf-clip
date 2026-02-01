/**
 * VideoDropzone HEVC Modal Integration Tests
 *
 * Tests for the HEVC warning modal including:
 * - Modal appearance with file info when HEVC detected
 * - Modal dismissal when choosing different video
 * - Progress display during transcoding
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { VideoDropzone } from './VideoDropzone'

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers)

// Mock ffmpeg-client
vi.mock('../lib/ffmpeg-client', () => ({
  loadFFmpeg: vi.fn().mockResolvedValue(undefined),
  detectVideoCodec: vi.fn(),
  transcodeHevcToH264: vi.fn(),
  estimateTranscodeTime: vi.fn().mockReturnValue({
    minMinutes: 2,
    maxMinutes: 4,
    formatted: '2-4 minutes'
  }),
  formatRemainingTime: vi.fn().mockReturnValue('2 min remaining'),
  SUPPORTED_CODECS: ['H.264', 'VP8', 'VP9'],
}))

// Mock streaming-processor
vi.mock('../lib/streaming-processor', () => ({
  processVideoFile: vi.fn().mockResolvedValue(undefined),
}))

// Mock the store
vi.mock('../stores/processingStore', () => ({
  useProcessingStore: () => ({
    status: 'idle',
    progress: 0,
    progressMessage: '',
    fileName: '',
    setProgress: vi.fn(),
    setStatus: vi.fn(),
  }),
}))

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

  describe('HEVC Modal', () => {
    it('shows modal with file info when HEVC detected', async () => {
      const { detectVideoCodec } = await import('../lib/ffmpeg-client')
      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'hevc',
        isHevc: true,
        isPlayable: false,
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mov', { type: 'video/quicktime' })
      Object.defineProperty(file, 'size', { value: 200 * 1024 * 1024 }) // 200MB

      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('Unsupported Video Format')).toBeInTheDocument()
      })

      expect(screen.getByText(/HEVC encoding/)).toBeInTheDocument()
      expect(screen.getByText(/200 MB/)).toBeInTheDocument()
      expect(screen.getByText('2-4 minutes')).toBeInTheDocument()
      expect(screen.getByText('Start Transcoding')).toBeInTheDocument()
      expect(screen.getByText('Upload Different Video')).toBeInTheDocument()
    })

    it('closes modal and resets when Upload Different Video clicked', async () => {
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

      await waitFor(() => {
        expect(screen.getByText('Unsupported Video Format')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Upload Different Video'))

      await waitFor(() => {
        expect(screen.queryByText('Unsupported Video Format')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Drop your golf video here')).toBeInTheDocument()
    })

    it('shows progress during transcoding', async () => {
      const { detectVideoCodec, transcodeHevcToH264 } = await import('../lib/ffmpeg-client')
      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'hevc',
        isHevc: true,
        isPlayable: false,
      })

      // Simulate slow transcode with progress - use a promise we can control
      let resolveTranscode: (value: Blob) => void
      vi.mocked(transcodeHevcToH264).mockImplementation(async (_blob, onProgress) => {
        onProgress?.(25)
        // Wait for external resolution to keep transcoding state active
        return new Promise<Blob>((resolve) => {
          resolveTranscode = resolve
        })
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mov', { type: 'video/quicktime' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('Start Transcoding')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Start Transcoding'))

      await waitFor(() => {
        expect(screen.getByText('Converting video...')).toBeInTheDocument()
      })

      // Verify the progress percentage is displayed in the DOM
      expect(screen.getByText('25%')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()

      // Complete the transcode to clean up
      resolveTranscode!(new Blob(['transcoded'], { type: 'video/mp4' }))
    })

    it('cancels transcoding and returns to initial modal state', async () => {
      const { detectVideoCodec, transcodeHevcToH264 } = await import('../lib/ffmpeg-client')
      vi.mocked(detectVideoCodec).mockResolvedValue({
        codec: 'hevc',
        isHevc: true,
        isPlayable: false,
      })

      // Simulate transcode that waits for abort signal
      vi.mocked(transcodeHevcToH264).mockImplementation(async (_blob, onProgress, signal) => {
        onProgress?.(25)
        // Wait until aborted
        return new Promise<Blob>((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const error = new Error('Aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
      })

      render(<VideoDropzone />)

      const file = new File(['video'], 'test.mov', { type: 'video/quicktime' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByText('Start Transcoding')).toBeInTheDocument()
      })

      // Start transcoding
      fireEvent.click(screen.getByText('Start Transcoding'))

      await waitFor(() => {
        expect(screen.getByText('Converting video...')).toBeInTheDocument()
      })

      // Click Cancel
      fireEvent.click(screen.getByText('Cancel'))

      // Verify modal returns to non-transcoding state
      await waitFor(() => {
        expect(screen.getByText('Start Transcoding')).toBeInTheDocument()
      })

      // Verify transcoding UI is gone
      expect(screen.queryByText('Converting video...')).not.toBeInTheDocument()
      expect(screen.getByText('Upload Different Video')).toBeInTheDocument()
    })
  })
})
