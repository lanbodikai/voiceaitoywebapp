import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { tryJevEvaluation } from '../server/jev-evaluation.mjs'
import { localizedRubric } from '../server/conversation-boundaries.mjs'
import { evaluateAnswer } from '../api/index.mjs'

const original = {
  enabled: process.env.JEV_GRADING_ENABLED,
  typesafe: process.env.TYPESAFE_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  fetch: globalThis.fetch,
}

function enable() {
  process.env.JEV_GRADING_ENABLED = 'true'
  process.env.TYPESAFE_API_KEY = 'synthetic-typesafe-key'
  process.env.OPENAI_API_KEY = 'synthetic-openai-key'
}

function restore() {
  for (const [name, value] of [
    ['JEV_GRADING_ENABLED', original.enabled],
    ['TYPESAFE_API_KEY', original.typesafe],
    ['OPENAI_API_KEY', original.openai],
  ]) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  globalThis.fetch = original.fetch
}

function answers(selected = 'fox', probability = 0.97) {
  return {
    relevant: { type: 'noul', noul: 0.98 },
    target_language: { type: 'noul', noul: 0.99 },
    selected: { type: 'choice', choice: selected, probabilities: { [selected]: probability }, confidence: 0.91 },
  }
}

test('Jev accepts only a high-confidence target-language choice and preserves its branch', async () => {
  enable()
  try {
    const rubric = localizedRubric('choochoo-birthday-cake', 'call-a-friend', 'english')
    let request
    const result = await tryJevEvaluation({ rubric, transcript: 'Call Feifei the fox' }, undefined, async (url, init) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone')
      request = JSON.parse(init.body)
      return Response.json({ answers: answers() })
    })
    assert.equal(request.model, 'jev-1.13.0')
    assert.equal(request.state.learnerSpeech, 'Call Feifei the fox')
    assert.deepEqual(result.matchedConcepts, ['fox'])
    assert.equal(result.verdict, 'correct')
    assert.equal(result.language, 'english')
  } finally { restore() }
})

test('ambiguous, malformed, failed, and other-language Jev results use the existing grader', async () => {
  enable()
  try {
    const rubric = localizedRubric('choochoo-birthday-cake', 'call-a-friend', 'english')
    for (const result of [
      { answers: answers('fox', 0.6) },
      { answers: { ...answers(), relevant: { type: 'noul', noul: 0.2 } } },
      { answers: { ...answers(), target_language: { type: 'noul', noul: 0.4 } } },
      { answers: { ...answers(), relevant: undefined } },
      { answers: answers('invented', 0.99) },
    ]) {
      assert.equal(await tryJevEvaluation({ rubric, transcript: 'Feifei' }, undefined, async () => Response.json(result)), undefined)
    }
    assert.equal(await tryJevEvaluation({ rubric, transcript: '菲菲' }, undefined, async () => { throw Error('must not call Jev') }), undefined)
    assert.equal(await tryJevEvaluation({ rubric, transcript: 'Feifei' }, undefined, async () => { throw Error('provider down') }), undefined)
    const openRubric = localizedRubric('choochoo-birthday-cake', 'your-birthday-cake', 'english')
    if (openRubric) assert.equal(await tryJevEvaluation({ rubric: openRubric, transcript: 'A dragon cake' }, undefined, async () => { throw Error('must not call Jev') }), undefined)
  } finally { restore() }
})

test('Jev is opt-in and a timed-out request falls back without accepting an answer', async () => {
  enable()
  try {
    const rubric = localizedRubric('choochoo-birthday-cake', 'call-a-friend', 'english')
    delete process.env.TYPESAFE_API_KEY
    assert.equal(await tryJevEvaluation({ rubric, transcript: 'Feifei' }, undefined, async () => { throw Error('must not call') }), undefined)
    process.env.TYPESAFE_API_KEY = 'synthetic-typesafe-key'
    process.env.JEV_GRADING_ENABLED = 'false'
    assert.equal(await tryJevEvaluation({ rubric, transcript: 'Feifei' }, undefined, async () => { throw Error('must not call') }), undefined)
    process.env.JEV_GRADING_ENABLED = 'true'
    const started = Date.now()
    const result = await tryJevEvaluation({ rubric, transcript: 'Feifei' }, undefined, async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    }))
    assert.equal(result, undefined)
    assert.ok(Date.now() - started < 1500)
  } finally { restore() }
})

test('comprehension fast path respects sufficient concepts and rejects missing concepts', async () => {
  enable()
  try {
    const rubric = localizedRubric('choochoo-noodle-shop', 'bengbeng-thanks', 'english')
    assert.ok(rubric.sufficientConceptIDs.length)
    const conceptAnswers = Object.fromEntries(rubric.requiredConcepts.map((concept, index) => [
      `concept_${index}`, { type: 'noul', noul: concept.id === rubric.sufficientConceptIDs[0] ? 0.96 : 0.1 },
    ]))
    const mock = async () => Response.json({ answers: {
      relevant: { type: 'noul', noul: 0.99 }, target_language: { type: 'noul', noul: 0.99 }, ...conceptAnswers,
    } })
    const result = await tryJevEvaluation({ rubric, transcript: 'Thank you' }, undefined, mock)
    assert.equal(result.verdict, 'correct')
    assert.deepEqual(result.matchedConcepts, [rubric.sufficientConceptIDs[0]])
    assert.equal(await tryJevEvaluation({ rubric, transcript: 'Thank you' }, undefined,
      async () => Response.json({ answers: { relevant: { type: 'noul', noul: 0.99 }, target_language: { type: 'noul', noul: 0.99 } } })), undefined)
  } finally { restore() }
})

test('moderation runs before Jev; old consent and unclear Jev use OpenAI', async () => {
  enable()
  const body = { storyID: 'choochoo-birthday-cake', checkpointID: 'call-a-friend', targetLanguage: 'english', transcript: 'Call Feifei the fox' }
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(url)
    if (url.endsWith('/moderations')) return Response.json({ results: [{ flagged: false, categories: {} }] })
    if (url.endsWith('/systemone')) return Response.json({ answers: answers() })
    return Response.json({ output_text: JSON.stringify({ meaningStatus: 'clear', verdict: 'correct', language: 'english', matchedConcepts: ['fox'], confidence: 0.99 }) })
  }
  try {
    const fast = await evaluateAnswer(body, undefined, undefined, 'web-handsfree-1.4')
    assert.equal(fast.verdict, 'correct')
    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/v1/moderations', '/v1/systemone'])
    calls.length = 0
    const legacy = await evaluateAnswer(body, undefined, undefined, 'web-handsfree-1.3')
    assert.equal(legacy.verdict, 'correct')
    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/v1/responses'])
    calls.length = 0
    globalThis.fetch = async (url) => {
      calls.push(url)
      if (url.endsWith('/moderations')) return Response.json({ results: [{ flagged: false, categories: {} }] })
      if (url.endsWith('/systemone')) return Response.json({ answers: answers('fox', 0.3) })
      return Response.json({ output_text: JSON.stringify({ meaningStatus: 'clear', verdict: 'correct', language: 'english', matchedConcepts: ['fox'], confidence: 0.99 }) })
    }
    const fallback = await evaluateAnswer(body, undefined, undefined, 'web-handsfree-1.4')
    assert.equal(fallback.verdict, 'correct')
    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/v1/systemone', '/v1/responses'])
    calls.length = 0
    globalThis.fetch = async (url) => { calls.push(url); return Response.json({ results: [{ flagged: true, categories: {} }] }) }
    const unsafe = { ...body, transcript: 'Different synthetic unsafe speech' }
    await assert.rejects(evaluateAnswer(unsafe, undefined, undefined, 'web-handsfree-1.4'), error => error.statusCode === 422)
    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/v1/moderations'])
  } finally { restore() }
})

test('socket moderation proof avoids a second moderation but never bypasses consent', async () => {
  enable()
  const body = { storyID: 'choochoo-birthday-cake', checkpointID: 'call-a-friend', targetLanguage: 'english', transcript: 'Call Feifei the fox' }
  const calls = []
  globalThis.fetch = async url => {
    calls.push(url)
    if (url.endsWith('/systemone')) return Response.json({ answers: answers() })
    return Response.json({ output_text: JSON.stringify({ meaningStatus: 'clear', verdict: 'correct', language: 'english', matchedConcepts: ['fox'], confidence: 0.99 }) })
  }
  try {
    const proof = createHash('sha256').update(body.transcript).digest('hex')
    await evaluateAnswer(body, undefined, proof, 'web-handsfree-1.4')
    assert.deepEqual(calls.map(url => new URL(url).pathname), ['/v1/systemone'])
  } finally { restore() }
})
