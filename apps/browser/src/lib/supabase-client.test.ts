import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('supabase-client', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('exports getSupabaseClient function', async () => {
    const { getSupabaseClient } = await import('./supabase-client')
    expect(typeof getSupabaseClient).toBe('function')
  })

  it('exports isSupabaseConfigured function', async () => {
    const { isSupabaseConfigured } = await import('./supabase-client')
    expect(typeof isSupabaseConfigured).toBe('function')
  })

  it('getSupabaseClient returns consistent value', async () => {
    const { getSupabaseClient, supabase } = await import('./supabase-client')
    const client = getSupabaseClient()
    // getSupabaseClient should return the same reference as the exported supabase
    expect(client).toBe(supabase)
  })

  it('isSupabaseConfigured matches supabase client presence', async () => {
    const { isSupabaseConfigured, supabase } = await import('./supabase-client')
    // isSupabaseConfigured should be true when supabase is not null
    expect(isSupabaseConfigured()).toBe(supabase !== null)
  })

  it('exports supabase constant', async () => {
    const module = await import('./supabase-client')
    // supabase should be either null or a SupabaseClient
    expect('supabase' in module).toBe(true)
  })
})
