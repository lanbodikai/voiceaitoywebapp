export const voiceRoutes = new Set(['transcribe', 'answers/safety-check', 'answers/evaluate', 'lines/generate', 'speech/synthesize'])

// Only the fixed voice routes can reach Oracle. Progress always stays on Vercel.
export async function proxyVoice(route, request, signal, fetcher = fetch) {
  if (!voiceRoutes.has(route)) throw Object.assign(new Error('Invalid route'), { statusCode: 404 })
  const origin = process.env.ORACLE_VOICE_ORIGIN || 'https://api.mousefit.pro/ai-toy/web'
  const url = new URL(origin)
  if (url.protocol !== 'https:') throw Object.assign(new Error('Invalid upstream'), { statusCode: 503 })
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error('Audio too large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  try {
    return await fetcher(`${origin.replace(/\/$/, '')}/${route}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: request.headers.authorization, 'Content-Type': request.headers['content-type'] || 'application/json' },
      body: bytes,
    })
  } finally { bytes.fill(0) }
}
