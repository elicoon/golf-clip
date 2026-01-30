import { create } from 'zustand'

interface VideoInfo {
  path: string
  duration: number
  width: number
  height: number
  fps: number
}

interface Job {
  job_id: string
  video_info: VideoInfo
  status: string
}

interface DetectedShot {
  id: number
  strike_time: number
  landing_time: number | null
  clip_start: number
  clip_end: number
  confidence: number
  confidence_reasons: string[]
  audio_confidence: number
  visual_confidence: number
}

interface TrajectoryPoint {
  timestamp: number
  x: number
  y: number
  confidence: number
  interpolated: boolean
}

interface Trajectory {
  shot_id: number
  points: TrajectoryPoint[]
  confidence: number
  apex_point?: TrajectoryPoint
  is_manual_override: boolean
  frame_width: number
  frame_height: number
}

// Video queue item for multi-video processing
interface QueuedVideo {
  filename: string
  path: string
  size: number
  status: 'pending' | 'processing' | 'complete' | 'error'
  jobId?: string
  error?: string
}

interface AppState {
  currentJob: Job | null
  shots: DetectedShot[]
  trajectories: Record<number, Trajectory>

  // Video queue for multi-video upload
  videoQueue: QueuedVideo[]
  currentQueueIndex: number

  setCurrentJob: (job: Job | null) => void
  setShots: (shots: DetectedShot[]) => void
  updateShot: (id: number, updates: Partial<DetectedShot>) => void
  setTrajectory: (shotId: number, trajectory: Trajectory) => void
  clearTrajectories: () => void

  // Video queue actions
  setVideoQueue: (videos: QueuedVideo[]) => void
  addToQueue: (videos: QueuedVideo[]) => void
  addVideoToQueue: (video: QueuedVideo) => boolean
  updateQueueItem: (index: number, updates: Partial<QueuedVideo>) => void
  setCurrentQueueIndex: (index: number) => void
  advanceQueue: () => void
  clearQueue: () => void
  getCurrentQueueVideo: () => QueuedVideo | null
  getQueueStats: () => { total: number; completed: number; pending: number; current: number }
}

export const useAppStore = create<AppState>((set, get) => ({
  currentJob: null,
  shots: [],
  trajectories: {},
  videoQueue: [],
  currentQueueIndex: 0,

  setCurrentJob: (job) => set({ currentJob: job }),

  setShots: (shots) => set({ shots }),

  updateShot: (id, updates) =>
    set((state) => ({
      shots: state.shots.map((shot) =>
        shot.id === id ? { ...shot, ...updates } : shot
      ),
    })),

  setTrajectory: (shotId, trajectory) => set((state) => ({
    trajectories: { ...state.trajectories, [shotId]: trajectory }
  })),

  clearTrajectories: () => set({ trajectories: {} }),

  // Video queue actions
  setVideoQueue: (videos) => set({
    videoQueue: videos,
    currentQueueIndex: 0,
  }),

  addToQueue: (videos) => set((state) => ({
    videoQueue: [...state.videoQueue, ...videos],
  })),

  addVideoToQueue: (video) => {
    const state = get()
    const isFirst = state.videoQueue.length === 0 && state.currentQueueIndex === 0

    set((state) => ({
      videoQueue: [...state.videoQueue, video],
    }))

    return isFirst
  },

  updateQueueItem: (index, updates) => set((state) => ({
    videoQueue: state.videoQueue.map((video, i) =>
      i === index ? { ...video, ...updates } : video
    ),
  })),

  setCurrentQueueIndex: (index) => set({ currentQueueIndex: index }),

  // Note: index can equal videoQueue.length to signal "queue complete"
  // getCurrentQueueVideo returns null in this case, which is the intended behavior
  advanceQueue: () => set((state) => ({
    currentQueueIndex: Math.min(state.currentQueueIndex + 1, state.videoQueue.length),
  })),

  clearQueue: () => set({
    videoQueue: [],
    currentQueueIndex: 0,
  }),

  getCurrentQueueVideo: () => {
    const state = get()
    if (state.videoQueue.length === 0 || state.currentQueueIndex >= state.videoQueue.length) {
      return null
    }
    return state.videoQueue[state.currentQueueIndex]
  },

  getQueueStats: () => {
    const state = get()
    const total = state.videoQueue.length
    const completed = state.videoQueue.filter(v => v.status === 'complete').length
    const pending = state.videoQueue.filter(v => v.status === 'pending').length
    return {
      total,
      completed,
      pending,
      current: state.currentQueueIndex + 1,
    }
  },
}))
