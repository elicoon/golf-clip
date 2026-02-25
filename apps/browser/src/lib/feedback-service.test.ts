import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase-client before importing feedback-service
const mockInsert = vi.fn()
const mockFrom = vi.fn(() => ({ insert: mockInsert }))

vi.mock('./supabase-client', () => ({
  getSupabaseClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

import { submitShotFeedback, submitTracerFeedback } from './feedback-service'
import { getSupabaseClient } from './supabase-client'

describe('submitShotFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })
  })

  it('submits shot feedback to Supabase', async () => {
    const result = await submitShotFeedback({
      shotIndex: 0,
      feedbackType: 'TRUE_POSITIVE',
      confidence: 0.9,
    })

    expect(result.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('shot_feedback')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shot_index: 0,
        feedback_type: 'TRUE_POSITIVE',
        confidence: 0.9,
      }),
    )
  })

  it('returns error when insert fails', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'Connection error' } })

    const result = await submitShotFeedback({
      shotIndex: 0,
      feedbackType: 'FALSE_POSITIVE',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns success when Supabase is not configured', async () => {
    vi.mocked(getSupabaseClient).mockReturnValueOnce(null)

    const result = await submitShotFeedback({
      shotIndex: 0,
      feedbackType: 'TRUE_POSITIVE',
    })

    expect(result.success).toBe(true)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('includes all optional fields when provided', async () => {
    await submitShotFeedback({
      shotIndex: 2,
      feedbackType: 'TRUE_POSITIVE',
      videoHash: 'abc123',
      confidence: 0.85,
      audioConfidence: 0.9,
      clipStart: 5.0,
      clipEnd: 15.0,
      userAdjustedStart: 4.5,
      userAdjustedEnd: 15.5,
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        video_hash: 'abc123',
        audio_confidence: 0.9,
        clip_start: 5.0,
        clip_end: 15.0,
        user_adjusted_start: 4.5,
        user_adjusted_end: 15.5,
      }),
    )
  })
})

describe('submitTracerFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert: mockInsert })
  })

  it('submits tracer feedback with auto and final params', async () => {
    const result = await submitTracerFeedback({
      shotIndex: 1,
      feedbackType: 'CONFIGURED',
      autoParams: {
        originX: 0.3,
        originY: 0.8,
        landingX: 0.7,
        landingY: 0.2,
      },
      finalParams: {
        originX: 0.35,
        originY: 0.75,
        landingX: 0.65,
        landingY: 0.25,
      },
    })

    expect(result.success).toBe(true)
    expect(mockFrom).toHaveBeenCalledWith('tracer_feedback')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        shot_index: 1,
        feedback_type: 'CONFIGURED',
        auto_origin_x: 0.3,
        final_origin_x: 0.35,
      }),
    )
  })

  it('returns error when insert fails', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'DB error' } })

    const result = await submitTracerFeedback({
      shotIndex: 0,
      feedbackType: 'SKIP',
      finalParams: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns success when Supabase is not configured', async () => {
    vi.mocked(getSupabaseClient).mockReturnValueOnce(null)

    const result = await submitTracerFeedback({
      shotIndex: 0,
      feedbackType: 'AUTO_ACCEPTED',
      finalParams: { originX: 0.5 },
    })

    expect(result.success).toBe(true)
  })

  it('includes tracer style when provided', async () => {
    await submitTracerFeedback({
      shotIndex: 0,
      feedbackType: 'CONFIGURED',
      finalParams: { originX: 0.5 },
      tracerStyle: { color: '#ff0000', lineWidth: 4, glowColor: '#ff6666', glowRadius: 8 },
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tracer_style: { color: '#ff0000', lineWidth: 4, glowColor: '#ff6666', glowRadius: 8 },
      }),
    )
  })
})
