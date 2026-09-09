import { accessToken } from './supabase'
import type { Evaluation, SessionEvent } from './types'
import { readStored, writeStored } from './storage'

const configuredBaseURL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
const baseURL = import.meta.env.PROD ? '/api' : configuredBaseURL

async function request<T>(path: string, init: RequestInit = {}, authenticate = true): Promise<T> {
  if (!baseURL) throw new Error('VITE_API_BASE_URL is not configured')
  const headers = new Headers(init.headers)
  if (authenticate) {
    const token = await accessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${baseURL}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The service is unavailable')
  return data as T
}

export function recordConsent(input: { shareIdentity: boolean; consentVersion: string }) {
  return request('/participants/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function startResearchSession(input: Record<string, unknown>) {
  return request<{ sessionID: string }>('/sessions/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

const eventQueueKey = 'choochoo:upload-queue'

export async function uploadEvents(sessionID: string, events: SessionEvent[]) {
  queueEventBatch(sessionID, events)
  // Upload only the completed session: per-render uploads consumed the voice
  // rate budget while research storage was offline.
  if (!events.some((event) => event.type === 'session_ended')) return
  try {
    await sendEventBatch(sessionID, events)
    await flushEventQueue()
  } catch (error) {
    queueEventBatch(sessionID, events)
    throw error
  }
}

async function sendEventBatch(sessionID: string, events: SessionEvent[]) {
  for (let offset = 0; offset < events.length; offset += 100) {
    await request('/sessions/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionID, events: events.slice(offset, offset + 100) }) })
  }
}

function queueEventBatch(sessionID: string, events: SessionEvent[]) {
  const raw = readStored<unknown>(eventQueueKey, [])
  const queue = (Array.isArray(raw) ? raw : []) as Array<{ sessionID: string; events: SessionEvent[] }>
  const withoutOlderCopy = queue.filter((item) => item.sessionID !== sessionID)
  writeStored(eventQueueKey, [...withoutOlderCopy, { sessionID, events }].slice(-12))
}

async function flushEventQueue() {
  const raw = readStored<unknown>(eventQueueKey, [])
  const queue = (Array.isArray(raw) ? raw : []) as Array<{ sessionID: string; events: SessionEvent[] }>
  if (!queue.length) return
  const remaining = []
  for (const batch of queue) {
    try { await sendEventBatch(batch.sessionID, batch.events) } catch { remaining.push(batch) }
  }
  writeStored(eventQueueKey, remaining)
}

export function evaluateRemotely(input: Record<string, unknown>) {
  return request<Evaluation>('/answers/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function safetyCheck(sessionID: string, transcript: string) {
  return request<{ safe: boolean; categories: string[] }>('/answers/safety-check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionID, transcript })
  })
}

export function transcribeAudio(audio: Blob, fields: Record<string, string>) {
  const form = new FormData()
  form.append('audio', audio, audio.type.includes('mp4') ? 'answer.m4a' : 'answer.webm')
  Object.entries(fields).forEach(([key, value]) => form.append(key, value))
  return request<{ transcript: string; detectedLanguage: string; durationMs: number }>('/transcribe', { method: 'POST', body: form })
}

export function generateLine(input: Record<string, unknown>) {
  return request<{ line: string; choices?: string[] }>('/lines/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function exportSession(sessionID: string) {
  return request<Record<string, unknown>>(`/sessions/${encodeURIComponent(sessionID)}/export`)
}
