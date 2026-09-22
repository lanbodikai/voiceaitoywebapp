import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { wavToPCM24, transcribeRealtime } from '../server/realtime-audio.mjs'
import { proxyVoice, voiceRoutes } from '../server/oracle-proxy.mjs'
import { conversationalLine } from '../api/index.mjs'
import { transcriptionConfig } from '../server/streaming-voice.mjs'

function wav(seconds = 0.2) {
  const b = Buffer.alloc(44 + 16000 * 2 * seconds)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(b.length - 44, 40)
  return b
}

test('web WAV is converted to 24k PCM, rejecting malformed or excessive audio', () => {
  assert.equal(wavToPCM24(wav()).length, 9600)
  assert.throws(() => wavToPCM24(Buffer.from('bad')), { statusCode: 400 })
  assert.throws(() => wavToPCM24(wav(31)), { statusCode: 400 })
  const stereo = wav(); stereo.writeUInt16LE(2, 22)
  assert.throws(() => wavToPCM24(stereo), { statusCode: 400 })
})

test('Oracle only receives voice routes, not guest progress; authorization is forwarded', async () => {
  assert.equal(voiceRoutes.has('progress/load'), false)
  await assert.rejects(proxyVoice('progress/load', {}), { statusCode: 404 })
  const req = Readable.from([Buffer.from('{"test":true}')])
  req.headers = { authorization: 'Bearer synthetic', 'content-type': 'application/json' }
  await proxyVoice('answers/safety-check', req, undefined, async (url, init) => {
    assert.equal(url, 'https://api.mousefit.pro/ai-toy/web/answers/safety-check')
    assert.equal(init.headers.Authorization, 'Bearer synthetic')
    assert.equal(init.redirect, 'error')
    return new Response('{}')
  })
})

test('generated conversation never exposes menu-style instructions or repeats the prompt',()=>{
  const body={language:'english',previousLine:'What happens next?'}
  for (const line of ['Pick one from the options below.','Which one sounds fun?','What happens next?','That sounds fun! What happens next?','听起来真棒！']) {
    assert.deepEqual(conversationalLine({action:'continue',line},body),{action:'retry',line:'I didn’t quite catch what you meant. Could you say that again?'})
  }
  assert.deepEqual(conversationalLine({action:'continue',line:'A purple dragon sounds wonderful!'},body),{action:'continue',line:'A purple dragon sounds wonderful!'})
  assert.deepEqual(conversationalLine({action:'continue',line:'That sounds wonderful!'}, {language:'chinese',previousLine:'你准备好了吗？'}),{action:'retry',line:'我刚才没太听明白，可以再说一次吗？'})
  const wrapup={language:'english',kind:'storyWrapup',storyID:'choochoo-farm-duckling',previousLine:'Who was your favorite?'}
  assert.deepEqual(conversationalLine({action:'continue',line:'Great! Who else did you like?'},wrapup),{action:'continue',line:'That’s one of my favorites too! I loved how everyone helped Gaga get home. Thanks for listening!'})
  assert.deepEqual(conversationalLine({action:'continue',line:'Me too! I loved how everyone helped Gaga get home. Thanks for listening!'},wrapup),{action:'continue',line:'Me too! I loved how everyone helped Gaga get home. Thanks for listening!'})
})

test('live transcription is tuned for soft child speech without guessing words',()=>{
  const input=transcriptionConfig('english','birthday-cake','call-a-friend').audio.input
  assert.equal(input.turn_detection,null)
  assert.equal(input.transcription.delay,'low')
  assert.deepEqual(input.transcription.languages,['en'])
  assert.match(input.transcription.prompt,/speak softly/)
  assert.match(input.transcription.prompt,/never complete, rewrite, or guess/)
  const chinese=transcriptionConfig('chinese','choochoo-birthday-cake','call-a-friend').audio.input
  assert.deepEqual(chinese.transcription.languages,['zh'])
  assert.match(chinese.transcription.prompt,/练习普通话/)
  assert.match(chinese.transcription.prompt,/准备好了/)
  assert.ok(chinese.transcription.keywords.includes('小狐狸'))
  assert.ok(!chinese.transcription.keywords.includes('fox'))
})

test('live adapter waits for readiness, commits PCM, discards audio and closes', async () => {
  let socket
  class Socket extends EventEmitter {
    constructor() { super(); socket = this; this.events = []; queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.created","session":{"type":"transcription"}}'))) }
    send(value) { const e = JSON.parse(value); this.events.push(e.type); if (e.type === 'input_audio_buffer.commit') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"conversation.item.input_audio_transcription.completed","transcript":"ready"}'))) }
    terminate() { this.closed = true }
  }
  const audio = { bytes: wav() }
  const result = await transcribeRealtime(audio, 'english', 'A short reply', undefined, { Socket, fetcher: async (_url, init) => {
    const body = JSON.parse(init.body)
    assert.deepEqual(body.session.audio.input.transcription.languages, ['en'])
    return new Response('{"value":"synthetic"}')
  } })
  assert.equal(result.text, 'ready')
  assert.deepEqual(socket.events, ['input_audio_buffer.append', 'input_audio_buffer.commit'])
  assert.equal(socket.closed, true)
  assert.equal(audio.bytes.every((b) => b === 0), true)
})

test('cancelling pending speech closes the socket and clears audio', async () => {
  let socket
  class Socket extends EventEmitter { constructor() { super(); socket = this } terminate() { this.closed = true } }
  const c = new AbortController(), audio = { bytes: wav() }
  const pending = transcribeRealtime(audio, 'english', '', c.signal, { Socket, fetcher: async () => new Response('{"value":"synthetic"}') })
  await new Promise((resolve) => setImmediate(resolve)); c.abort()
  await assert.rejects(pending)
  assert.equal(socket.closed, true)
  assert.equal(audio.bytes.every((b) => b === 0), true)
})
