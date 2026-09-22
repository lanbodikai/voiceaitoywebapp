import { readStored, writeStored } from './storage.ts'
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
export interface PuzzleCollectionEntry { storyID: string; language: LessonLanguage }
export interface GuestProgress { profileID: string; stories: ProgressRecord[]; collections?: PuzzleCollectionEntry[] }
export function guestID() { return readStored<string>('choochoo:guest-profile', '') }
export function progressKey() { return `choochoo:progress:${guestID()}` }
const collectionKey = () => `choochoo:collections:${guestID()}`
function uniqueCollections(value: unknown): PuzzleCollectionEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PuzzleCollectionEntry => Boolean(item) && typeof item.storyID === 'string' && /^[a-z0-9-]{1,100}$/.test(item.storyID) && ['english', 'chinese'].includes(item.language))
    .map(({ storyID, language }) => ({ storyID, language }))
    .filter((item, index, all) => all.findIndex(other => other.storyID === item.storyID && other.language === item.language) === index)
}
export function savedCollections() { return uniqueCollections(readStored<unknown>(collectionKey(), [])) }
export function collectPuzzle(storyID: string, language: LessonLanguage) {
  writeStored(collectionKey(), uniqueCollections([...savedCollections(), { storyID, language }]))
  notifyProgressChanged()
}
function notifyProgressChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('choochoo-progress'))
}
export function savedProgress(storyID: string, language: LessonLanguage) {
  return readStored<ProgressRecord[]>(progressKey(), []).find((p) => p.storyID === storyID && p.language === language)?.snapshot
}
export function cacheProgress(storyID: string, language: LessonLanguage, snapshot: ProgressSnapshot) {
  const records = readStored<ProgressRecord[]>(progressKey(), [])
  writeStored(progressKey(), [...records.filter((p) => p.storyID !== storyID || p.language !== language), { storyID, language, snapshot, updatedAt: new Date().toISOString() }])
  notifyProgressChanged()
}
export function acceptCloudProgress(data: GuestProgress) {
  writeStored('choochoo:guest-profile', data.profileID)
  writeStored(progressKey(), data.stories)
  // Read only the incoming guest's cache. Never carry unlocks between profiles.
  // Union preserves offline awards while an older server or pending upload catches up.
  writeStored(collectionKey(), uniqueCollections([...savedCollections(), ...uniqueCollections(data.collections)]))
  notifyProgressChanged()
}
