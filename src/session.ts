import type { LessonLanguage, Reward, SessionEvent, Story, VocabularyItem, VisualCondition } from './types'
import type { PuzzleFinaleData } from './StoryPuzzle'
import { readStored, removeStored, writeStored } from './storage.ts'
import { randomUUID } from './browserCompat.ts'

export interface SessionConfig {
  language: LessonLanguage
  visualCondition: VisualCondition
  sessionLabel: string
  englishSubtitles: boolean
  speechRate: number
}

export interface CompletionData {
  mode: 'story' | 'play'
  title: string
  story?: Story
  config: SessionConfig
  rewards: Reward[]
  vocabulary: VocabularyItem[]
  events: SessionEvent[]
  sessionID?: string
  puzzle?: PuzzleFinaleData
}

export interface VisitScope {
  mode: 'story' | 'play'
  storyID?: string
  language: LessonLanguage
}

const visitSlug = ({ mode, storyID, language }: VisitScope) => `${readStored<string>('choochoo:guest-profile', '') || 'device'}:${mode}:${storyID || 'imaginative-play'}:${language}`
const visitKey = (scope: VisitScope) => `choochoo:active-session:${visitSlug(scope)}`
const sequenceKey = (scope: VisitScope) => `choochoo:event-sequence:${visitSlug(scope)}`

/** Reserve one idempotency key for a visit. Reloads and timed-out retries reuse it. */
export function activeSessionID(scope: VisitScope) {
  const key = visitKey(scope)
  const existing = readStored<string>(key, '')
  if (/^[a-f0-9-]{36}$/i.test(existing)) return existing
  const sessionID = randomUUID()
  writeStored(key, sessionID)
  return sessionID
}

/** Event sequence numbers continue across reloads so server upserts cannot collide. */
export function nextEventSequence(scope: VisitScope) {
  const next = Math.max(0, readStored<number>(sequenceKey(scope), 0)) + 1
  writeStored(sequenceKey(scope), next)
  return next
}

export function completeActiveSession(scope: VisitScope) {
  removeStored(visitKey(scope))
  removeStored(sequenceKey(scope))
}

export function completedBefore(storyID: string) {
  return readStored<boolean>(`choochoo:completed:${storyID}`, false) === true
}

export function markCompleted(storyID: string) {
  writeStored(`choochoo:completed:${storyID}`, true)
}

export function savedRewards(story: Story) {
  const raw = readStored<unknown>(`choochoo:rewards:${story.id}`, [])
  const stored = Array.isArray(raw) ? raw : []
  const rewards = story.beats.map((beat) => beat.checkpoint.reward)
  return rewards.filter((reward, index) => stored.includes(reward.id) && rewards.findIndex((item) => item.id === reward.id) === index)
}

export function saveReward(storyID: string, reward: Reward) {
  const key = `choochoo:rewards:${storyID}`
  const raw = readStored<unknown>(key, [])
  const stored = Array.isArray(raw) ? raw : []
  if (!stored.includes(reward.id)) writeStored(key, [...stored, reward.id])
}

export function downloadJSON(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  URL.revokeObjectURL(link.href)
}

export function clearLocalResearchData() {
  try { Object.keys(localStorage).filter((key) => key.startsWith('choochoo:')).forEach((key) => localStorage.removeItem(key)) } catch { /* Storage is optional. */ }
}
