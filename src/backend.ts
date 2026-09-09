import { accessToken } from './supabase'
import type { Evaluation, SessionEvent } from './types'
import { readStored, writeStored } from './storage'
import { acceptCloudProgress, guestID, type GuestProgress, type ProgressSnapshot } from './progress'

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

export async function recordConsent(input: { shareIdentity: boolean; consentVersion: string }) {
  const data = await request<{participantID: string}>('/participants/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  writeStored('choochoo:guest-profile', data.participantID)
  return data
}

export function startResearchSession(input: Record<string, unknown>) {
  return request<{ sessionID: string }>('/sessions/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

const eventQueueKey = () => `choochoo:upload-queue:${guestID()}`
type PendingBatch = { sessionID: string; events: SessionEvent[]; revision: number; snapshot?: ProgressSnapshot }
let flushing: Promise<void> | undefined
let revision = Date.now()
export function hasPendingProgress() { return readStored<PendingBatch[]>(eventQueueKey(), []).length > 0 }
function notifyProgress() { window.dispatchEvent(new Event('choochoo-progress')) }

export async function uploadEvents(sessionID: string, events: SessionEvent[], snapshot?: ProgressSnapshot, defer = false) {
  const key = eventQueueKey()
  const queue = readStored<PendingBatch[]>(key, [])
  const previous = queue.find((item) => item.sessionID === sessionID)
  // Store only enumerated metrics, never arbitrary payloads or learner speech.
  const safeEvents = events.map((event) => ({ sequence: event.sequence, type: event.type, occurredAt: event.occurredAt, payload: Object.fromEntries(Object.entries(event.payload).filter(([key, value]) => ['beatID','verdict','level','audioDurationMs','transcriptionLatencyMs'].includes(key) && (typeof value === 'string' || typeof value === 'number'))) }))
  revision = Math.max(Date.now(), revision + 1)
  writeStored(key, [...queue.filter((item) => item.sessionID !== sessionID), { sessionID, events: safeEvents, revision, snapshot: snapshot ?? previous?.snapshot }].slice(-12))
  notifyProgress()
  if (!defer) return flushEventQueue()
}

async function sendEventBatch(batch: PendingBatch) {
  for (let offset = 0; offset < Math.max(batch.events.length, 1); offset += 100) {
    await request('/sessions/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...batch, events: batch.events.slice(offset, offset + 100) }) })
  }
}

export function flushEventQueue(): Promise<void> {
  if (flushing) return flushing
  const key = eventQueueKey()
  flushing = (async () => {
    while (key === eventQueueKey()) {
      const batch = readStored<PendingBatch[]>(key, [])[0]
      if (!batch) return
      await sendEventBatch(batch)
      writeStored(key, readStored<PendingBatch[]>(key, []).filter((item) => item.sessionID !== batch.sessionID || item.revision !== batch.revision))
    }
  })().finally(() => { flushing = undefined; notifyProgress() })
  return flushing
}

export async function loadProgress() {
  await flushEventQueue()
  const data = await request<GuestProgress>('/progress/load', { method: 'POST' })
  acceptCloudProgress(data)
  return data
}
export function createRecoveryCode() { return request<{code: string}>('/progress/recovery-code', {method:'POST'}) }
export async function restoreProgress(code: string) {
  await flushEventQueue()
  await request('/progress/restore', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code})})
  // Do not reuse a previous profile's cache after linking this device.
  const data = await request<GuestProgress>('/progress/load', {method:'POST'})
  acceptCloudProgress(data)
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
