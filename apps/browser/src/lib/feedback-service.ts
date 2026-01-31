// apps/browser/src/lib/feedback-service.ts
import { supabase, isSupabaseConfigured } from './supabase-client'

interface ShotFeedback {
  sessionId: string
  videoHash?: string
  shotIndex: number
  feedbackType: 'TRUE_POSITIVE' | 'FALSE_POSITIVE'
  confidence?: number
  audioConfidence?: number
  clipStart?: number
  clipEnd?: number
  userAdjustedStart?: number
  userAdjustedEnd?: number
}

interface TracerFeedback {
  sessionId: string
  shotIndex: number
  feedbackType: 'AUTO_ACCEPTED' | 'CONFIGURED' | 'RELUCTANT_ACCEPT' | 'SKIP' | 'REJECTED'
  autoParams?: TracerParams
  finalParams: TracerParams
  tracerStyle?: Record<string, unknown>
}

interface TracerParams {
  originX?: number
  originY?: number
  landingX?: number
  landingY?: number
  apexX?: number
  apexY?: number
  shape?: string
  height?: string
  flightTime?: number
  startingLine?: string
}

// Generate session ID once per browser session
const SESSION_ID = crypto.randomUUID()

export async function submitShotFeedback(feedback: Omit<ShotFeedback, 'sessionId'>): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, skipping feedback submission')
    return
  }

  const { error } = await supabase!.from('shot_feedback').insert({
    session_id: SESSION_ID,
    video_hash: feedback.videoHash,
    shot_index: feedback.shotIndex,
    feedback_type: feedback.feedbackType,
    confidence: feedback.confidence,
    audio_confidence: feedback.audioConfidence,
    clip_start: feedback.clipStart,
    clip_end: feedback.clipEnd,
    user_adjusted_start: feedback.userAdjustedStart,
    user_adjusted_end: feedback.userAdjustedEnd,
  })

  if (error) {
    console.error('Failed to submit shot feedback:', error)
  }
}

export async function submitTracerFeedback(feedback: Omit<TracerFeedback, 'sessionId'>): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, skipping feedback submission')
    return
  }

  const { error } = await supabase!.from('tracer_feedback').insert({
    session_id: SESSION_ID,
    shot_index: feedback.shotIndex,
    feedback_type: feedback.feedbackType,
    auto_origin_x: feedback.autoParams?.originX,
    auto_origin_y: feedback.autoParams?.originY,
    auto_landing_x: feedback.autoParams?.landingX,
    auto_landing_y: feedback.autoParams?.landingY,
    auto_apex_x: feedback.autoParams?.apexX,
    auto_apex_y: feedback.autoParams?.apexY,
    auto_shape: feedback.autoParams?.shape,
    auto_height: feedback.autoParams?.height,
    auto_flight_time: feedback.autoParams?.flightTime,
    auto_starting_line: feedback.autoParams?.startingLine,
    final_origin_x: feedback.finalParams.originX,
    final_origin_y: feedback.finalParams.originY,
    final_landing_x: feedback.finalParams.landingX,
    final_landing_y: feedback.finalParams.landingY,
    final_apex_x: feedback.finalParams.apexX,
    final_apex_y: feedback.finalParams.apexY,
    final_shape: feedback.finalParams.shape,
    final_height: feedback.finalParams.height,
    final_flight_time: feedback.finalParams.flightTime,
    final_starting_line: feedback.finalParams.startingLine,
    tracer_style: feedback.tracerStyle,
  })

  if (error) {
    console.error('Failed to submit tracer feedback:', error)
  }
}
