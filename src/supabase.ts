import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Participant } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key, {
  global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(12_000) }) },
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true },
}) : null

function participantFromUser(user: { id: string; is_anonymous?: boolean; email?: string; user_metadata?: Record<string, unknown> }): Participant {
  const metadata = user.user_metadata ?? {}
  const displayName = typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string' ? metadata.name : undefined
  return { id: user.id, isAnonymous: Boolean(user.is_anonymous), email: user.email, displayName }
}

export async function restoreParticipant(): Promise<Participant | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user ? participantFromUser(data.user) : null
}

export async function signInAnonymously(): Promise<Participant> {
  if (!supabase) return { id: crypto.randomUUID(), isAnonymous: true }
  const { data: existing } = await supabase.auth.getUser()
  if (existing.user) return participantFromUser(existing.user)
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.user) throw error ?? new Error('Anonymous sign-in did not return a user')
  return participantFromUser(data.user)
}

export async function accessToken() {
  if (!supabase) return undefined
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token
}
