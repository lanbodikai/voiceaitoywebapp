import WebSocket from 'ws'

const failure = (statusCode = 502) => Object.assign(new Error('Speech service unavailable'), { statusCode })

// The web detector emits bounded mono PCM WAV. Never treat the WAV header as audio.
export function wavToPCM24(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw failure(400)
  let rate, data
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + length > bytes.length) throw failure(400)
    if (kind === 'fmt ') {
      if (length < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt16LE(start + 14) !== 16) throw failure(400)
      rate = bytes.readUInt32LE(start + 4)
    }
    if (kind === 'data') data = bytes.subarray(start, start + length)
    offset = start + length + (length % 2)
  }
  if (![16000, 24000, 48000].includes(rate) || !data?.length || data.length % 2 || data.length / (rate * 2) > 30 || data.length / (rate * 2) < 0.1) throw failure(400)
  const count = data.length / 2
  const result = Buffer.alloc(Math.floor(count * 24000 / rate) * 2)
  for (let i = 0; i < result.length / 2; i++) {
    const at = i * rate / 24000, left = Math.floor(at), mix = at - left
    result.writeInt16LE(Math.round(data.readInt16LE(left * 2) * (1 - mix) + data.readInt16LE(Math.min(left + 1, count - 1) * 2) * mix), i * 2)
  }
  return result
}

export async function transcribeRealtime(audio, language, prompt, signal, { fetcher = fetch, Socket = WebSocket } = {}) {
  const pcm = wavToPCM24(audio.bytes)
  try {
    const response = await fetcher('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session: {
        type: 'transcription', audio: { input: {
          format: { type: 'audio/pcm', rate: 24000 }, noise_reduction: { type: 'near_field' }, turn_detection: null,
          transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-live-transcribe', languages: language === 'english' ? ['en'] : ['zh'], prompt, delay: 'low' },
        } },
      } }),
    })
    const credential = await response.json().catch(() => ({}))
    if (!response.ok || !credential.value) throw failure(response.status === 429 ? 429 : 502)
    signal?.throwIfAborted()
    return await new Promise((resolve, reject) => {
      const socket = new Socket('wss://api.openai.com/v1/realtime', { headers: { Authorization: `Bearer ${credential.value}` }, handshakeTimeout: 8000 })
      let done = false, sent = false
      const finish = (error, text) => {
        if (done) return
        done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
        socket.terminate()
        if (error) reject(error)
        else resolve({ text: String(text || '').slice(0, 500), language })
      }
      const abort = () => finish(failure(504))
      const timer = setTimeout(abort, 18000)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      socket.on('error', () => finish(failure()))
      socket.on('close', () => { if (!done) finish(failure()) })
      socket.on('message', (message) => {
        let event
        try { event = JSON.parse(message.toString()) } catch { finish(failure()); return }
        if (['session.created', 'transcription_session.created'].includes(event.type) && !sent) {
          if (event.session?.type !== 'transcription' && event.type !== 'transcription_session.created') { finish(failure()); return }
          sent = true
          for (let i = 0; i < pcm.length; i += 24000) socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm.subarray(i, i + 24000).toString('base64') }))
          socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
        }
        if (event.type === 'conversation.item.input_audio_transcription.completed') finish(null, event.transcript)
        if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') finish(failure())
      })
    })
  } finally { pcm.fill(0); audio.bytes.fill(0) }
}
