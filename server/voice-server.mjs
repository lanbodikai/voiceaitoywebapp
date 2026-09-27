import { createServer } from 'node:http'
import handler, { moderate, generateSpokenLine, evaluateAnswer } from '../api/index.mjs'
import { voiceRoutes } from './oracle-proxy.mjs'
import { attachStreamingVoice } from './streaming-voice.mjs'
import { edgeSpeech } from './edge-speech.mjs'

// This standalone service deliberately contains no legacy app or database server.
export function createVoiceServer() {
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Type', 'application/json')
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (request.method === 'GET' && pathname === '/health') {
      const configured = ['OPENAI_API_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].every(key => Boolean(process.env[key]))
      const permitted = process.env.CHILD_PILOT_MODE === 'false' || process.env.OPENAI_ZDR_VERIFIED === 'true'
      response.statusCode = configured && permitted ? 200 : 503
      response.end(JSON.stringify({ ok: configured && permitted }))
      return
    }
    const route = pathname.startsWith('/web/') ? pathname.slice(5) : ''
    if (request.method !== 'POST' || !voiceRoutes.has(route)) {
      response.statusCode = 404
      response.end('{"error":"Not found"}')
      return
    }
    request.url = `/api/${route}`
    response.status = status => { response.statusCode = status; return response }
    response.json = value => response.end(JSON.stringify(value))
    void handler(request, response).catch(() => {
      if (!response.writableEnded) {
        response.statusCode = 502
        response.end('{"error":"Voice service unavailable"}')
      }
    })
  })
  server.requestTimeout = 35000
  server.headersTimeout = 10000
  server.maxHeadersCount = 32
  const sockets = attachStreamingVoice(server, moderate, {
    reply: generateSpokenLine,
    evaluate: evaluateAnswer,
    synthesize: (body, signal) => edgeSpeech(body?.text, body?.language, signal),
  })
  return { server, sockets }
}
