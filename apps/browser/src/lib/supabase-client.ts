// apps/browser/src/lib/supabase-client.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

export function isSupabaseConfigured(): boolean {
  return supabase !== null
}

/**
 * Get the Supabase client if configured, otherwise null.
 * Use this instead of non-null assertions on supabase.
 */
export function getSupabaseClient(): SupabaseClient | null {
  return supabase
}
