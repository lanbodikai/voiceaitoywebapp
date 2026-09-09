import test from 'node:test'
import assert from 'node:assert/strict'
import { speak, stopVoice } from '../src/audio.ts'

test('interrupting a fixed cue settles playback without speaking a fallback', async () => {
  let fallbackCount = 0
  globalThis.window = { speechSynthesis: { cancel() {}, speak() { fallbackCount++ } } }
  globalThis.Audio = class {
    addEventListener() {}
    play() { return Promise.resolve() }
    pause() {}
    removeAttribute() {}
  }
  const playback = speak('Hello', 'english', 'welcome')
  stopVoice()
  await Promise.race([playback, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Playback remained pending after interruption')), 100); timer.unref() })])
  assert.equal(fallbackCount, 0)
})
