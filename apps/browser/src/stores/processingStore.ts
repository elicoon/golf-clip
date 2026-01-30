/**
 * Processing Store
 *
 * Zustand store for managing video processing state.
 * Tracks progress, detected strikes, and extracted video segments.
 */

import { create } from 'zustand'
import { StrikeDetection } from '../lib/audio-detector'

export interface VideoSegment {
  id: string
  strikeTime: number
  blob: Blob
  objectUrl: string
}

interface ProcessingState {
  // Status
  status: 'idle' | 'loading' | 'processing' | 'ready' | 'error'
  error: string | null

  // Progress
  progress: number // 0-100
  progressMessage: string

  // Results
  strikes: StrikeDetection[]
  segments: VideoSegment[]
  currentSegmentIndex: number

  // File info
  fileName: string | null
  fileDuration: number | null

  // Actions
  setStatus: (status: ProcessingState['status']) => void
  setError: (error: string | null) => void
  setProgress: (progress: number, message?: string) => void
  addStrike: (strike: StrikeDetection) => void
  addSegment: (segment: VideoSegment) => void
  setCurrentSegment: (index: number) => void
  setFileInfo: (name: string, duration: number) => void
  reset: () => void
}

export const useProcessingStore = create<ProcessingState>((set) => ({
  status: 'idle',
  error: null,
  progress: 0,
  progressMessage: '',
  strikes: [],
  segments: [],
  currentSegmentIndex: 0,
  fileName: null,
  fileDuration: null,

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
  setProgress: (progress, message) => set({
    progress,
    progressMessage: message ?? ''
  }),
  addStrike: (strike) => set((state) => ({
    strikes: [...state.strikes, strike]
  })),
  addSegment: (segment) => set((state) => ({
    segments: [...state.segments, segment]
  })),
  setCurrentSegment: (index) => set({ currentSegmentIndex: index }),
  setFileInfo: (name, duration) => set({ fileName: name, fileDuration: duration }),
  reset: () => set({
    status: 'idle',
    error: null,
    progress: 0,
    progressMessage: '',
    strikes: [],
    segments: [],
    currentSegmentIndex: 0,
    fileName: null,
    fileDuration: null,
  }),
}))
