import { readStored, writeStored } from './storage'
import type { LessonLanguage } from './types'

export interface ProgressSnapshot {
  beatID: string
  phase: 'story' | 'recast'
  attemptCount: number
  hintLevel: number
  completed: boolean
  beatPath: string[]
  completedCheckpoints: string[]
  rewardIDs: string[]
  vocabularyIDs: string[]
}
export interface ProgressRecord { storyID: string; language: LessonLanguage; snapshot: ProgressSnapshot; updatedAt: string }
export interface GuestProgress { profileID: string; stories: ProgressRecord[] }
export function guestID() { return readStored<string>('choochoo:guest-profile', '') }
export function progressKey() { return `choochoo:progress:${guestID()}` }
export function savedProgress(storyID: string, language: LessonLanguage) {
  return readStored<ProgressRecord[]>(progressKey(), []).find((p) => p.storyID === storyID && p.language === language)?.snapshot
}
export function cacheProgress(storyID: string, language: LessonLanguage, snapshot: ProgressSnapshot) {
  const records = readStored<ProgressRecord[]>(progressKey(), [])
  writeStored(progressKey(), [...records.filter((p) => p.storyID !== storyID || p.language !== language), { storyID, language, snapshot, updatedAt: new Date().toISOString() }])
}
export function acceptCloudProgress(data: GuestProgress) {
  writeStored('choochoo:guest-profile', data.profileID)
  writeStored(progressKey(), data.stories)
}
