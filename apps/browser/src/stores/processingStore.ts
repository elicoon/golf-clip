/**
 * Processing Store
 *
 * Zustand store for managing video processing state.
 * Tracks progress, detected strikes, and extracted video segments.
 */

import { create } from 'zustand'
import { StrikeDetection } from '../lib/audio-detector'

export interface TrajectoryPoint {
  timestamp: number
  x: number
  y: number
  confidence: number
  interpolated: boolean
}

export interface TrajectoryData {
  shot_id: string
  points: TrajectoryPoint[]
  confidence: number
  apex_point?: TrajectoryPoint
  frame_width: number
  frame_height: number
}

export interface TracerConfig {
  height: 'low' | 'medium' | 'high'
  shape: 'hook' | 'draw' | 'straight' | 'fade' | 'slice'
  startingLine: 'left' | 'center' | 'right'
  flightTime: number
}

export interface VideoSegment {
  id: string
  strikeTime: number
  startTime: number  // segment start time
  endTime: number    // segment end time
  blob: Blob
  objectUrl: string
  confidence: number        // detection confidence (0-1)
  clipStart: number         // trimmed start time
  clipEnd: number           // trimmed end time
  approved: boolean         // user approved this shot
  landingPoint?: { x: number; y: number }  // marked landing point
  trajectory?: TrajectoryData              // generated trajectory
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
  addSegment: (segment: Omit<VideoSegment, 'confidence' | 'clipStart' | 'clipEnd' | 'approved'> & Partial<Pick<VideoSegment, 'confidence' | 'clipStart' | 'clipEnd' | 'approved'>>) => void
  setCurrentSegment: (index: number) => void
  setFileInfo: (name: string, duration: number) => void
  updateSegment: (id: string, updates: Partial<VideoSegment>) => void
  approveSegment: (id: string) => void
  rejectSegment: (id: string) => void
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
    segments: [...state.segments, {
      ...segment,
      confidence: segment.confidence ?? 0.5,
      clipStart: segment.clipStart ?? segment.startTime,
      clipEnd: segment.clipEnd ?? segment.endTime,
      approved: segment.approved ?? false,
    }]
  })),
  setCurrentSegment: (index) => set({ currentSegmentIndex: index }),
  updateSegment: (id, updates) => set((state) => ({
    segments: state.segments.map(seg =>
      seg.id === id ? { ...seg, ...updates } : seg
    )
  })),
  approveSegment: (id) => set((state) => ({
    segments: state.segments.map(seg =>
      seg.id === id ? { ...seg, confidence: 1.0, approved: true } : seg
    )
  })),
  rejectSegment: (id) => set((state) => ({
    segments: state.segments.map(seg =>
      seg.id === id ? { ...seg, confidence: 0, approved: false } : seg
    )
  })),
  setFileInfo: (name, duration) => set({ fileName: name, fileDuration: duration }),
  reset: () => {
    // Revoke object URLs before clearing segments
    const state = useProcessingStore.getState()
    state.segments.forEach(seg => URL.revokeObjectURL(seg.objectUrl))
    set({
      status: 'idle',
      error: null,
      progress: 0,
      progressMessage: '',
      strikes: [],
      segments: [],
      currentSegmentIndex: 0,
      fileName: null,
      fileDuration: null,
    })
  },
}))
