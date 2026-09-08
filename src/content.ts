import catalogJson from './data/stories.json'
import type { Beat, Story, StoryCatalog } from './types'

export const catalog = catalogJson as StoryCatalog

export function findStory(id: string): Story {
  const story = catalog.stories.find((item) => item.id === id)
  if (!story) throw new Error(`Unknown story: ${id}`)
  return story
}

export function findBeat(story: Story, id: string): Beat {
  const beat = story.beats.find((item) => item.id === id)
  if (!beat) throw new Error(`Unknown beat: ${id}`)
  return beat
}

export function languageText(chinese: string, english: string, language: 'chinese' | 'english') {
  return language === 'english' ? english : chinese
}
