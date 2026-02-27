// apps/browser/src/lib/feedback-service.ts
import { getSupabaseClient } from './supabase-client'
import { TracerStyle } from '../types/tracer'
import { createLogger } from './logger'

const log = createLogger('feedback-service')

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
  tracerStyle?: TracerStyle
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
const SESSION_ID = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)

export interface FeedbackResult {
  success: boolean
  error?: string
}

export async function submitShotFeedback(feedback: Omit<ShotFeedback, 'sessionId'>): Promise<FeedbackResult> {
  const client = getSupabaseClient()
  if (!client) {
    log.warn('Supabase not configured, skipping feedback submission')
    return { success: true }
  }

  const { error } = await client.from('shot_feedback').insert({
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
    log.error('Failed to submit shot feedback', { error: error.message })
    return { success: false, error: "Feedback couldn't be saved — check your connection" }
  }

  return { success: true }
}

export async function submitTracerFeedback(feedback: Omit<TracerFeedback, 'sessionId'>): Promise<FeedbackResult> {
  const client = getSupabaseClient()
  if (!client) {
    log.warn('Supabase not configured, skipping feedback submission')
    return { success: true }
  }

  const { error } = await client.from('tracer_feedback').insert({
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
    log.error('Failed to submit tracer feedback', { error: error.message })
    return { success: false, error: "Feedback couldn't be saved — check your connection" }
  }

  return { success: true }
}
