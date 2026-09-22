import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import catalog from '../src/data/stories.json' with { type: 'json' }
import cues from '../src/data/edge-cues.json' with { type: 'json' }
import { readingPath } from '../src/storyPath.ts'
import { storyFollowup } from '../src/storyFollowup.ts'
import { evaluateLocal } from '../src/evaluator.ts'
import { transcriptionConfig } from '../server/streaming-voice.mjs'
import { progressSnapshot } from '../server/progress-store.mjs'
import { conversationalLine } from '../api/index.mjs'

const ids = ['little-red-hen', 'henny-penny']
const migration = readFileSync(new URL('../supabase/20260911_classic_stories.sql', import.meta.url), 'utf8')
const forbidden = /选一个|从下面|以下选项|choose one|pick one|options below|sticker|贴纸|IMAGES,|picketty|loooong|whoo|[—…]/iu

for (const id of ids) {
  const story = catalog.stories.find(s => s.id === id)
  test(id + ': complete bilingual source adaptation follows the shared pipeline', () => {
    assert.ok(story)
    assert.ok(story.summary && story.englishSummary)
    assert.ok(story.summary.length < 1800 && story.englishSummary.length < 1800)
    assert.equal(readingPath(story).length, story.typicalPathLength)
    assert.equal(readingPath(story).at(-1).nextBeatId, null)
    for (const beat of story.beats) {
      const cp = beat.checkpoint
      assert.equal(beat.id, cp.id)
      assert.equal(cp.hints.length, 4)
      assert.deepEqual(cp.branches, [], 'preserve the supplied plot without inventing alternate endings')
      assert.equal(cp.reward.announcement, '', 'legacy schema does not produce sticker speech')
      const row = "('" + id + "','" + beat.id + "','" + cp.id + "','" + cp.reward.id + "',array[" + cp.vocabulary.map(v => "'" + v.id + "'").join(',') + "]::text[])"
      assert.ok(migration.includes(row), 'all progress identifiers are registered')
      for (const language of ['chinese','english']) {
        const en = language === 'english'
        const narration = en ? beat.englishNarration : beat.narration
        const question = en ? cp.englishQuestion : cp.question
        for (const line of [narration,question,storyFollowup(cp.id,language)]) {
          assert.doesNotMatch(line,forbidden)
          if (en) assert.doesNotMatch(line,/\p{Script=Han}/u)
          else assert.match(line,/\p{Script=Han}/u)
        }
        assert.doesNotMatch(storyFollowup(cp.id,language), /Sometimes it’s lovely|有时候，静静听故事/)
        const stt = transcriptionConfig(language,id,beat.id).audio.input.transcription
        assert.ok(stt.prompt.includes(question))
        assert.deepEqual(stt.languages,[en ? 'en' : 'zh'])
        for (const concept of cp.concepts) {
          assert.ok(stt.keywords.includes(concept[en ? 'en' : 'zh'][0]))
          assert.equal(evaluateLocal(concept[en ? 'en' : 'zh'][0],cp,language).verdict,'correct')
        }
        for (const cue of [beat.audioCue,cp.audioCue]) assert.ok(cues[(en ? 'en_' : '') + cue], 'certified narration and question: ' + cue)
      }
      for (const kind of ['recast','success','hint_1','hint_2','hint_3','hint_4']) assert.ok(cues[kind + '_' + id + '_' + cp.id])
      const snapshot = {beatID:beat.id,phase:'story',attemptCount:0,hintLevel:0,completed:false,beatPath:[beat.id],completedCheckpoints:[cp.id],rewardIDs:[],vocabularyIDs:cp.vocabulary.map(v=>v.id)}
      assert.deepEqual(progressSnapshot(snapshot),snapshot)
    }
  })
  test(id + ': closing is grounded and has no additional question', () => {
    for (const language of ['chinese','english']) {
      const result = conversationalLine({action:'continue',line:'Choose one below.'},{storyID:id,kind:'storyWrapup',language})
      assert.equal(result.action,'continue')
      assert.doesNotMatch(result.line,/[?？]|ChooChoo and Grandma|妙妙/)
      assert.match(result.line,id === 'little-red-hen' ? /Little Red Hen|小红母鸡/ : /Goosey Poosey|朵朵/)
    }
  })
}

test('the supplied endings are preserved in narration and reasoning context', () => {
  const hen = catalog.stories.find(s=>s.id === ids[0])
  const penny = catalog.stories.find(s=>s.id === ids[1])
  assert.match(hen.beats.at(-1).englishNarration,/She ate the bread/)
  assert.match(hen.summary,/自己吃了面包/)
  assert.match(penny.beats.at(-1).englishNarration,/ran safely home/)
  assert.match(penny.englishSummary,/without entering the den/)
  assert.match(penny.summary,/先停一停、看一看、想一想/)
})
