import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { createVoiceServer } from '../server/voice-server.mjs'
import { proxyVoice } from '../server/oracle-proxy.mjs'
import { runtimeLimit } from '../server/runtime-limits.mjs'
import { voiceStreamURL, LEGACY_VOICE_STREAM_URL } from '../src/voiceEndpoint.ts'

function restoreEnvironment(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

test('standalone runtime exposes no legacy, Mousefit, or progress endpoints; health fails closed', async () => {
  const keys = ['VOICE_RUNTIME', 'OPENAI_API_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'CHILD_PILOT_MODE', 'OPENAI_ZDR_VERIFIED']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  for (const key of keys) delete process.env[key]
  process.env.VOICE_RUNTIME = 'true'
  const { server, sockets } = createVoiceServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const health = await fetch(`${origin}/health`)
    assert.equal(health.status, 503)
    assert.deepEqual(await health.json(), { ok: false })
    assert.equal(health.headers.get('cache-control'), 'no-store')
    for (const path of ['/web/progress/load', '/web/sessions/start', '/ai-toy/transcribe', '/api/health', '/mousefit', '/']) {
      assert.equal((await fetch(`${origin}${path}`, { method: 'POST' })).status, 404, path)
    }
    assert.equal((await fetch(`${origin}/web/answers/evaluate`, { method: 'POST' })).status, 401)
    process.env.OPENAI_API_KEY = 'synthetic'
    process.env.VITE_SUPABASE_URL = 'https://example.invalid'
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'synthetic'
    assert.equal((await fetch(`${origin}/health`)).status, 503, 'configured but privacy gate not enabled')
    process.env.OPENAI_ZDR_VERIFIED = 'true'
    assert.deepEqual(await (await fetch(`${origin}/health`)).json(), { ok: true })
  } finally {
    await new Promise(resolve => sockets.close(resolve))
    await new Promise(resolve => server.close(resolve))
    restoreEnvironment(saved)
  }
})

test('new voice proxy origin overrides Oracle without moving progress; rollback remains available', async () => {
  const saved = { VOICE_API_ORIGIN: process.env.VOICE_API_ORIGIN, ORACLE_VOICE_ORIGIN: process.env.ORACLE_VOICE_ORIGIN }
  const call = async expected => {
    const request = Readable.from([Buffer.from('{}')])
    request.headers = { authorization: 'Bearer synthetic' }
    await proxyVoice('answers/evaluate', request, undefined, async (url, init) => {
      assert.equal(url, `${expected}/answers/evaluate`)
      assert.equal(init.headers.Authorization, 'Bearer synthetic')
      return Response.json({})
    })
  }
  try {
    process.env.ORACLE_VOICE_ORIGIN = 'https://legacy.example/web'
    process.env.VOICE_API_ORIGIN = 'https://voice.example/web'
    await call('https://voice.example/web')
    await assert.rejects(proxyVoice('progress/load', {}), { statusCode: 404 })
    delete process.env.VOICE_API_ORIGIN
    await call('https://legacy.example/web')
    process.env.VOICE_API_ORIGIN = 'http://voice.example/web'
    await assert.rejects(proxyVoice('answers/evaluate', {}), { statusCode: 503 })
  } finally { restoreEnvironment(saved) }
})

test('browser stream endpoint supports secure cutover and explicit rollback only', () => {
  assert.equal(voiceStreamURL(), LEGACY_VOICE_STREAM_URL)
  assert.equal(voiceStreamURL('wss://voice.example/web/voice-stream'), 'wss://voice.example/web/voice-stream')
  for (const endpoint of ['ws://voice.example/web/voice-stream', 'https://voice.example', 'wss://user:password@voice.example', 'wss://voice.example?token=secret', 'wss://voice.example#hash']) {
    assert.throws(() => voiceStreamURL(endpoint))
  }
})

test('small-server limits cannot be disabled by malformed or excessive values', () => {
  const saved = { VOICE_MAX_TTS: process.env.VOICE_MAX_TTS }
  try {
    for (const value of ['0', '-1', 'NaN', '99', '1.5', '']) {
      process.env.VOICE_MAX_TTS = value
      assert.equal(runtimeLimit('VOICE_MAX_TTS', 8, 8), 8)
    }
    process.env.VOICE_MAX_TTS = '2'
    assert.equal(runtimeLimit('VOICE_MAX_TTS', 8, 8), 2)
  } finally { restoreEnvironment(saved) }
})
