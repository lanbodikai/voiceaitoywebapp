export type LessonLanguage = 'chinese' | 'english'
export type VisualCondition = 'pictures' | 'voice'
export type StoryMode = 'story' | 'play'

export interface Concept {
  id: string
  zh: string[]
  en: string[]
  homophones: string[]
}

export interface Branch {
  id: string
  conceptId: string
  nextBeatId: string
  transitionLine: string
  recast: string
}

export interface VocabularyItem {
  id: string
  zh: string
  pinyin: string
  en: string
}

export interface Reward extends VocabularyItem {
  emoji: string
  announcement: string
  sfxId: string
}

export interface Checkpoint {
  id: string
  kind: 'comprehension' | 'choice' | 'open'
  promptType: 'completion' | 'recall' | 'openEnded' | 'wh' | 'distancing'
  question: string
  englishQuestion: string
  audioCue: string
  concepts: Concept[]
  relatedTerms: string[]
  knownWrongTerms: string[]
  recast: string
  successLine: string
  englishHint: string
  hints: Array<{ level: number; text: string }>
  branches: Branch[]
  defaultBranchId: string | null
  reward: Reward
  vocabulary: VocabularyItem[]
  successSfx: Array<{ sfxId: string; timing: string }>
}

export interface Beat {
  id: string
  title: string
  emoji: string
  illustrationAsset: string
  audioCue: string
  narration: string
  englishNarration: string
  soundEffects: Array<{ sfxId: string; timing: string }>
  nextBeatId: string | null
  checkpoint: Checkpoint
}

export interface Story {
  id: string
  title: string
  englishTitle: string
  subtitle: string
  coverEmoji: string
  estimatedMinutes: number
  vocabularyDomain: string
  startBeatId: string
  typicalPathLength: number
  beats: Beat[]
}

export interface StoryCatalog {
  version: string
  sfxManifest: Array<{ id: string; description: string }>
  animalEchoMap: Record<string, string>
  stories: Story[]
}

export type Verdict = 'correct' | 'meaningUnderstood' | 'partial' | 'incorrect' | 'uncertain' | 'unusable' | 'offTopic'

export interface Evaluation {
  verdict: Verdict
  language: 'chinese' | 'english' | 'mixed' | 'unknown'
  matchedConcepts: string[]
  confidence: number
}

export interface Participant {
  id: string
  isAnonymous: boolean
  email?: string
  displayName?: string
}

export interface SessionEvent {
  sequence: number
  type: string
  occurredAt: string
  payload: Record<string, unknown>
}
