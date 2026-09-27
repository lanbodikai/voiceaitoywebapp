import type { Story } from './types'

const storyNames: Record<string, RegExp> = {
  'choochoo-birthday-cake': /生日|蛋糕|birthday|cake/i,
  'choochoo-farm-duckling': /农场|小鸭|鸭子|farm|duck/i,
  'choochoo-noodle-shop': /面馆|面条|蹦蹦|noodle|restaurant/i,
  'little-red-hen': /小红母鸡|红母鸡|little red hen/i,
  'henny-penny': /佩妮|henny penny/i,
}

export function storyFromSpeech(text: string, stories: Story[]): Story | 'surprise' | null {
  const speech = text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").trim()
  if (/^(?:surprise me|any story|you choose|随便|你选吧|惊喜|都可以)[!！。.]?$/.test(speech)) return 'surprise'
  const matches = stories.filter(story => storyNames[story.id]?.test(speech))
  return matches.length === 1 ? matches[0] : null
}
