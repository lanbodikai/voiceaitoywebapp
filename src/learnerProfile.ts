import { readStored, writeStored } from './storage.ts'
import { detectVoiceCommand } from './voiceCommands.ts'
import { readiness } from './conversationIntents.ts'

interface LearnerProfile {
  name?: string
  nameAsked: boolean
}

const profileKey = () => `choochoo:learner:${readStored<string>('choochoo:guest-profile', '') || 'device'}`

export function learnerProfile(): LearnerProfile {
  const value = readStored<Partial<LearnerProfile>>(profileKey(), {})
  return {
    name: typeof value.name === 'string' ? nameFromSpeech(value.name) : undefined,
    nameAsked: value.nameAsked === true,
  }
}

export function rememberLearnerName(name?: string) {
  writeStored(profileKey(), { name: name ? nameFromSpeech(name) : undefined, nameAsked: true })
}

/** Accept a short nickname or a natural "my name is..." answer without forcing a format. */
export function nameFromSpeech(text: string) {
  let value = text.trim().replace(/[\r\n]+/g, ' ')
  if (detectVoiceCommand(value) || readiness(value) !== null) return undefined
  if (/\b(?:don'?t want to (?:say|tell)|rather not|no name|don'?t know)\b/i.test(value) || /不想说|不告诉|不愿意说|不知道|不记得/u.test(value)) return undefined
  value = value
    .replace(/^(?:my name is|you can call me|call me|i am|i'm)\s+/i, '')
    .replace(/^(?:我叫|我的名字(?:是|叫)|你可以叫我|叫我)\s*/u, '')
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’,.!?，。！？]+$/gu, '')
  const characters = Array.from(value)
  if (!characters.length || characters.length > 24 || value.split(/\s+/).length > 4 || /[?？]/u.test(value)) return undefined
  return characters.slice(0, 24).join('')
}
