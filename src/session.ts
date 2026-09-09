import type { LessonLanguage, Reward, SessionEvent, Story, VocabularyItem, VisualCondition } from './types'
import { readStored, writeStored } from './storage'

export interface SessionConfig {
  language: LessonLanguage
  visualCondition: VisualCondition
  sessionLabel: string
  englishSubtitles: boolean
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
