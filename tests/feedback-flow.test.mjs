import test from 'node:test'
import assert from 'node:assert/strict'
import catalog from '../src/data/stories.json' with { type: 'json' }
import { evaluateLocal } from '../src/evaluator.ts'
import { wantsToListen } from '../src/conversationIntents.ts'
import { storyFromSpeech } from '../src/storySelection.ts'
import { localizedRubric } from '../server/conversation-boundaries.mjs'
import { transcriptionConfig } from '../server/streaming-voice.mjs'
import { evaluate } from '../api/index.mjs'

const stories = catalog.stories
const noodle = stories.find(story => story.id === 'choochoo-noodle-shop')
const thanks = noodle.beats.find(beat => beat.checkpoint.id === 'bengbeng-thanks').checkpoint

test('a short true part of Bengbeng’s reply is enough, in either language', () => {
  for (const [speech, language] of [['thanks','english'],['thank you','english'],['yummy','english'],['She said thanks','english'],['Thank you, so yummy','english'],['谢谢','chinese'],['好吃','chinese'],['谢谢啾啾','chinese']]) {
    assert.equal(evaluateLocal(speech, thanks, language).verdict, 'correct', speech)
  }
  assert.equal(evaluateLocal('thanks', thanks, 'chinese').verdict, 'meaningUnderstood')
  assert.deepEqual(localizedRubric(noodle.id, thanks.id, 'english').sufficientConceptIDs, ['thanks','yummy'])
  assert.notEqual(evaluateLocal('goodbye', thanks, 'english').verdict, 'correct')
})

test('remote grading applies the same sufficient-answer rule without accepting a negation', async () => {
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'synthetic-test-key'
  try {
    const rubric = localizedRubric(noodle.id, thanks.id, 'english')
    const answers = [{ verdict: 'partial', matchedConcepts: ['thanks'] }, { verdict: 'incorrect', matchedConcepts: ['thanks'] }]
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body)
      assert.deepEqual(JSON.parse(body.input.at(-1).content).sufficientConceptIDs, ['thanks','yummy'])
      const answer = answers.shift()
      return new Response(JSON.stringify({ output_text: JSON.stringify({ meaningStatus: 'clear', language: 'english', confidence: 0.95, ...answer }) }))
    }
    assert.equal((await evaluate({ rubric, transcript: 'She said thanks' })).verdict, 'correct')
    assert.equal((await evaluate({ rubric, transcript: 'She did not thank him' })).verdict, 'incorrect')
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey
  }
})

test('a child can ask to keep listening without an evaluator call', () => {
  for (const speech of ["I don't know", 'dunno', 'just listen', '不知道', '我不知道', '继续讲故事']) assert.equal(wantsToListen(speech), true, speech)
  for (const speech of ['I know', 'Thanks', 'Maybe a duck']) assert.equal(wantsToListen(speech), false, speech)
})

test('voice story choice accepts one clear title and rejects ambiguous speech', () => {
  assert.equal(storyFromSpeech('I want the noodle shop', stories)?.id, noodle.id)
  assert.equal(storyFromSpeech('小母鸡佩妮', stories)?.id, 'henny-penny')
  assert.equal(storyFromSpeech('小红母鸡', stories)?.id, 'little-red-hen')
  assert.equal(storyFromSpeech('surprise me', stories), 'surprise')
  assert.equal(storyFromSpeech('farm and noodle shop', stories), null)
  assert.equal(storyFromSpeech('birthday', stories)?.id, 'choochoo-birthday-cake')
  assert.ok(transcriptionConfig('english','story-picker','choose').audio.input.transcription.keywords.includes('Noodle Shop'))
  assert.ok(transcriptionConfig('chinese','story-picker','choose').audio.input.transcription.keywords.includes('小面馆'))
})
