import type { LessonLanguage, Reward, SessionEvent, Story, VocabularyItem, VisualCondition } from './types'

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
  return localStorage.getItem(`choochoo:completed:${storyID}`) === 'true'
}

export function markCompleted(storyID: string) {
  localStorage.setItem(`choochoo:completed:${storyID}`, 'true')
}

export function savedRewards(story: Story) {
  const stored = JSON.parse(localStorage.getItem(`choochoo:rewards:${story.id}`) || '[]') as string[]
  const rewards = story.beats.map((beat) => beat.checkpoint.reward)
  return rewards.filter((reward, index) => stored.includes(reward.id) && rewards.findIndex((item) => item.id === reward.id) === index)
}

export function saveReward(storyID: string, reward: Reward) {
  const key = `choochoo:rewards:${storyID}`
  const stored = JSON.parse(localStorage.getItem(key) || '[]') as string[]
  if (!stored.includes(reward.id)) localStorage.setItem(key, JSON.stringify([...stored, reward.id]))
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
  Object.keys(localStorage).filter((key) => key.startsWith('choochoo:')).forEach((key) => localStorage.removeItem(key))
}
