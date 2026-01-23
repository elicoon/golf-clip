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

interface AppState {
  currentJob: Job | null
  shots: DetectedShot[]
  setCurrentJob: (job: Job | null) => void
  setShots: (shots: DetectedShot[]) => void
  updateShot: (id: number, updates: Partial<DetectedShot>) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentJob: null,
  shots: [],

  setCurrentJob: (job) => set({ currentJob: job }),

  setShots: (shots) => set({ shots }),

  updateShot: (id, updates) =>
    set((state) => ({
      shots: state.shots.map((shot) =>
        shot.id === id ? { ...shot, ...updates } : shot
      ),
    })),
}))
