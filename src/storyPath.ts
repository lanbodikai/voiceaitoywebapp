import type { Beat, Story } from './types'

/** Follow the selected branch, then the default branch for unread sections. */
export function readingPath(story: Story, visited: string[] = []): Beat[] {
  const result: Beat[] = []
  let id: string | null = story.startBeatId
  while (id && !result.some((beat) => beat.id === id)) {
    const beat = story.beats.find((item) => item.id === id)
    if (!beat) break
    result.push(beat)
    const possibleNext = [...beat.checkpoint.branches.map((branch) => branch.nextBeatId), beat.nextBeatId]
    const selected = visited[result.length]
    id = selected && possibleNext.includes(selected) ? selected
      : beat.checkpoint.branches.find((branch) => branch.id === beat.checkpoint.defaultBranchId)?.nextBeatId ?? beat.nextBeatId
  }
  return result
}
