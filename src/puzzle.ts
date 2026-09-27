import type { LessonLanguage } from './types'
import { readStored, writeStored } from './storage.ts'
import { jigsawShapes, type PuzzleCell } from './jigsawGeometry.ts'

export const puzzleLayoutIDs = ['ribbons', 'patchwork', 'panels'] as const
export type PuzzleLayoutID = typeof puzzleLayoutIDs[number]
export type PuzzleVisitKind = 'new' | 'resume' | 'replay'

export interface PuzzlePieceLayout {
  originX: number
  originY: number
  clipPath: string
  path: string
  startX: number
  startY: number
  startRotation: number
  delayMs: number
}

const starts = [
  [-34, -25, -8], [31, -28, 7], [-38, 8, 5], [38, 12, -6], [-23, 31, 8], [26, 34, -7],
] as const

const fiveCells: Record<PuzzleLayoutID, PuzzleCell[]> = {
  ribbons: [[0,0,400,375], [400,0,800,375], [800,0,1200,375], [0,375,600,750], [600,375,1200,750]],
  patchwork: [[0,0,660,420], [660,0,1200,420], [0,420,360,750], [360,420,780,750], [780,420,1200,750]],
  panels: [[0,0,480,375], [0,375,480,750], [480,0,1200,250], [480,250,1200,500], [480,500,1200,750]],
}
const sixCells: Record<PuzzleLayoutID, PuzzleCell[]> = {
  ribbons: [[0,0,400,375], [400,0,800,375], [800,0,1200,375], [0,375,400,750], [400,375,800,750], [800,375,1200,750]],
  patchwork: [[0,0,600,250], [600,0,1200,250], [0,250,600,500], [600,250,1200,500], [0,500,600,750], [600,500,1200,750]],
  panels: [[0,0,360,330], [360,0,840,330], [840,0,1200,330], [0,330,360,750], [360,330,840,750], [840,330,1200,750]],
}

const layouts = new Map<string, PuzzlePieceLayout[]>()
export function puzzleLayout(layoutID: PuzzleLayoutID, pieceCount: number): PuzzlePieceLayout[] {
  const count = pieceCount === 6 ? 6 : 5
  const key = `${layoutID}:${count}`
  if (!layouts.has(key)) layouts.set(key, jigsawShapes((count === 6 ? sixCells : fiveCells)[layoutID], puzzleLayoutIDs.indexOf(layoutID)).map((shape, index) => ({
    ...shape,
    startX: starts[index][0],
    startY: starts[index][1],
    startRotation: starts[index][2],
    delayMs: index * 150,
  })))
  return layouts.get(key)!
}

export function storyProgressPercentage(completedCheckpointIDs: string[], total: number) {
  return total > 0 ? Math.round(earnedPuzzlePieceCount(completedCheckpointIDs, total) / total * 100) : 0
}

export function earnedPuzzlePieceCount(completedCheckpointIDs: string[], total: number) {
  return Math.min(total, new Set(completedCheckpointIDs).size)
}

export function nextPuzzleLayout(previous?: PuzzleLayoutID): PuzzleLayoutID {
  const index = previous ? puzzleLayoutIDs.indexOf(previous) : -1
  return puzzleLayoutIDs[(index + 1) % puzzleLayoutIDs.length]
}

interface StoredPuzzleLayout {
  active?: PuzzleLayoutID
  lastCompleted?: PuzzleLayoutID
}

const layoutKey = (storyID: string, language: LessonLanguage) => `choochoo:puzzle-layout:${storyID}:${language}`
const validLayout = (value: unknown): value is PuzzleLayoutID => puzzleLayoutIDs.includes(value as PuzzleLayoutID)

/** Gallery reads must never select or rotate a visit's layout. */
export function savedPuzzleLayout(storyID: string, language: LessonLanguage): PuzzleLayoutID {
  const stored = readStored<StoredPuzzleLayout>(layoutKey(storyID, language), {})
  return validLayout(stored.active) ? stored.active : 'ribbons'
}

export function selectPuzzleLayout(storyID: string, language: LessonLanguage, visit: PuzzleVisitKind): PuzzleLayoutID {
  const key = layoutKey(storyID, language)
  const stored = readStored<StoredPuzzleLayout>(key, {})
  const active = validLayout(stored.active) ? stored.active : undefined
  const lastCompleted = validLayout(stored.lastCompleted) ? stored.lastCompleted : undefined
  const selected = visit === 'resume' ? active ?? 'ribbons'
    : visit === 'replay' ? nextPuzzleLayout(lastCompleted ?? active)
      : 'ribbons'
  writeStored(key, { ...stored, active: selected })
  return selected
}

export function markPuzzleLayoutCompleted(storyID: string, language: LessonLanguage, layoutID: PuzzleLayoutID) {
  writeStored(layoutKey(storyID, language), { active: layoutID, lastCompleted: layoutID })
}
