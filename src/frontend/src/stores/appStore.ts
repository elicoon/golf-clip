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

interface AppState {
  currentJob: Job | null
  shots: DetectedShot[]
  trajectories: Record<number, Trajectory>
  setCurrentJob: (job: Job | null) => void
  setShots: (shots: DetectedShot[]) => void
  updateShot: (id: number, updates: Partial<DetectedShot>) => void
  setTrajectory: (shotId: number, trajectory: Trajectory) => void
  clearTrajectories: () => void
}

export const useAppStore = create<AppState>((set) => ({
  currentJob: null,
  shots: [],
  trajectories: {},

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
}))
