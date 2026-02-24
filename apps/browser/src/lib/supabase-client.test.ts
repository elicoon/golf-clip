import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('supabase-client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getSupabaseClient returns the same reference as exported supabase', async () => {
    const { getSupabaseClient, supabase } = await import('./supabase-client')
    expect(getSupabaseClient()).toBe(supabase)
  })

  it('isSupabaseConfigured reflects whether client was created', async () => {
    const { isSupabaseConfigured, supabase } = await import('./supabase-client')
    // When env vars are set, supabase is a client and isConfigured is true
    // When env vars are missing, supabase is null and isConfigured is false
    expect(isSupabaseConfigured()).toBe(supabase !== null)
  })
})
