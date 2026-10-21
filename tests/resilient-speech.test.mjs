import test from 'node:test'
import assert from 'node:assert/strict'
import { synthesizeSpeech, streamResilientSpeech, resetSpeechFallbackForTests } from '../server/resilient-speech.mjs'
import { checkVoiceCanary, readVoiceCanary } from '../server/voice-canary.mjs'

test('failed Edge synthesis falls back to OpenAI without logging or retaining speech', async () => {
  const old = { key: process.env.OPENAI_API_KEY, python: process.env.EDGE_TTS_PYTHON, enabled: process.env.SPEECH_FALLBACK_ENABLED, fetch: globalThis.fetch }
  process.env.OPENAI_API_KEY = 'synthetic-test-key'
  process.env.EDGE_TTS_PYTHON = '/usr/bin/false'
  process.env.SPEECH_FALLBACK_ENABLED = 'true'
  let request
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return new Response(Uint8Array.of(73, 68, 51), { status: 200 })
  }
  try {
    resetSpeechFallbackForTests()
    const speech = await synthesizeSpeech('你好，朋友。', 'chinese')
    assert.equal(speech.provider, 'openai-tts')
    assert.equal(speech.mimeType, 'audio/mpeg')
    assert.equal(speech.audioBase64, 'SUQz')
    assert.equal(request.url, 'https://api.openai.com/v1/audio/speech')
    assert.equal(JSON.parse(request.init.body).input, '你好，朋友。')
    assert.equal(JSON.parse(request.init.body).model, 'gpt-4o-mini-tts')

    resetSpeechFallbackForTests()
    const chunks = []
    const provider = await streamResilientSpeech('Hello, friend.', 'english', chunk => chunks.push(...chunk))
    assert.equal(provider, 'openai-tts')
    assert.deepEqual(chunks, [73, 68, 51])
    await assert.rejects(synthesizeSpeech('', 'english'), { statusCode: 400 })
  } finally {
    resetSpeechFallbackForTests()
    globalThis.fetch = old.fetch
    for (const [name, value] of [['OPENAI_API_KEY', old.key], ['EDGE_TTS_PYTHON', old.python], ['SPEECH_FALLBACK_ENABLED', old.enabled]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('canary checks both languages and marks fallback as degraded', async () => {
  const report = await checkVoiceCanary(async (_text, language, onChunk) => {
    if (language === 'english') throw new Error('Primary down')
    onChunk(Uint8Array.of(1))
  }, async (_text, _language, onChunk) => onChunk(Uint8Array.of(2)))
  assert.equal(report.ok, true)
  assert.equal(report.degraded, true)
  assert.equal(report.languages.english.provider, 'openai-tts')
  assert.equal(report.languages.chinese.provider, 'edge-tts')
})

test('canary fails closed when unavailable or stale', async () => {
  const report = await checkVoiceCanary(async () => { throw new Error('Primary down') }, async () => { throw new Error('Fallback down') })
  assert.equal(report.ok, false)
  assert.equal(report.languages.english.ok, false)
  assert.deepEqual(readVoiceCanary('/path/that/does/not/exist'), { ok: false, degraded: true })
})
