import { accessToken } from './supabase'
import type { Evaluation, SessionEvent } from './types'

const configuredBaseURL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
const baseURL = import.meta.env.PROD ? '/api' : configuredBaseURL

async function request<T>(path: string, init: RequestInit = {}, authenticate = true): Promise<T> {
  if (!baseURL) throw new Error('VITE_API_BASE_URL is not configured')
  const headers = new Headers(init.headers)
  if (authenticate) {
    const token = await accessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${baseURL}${path}`, { ...init, headers })
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
  try {
    await sendEventBatch(sessionID, events)
    await flushEventQueue()
  } catch (error) {
    queueEventBatch(sessionID, events)
    throw error
  }
}

function sendEventBatch(sessionID: string, events: SessionEvent[]) {
  return request('/sessions/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionID, events }) })
}

function queueEventBatch(sessionID: string, events: SessionEvent[]) {
  const queue = JSON.parse(localStorage.getItem(eventQueueKey) || '[]') as Array<{ sessionID: string; events: SessionEvent[] }>
  const withoutOlderCopy = queue.filter((item) => item.sessionID !== sessionID)
  localStorage.setItem(eventQueueKey, JSON.stringify([...withoutOlderCopy, { sessionID, events }].slice(-12)))
}

async function flushEventQueue() {
  const queue = JSON.parse(localStorage.getItem(eventQueueKey) || '[]') as Array<{ sessionID: string; events: SessionEvent[] }>
  if (!queue.length) return
  const remaining = []
  for (const batch of queue) {
    try { await sendEventBatch(batch.sessionID, batch.events) } catch { remaining.push(batch) }
  }
  if (remaining.length) localStorage.setItem(eventQueueKey, JSON.stringify(remaining))
  else localStorage.removeItem(eventQueueKey)
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
