import { runtimeLimit } from './runtime-limits.mjs'

let active = 0
const maxAudioBytes = 2 * 1024 * 1024

export async function streamOpenAISpeech(text, language, onChunk, signal) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1600 || !['chinese', 'english'].includes(language)) {
    throw Object.assign(new Error('Invalid speech'), { statusCode: 400 })
  }
  if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error('Speech fallback unavailable'), { statusCode: 503 })
  if (active >= runtimeLimit('VOICE_MAX_TTS', 8, 8)) throw Object.assign(new Error('Speech busy'), { statusCode: 429 })
  signal?.throwIfAborted()
  active++
  try {
    const timeout = AbortSignal.timeout(12000)
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'coral', input: text, response_format: 'mp3' }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!response.ok || !response.body) throw new Error('Speech fallback unavailable')
    let size = 0
    for await (const chunk of response.body) {
      signal?.throwIfAborted()
      size += chunk.byteLength
      if (size > maxAudioBytes) throw new Error('Speech too large')
      await onChunk(chunk)
    }
    if (!size) throw new Error('Empty speech')
    return 'openai-tts'
  } finally {
    active--
  }
}

export async function openAISpeech(text, language, signal) {
  const chunks = []
  try {
    await streamOpenAISpeech(text, language, chunk => chunks.push(Buffer.from(chunk)), signal)
    return { audioBase64: Buffer.concat(chunks).toString('base64'), mimeType: 'audio/mpeg', provider: 'openai-tts', voice: 'coral' }
  } finally {
    for (const chunk of chunks) chunk.fill(0)
  }
}
