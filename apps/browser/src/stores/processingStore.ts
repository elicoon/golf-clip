/**
 * Processing Store
 *
 * Zustand store for managing video processing state.
 * Tracks progress, detected strikes, and extracted video segments.
 *
 * Supports both legacy single-video mode and multi-video tracking via
 * Map<VideoId, VideoState> for independent parallel processing.
 */

import { create } from 'zustand'
import { StrikeDetection } from '../lib/audio-detector'

/** Unique identifier for each video being processed */
export type VideoId = string

/** Per-video processing state */
export interface VideoState {
  id: VideoId
  fileName: string
  fileDuration: number | null
  status: 'pending' | 'loading' | 'processing' | 'ready' | 'error'
  error: string | null
  progress: number
  progressMessage: string
  strikes: StrikeDetection[]
  segments: VideoSegment[]
  currentSegmentIndex: number
}

/** Creates a new VideoState with default values */
export function createVideoState(id: VideoId, fileName: string): VideoState {
  return {
    id,
    fileName,
    fileDuration: null,
    status: 'pending',
    error: null,
    progress: 0,
    progressMessage: '',
    strikes: [],
    segments: [],
    currentSegmentIndex: 0,
  }
}

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
  approved: 'pending' | 'approved' | 'rejected'  // user approval state
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

  // Multi-video support
  videos: Map<VideoId, VideoState>
  activeVideoId: VideoId | null  // Currently displayed video

  // Legacy single-video actions
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

  // Multi-video actions
  addVideo: (id: VideoId, fileName: string) => void
  removeVideo: (id: VideoId) => void
  setActiveVideo: (id: VideoId | null) => void
  updateVideoState: (id: VideoId, updates: Partial<VideoState>) => void
  setVideoProgress: (id: VideoId, progress: number, message?: string) => void
  setVideoStatus: (id: VideoId, status: VideoState['status']) => void
  setVideoError: (id: VideoId, error: string | null) => void
  addVideoStrike: (id: VideoId, strike: StrikeDetection) => void
  addVideoSegment: (id: VideoId, segment: Omit<VideoSegment, 'confidence' | 'clipStart' | 'clipEnd' | 'approved'> & Partial<Pick<VideoSegment, 'confidence' | 'clipStart' | 'clipEnd' | 'approved'>>) => void
  setVideoFileInfo: (id: VideoId, duration: number) => void
  updateVideoSegment: (id: VideoId, segmentId: string, updates: Partial<VideoSegment>) => void
  approveVideoSegment: (id: VideoId, segmentId: string) => void
  rejectVideoSegment: (id: VideoId, segmentId: string) => void
  getVideo: (id: VideoId) => VideoState | undefined
}

export const useProcessingStore = create<ProcessingState>((set, get) => ({
  status: 'idle',
  error: null,
  progress: 0,
  progressMessage: '',
  strikes: [],
  segments: [],
  currentSegmentIndex: 0,
  fileName: null,
  fileDuration: null,

  // Multi-video state
  videos: new Map<VideoId, VideoState>(),
  activeVideoId: null,

  // Legacy single-video actions
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
      approved: segment.approved ?? 'pending',
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
      seg.id === id ? { ...seg, approved: 'approved' } : seg
    )
  })),
  rejectSegment: (id) => set((state) => ({
    segments: state.segments.map(seg =>
      seg.id === id ? { ...seg, approved: 'rejected' } : seg
    )
  })),
  setFileInfo: (name, duration) => set({ fileName: name, fileDuration: duration }),

  // Multi-video actions
  addVideo: (id, fileName) => set((state) => {
    const newVideos = new Map(state.videos)
    newVideos.set(id, createVideoState(id, fileName))
    return {
      videos: newVideos,
      // If this is the first video, make it active
      activeVideoId: state.activeVideoId ?? id
    }
  }),

  removeVideo: (id) => set((state) => {
    const video = state.videos.get(id)
    if (video) {
      // Revoke object URLs for this video's segments
      video.segments.forEach(seg => URL.revokeObjectURL(seg.objectUrl))
    }
    const newVideos = new Map(state.videos)
    newVideos.delete(id)
    return {
      videos: newVideos,
      activeVideoId: state.activeVideoId === id
        ? (newVideos.keys().next().value ?? null)
        : state.activeVideoId
    }
  }),

  setActiveVideo: (id) => set({ activeVideoId: id }),

  updateVideoState: (id, updates) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, ...updates })
    return { videos: newVideos }
  }),

  setVideoProgress: (id, progress, message) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, progress, progressMessage: message ?? '' })
    return { videos: newVideos }
  }),

  setVideoStatus: (id, status) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, status })
    return { videos: newVideos }
  }),

  setVideoError: (id, error) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, error, status: error ? 'error' : video.status })
    return { videos: newVideos }
  }),

  addVideoStrike: (id, strike) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, strikes: [...video.strikes, strike] })
    return { videos: newVideos }
  }),

  addVideoSegment: (id, segment) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    const fullSegment: VideoSegment = {
      ...segment,
      confidence: segment.confidence ?? 0.5,
      clipStart: segment.clipStart ?? segment.startTime,
      clipEnd: segment.clipEnd ?? segment.endTime,
      approved: segment.approved ?? 'pending',
    }
    newVideos.set(id, { ...video, segments: [...video.segments, fullSegment] })
    return { videos: newVideos }
  }),

  setVideoFileInfo: (id, duration) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, { ...video, fileDuration: duration })
    return { videos: newVideos }
  }),

  updateVideoSegment: (id, segmentId, updates) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, {
      ...video,
      segments: video.segments.map(seg =>
        seg.id === segmentId ? { ...seg, ...updates } : seg
      )
    })
    return { videos: newVideos }
  }),

  approveVideoSegment: (id, segmentId) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, {
      ...video,
      segments: video.segments.map(seg =>
        seg.id === segmentId ? { ...seg, approved: 'approved' } : seg
      )
    })
    return { videos: newVideos }
  }),

  rejectVideoSegment: (id, segmentId) => set((state) => {
    const video = state.videos.get(id)
    if (!video) return state
    const newVideos = new Map(state.videos)
    newVideos.set(id, {
      ...video,
      segments: video.segments.map(seg =>
        seg.id === segmentId ? { ...seg, approved: 'rejected' } : seg
      )
    })
    return { videos: newVideos }
  }),

  getVideo: (id) => get().videos.get(id),

  // Updated reset to also clear multi-video state
  reset: () => {
    const state = useProcessingStore.getState()
    // Revoke URLs for legacy segments
    state.segments.forEach(seg => URL.revokeObjectURL(seg.objectUrl))
    // Revoke URLs for multi-video segments
    state.videos.forEach(video => {
      video.segments.forEach(seg => URL.revokeObjectURL(seg.objectUrl))
    })
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
      videos: new Map(),
      activeVideoId: null,
    })
  },
}))
