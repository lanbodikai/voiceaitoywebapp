import { edgeSpeech, streamEdgeSpeech } from './edge-speech.mjs'
import { openAISpeech, streamOpenAISpeech } from './openai-speech.mjs'

let preferFallbackUntil = 0
const fallbackWindowMs = 5 * 60 * 1000
const canFallback = () => process.env.SPEECH_FALLBACK_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY)
const isProviderFailure = error => error?.statusCode === 502 || error?.message === 'Speech process failed'

export async function synthesizeSpeech(text, language, signal) {
  if (!canFallback()) return edgeSpeech(text, language, signal)
  if (Date.now() < preferFallbackUntil) {
    try { return await openAISpeech(text, language, signal) }
    catch (error) {
      if (signal?.aborted || error?.statusCode === 400 || error?.statusCode === 429) throw error
      preferFallbackUntil = 0
    }
  }
  try { return await edgeSpeech(text, language, signal) }
  catch (error) {
    if (signal?.aborted || !isProviderFailure(error)) throw error
    const result = await openAISpeech(text, language, signal)
    preferFallbackUntil = Date.now() + fallbackWindowMs
    return result
  }
}

export async function streamResilientSpeech(text, language, onChunk, signal) {
  if (!canFallback()) return streamEdgeSpeech(text, language, onChunk, signal).then(() => 'edge-tts')
  if (Date.now() < preferFallbackUntil) {
    let sent = false
    try {
      return await streamOpenAISpeech(text, language, async chunk => { await onChunk(chunk); sent = true }, signal)
    } catch (error) {
      if (signal?.aborted || sent || error?.statusCode === 400 || error?.statusCode === 429) throw error
      preferFallbackUntil = 0
    }
  }
  let sent = false
  try {
    await streamEdgeSpeech(text, language, async chunk => { await onChunk(chunk); sent = true }, signal)
    return 'edge-tts'
  } catch (error) {
    if (signal?.aborted || !isProviderFailure(error)) throw error
    preferFallbackUntil = Date.now() + fallbackWindowMs
    // A partial MP3 cannot be replaced with a second MP3 in the same stream.
    if (sent) throw error
    return streamOpenAISpeech(text, language, onChunk, signal)
  }
}

export function resetSpeechFallbackForTests() { preferFallbackUntil = 0 }
