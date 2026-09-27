import { streamEdgeSpeech } from './edge-speech.mjs'
import { runtimeLimit } from './runtime-limits.mjs'

let activeDeepgram=0

export async function streamSpeech(text, language, onChunk, signal) {
  if (language !== 'english' || !process.env.DEEPGRAM_API_KEY) {
    await streamEdgeSpeech(text, language, onChunk, signal)
    return 'edge-tts'
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 1600) throw new Error('Invalid speech')
  if(activeDeepgram>=runtimeLimit('VOICE_MAX_TTS',8,8))throw new Error('Speech busy')
  activeDeepgram++
  try{
    const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3&speed=0.9', {
      method:'POST',
      headers:{Authorization:`Token ${process.env.DEEPGRAM_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({text}),
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    })
    if (!response.ok || !response.body) throw new Error('Deepgram voice unavailable')
    let size=0
    for await (const chunk of response.body) {
      signal?.throwIfAborted()
      size+=chunk.byteLength
      if(size>2*1024*1024) throw new Error('Speech too large')
      await onChunk(chunk)
    }
    if(!size) throw new Error('Empty speech')
    return 'deepgram-aura-2'
  } finally {
    activeDeepgram--
  }
}
