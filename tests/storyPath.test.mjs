import test from 'node:test'
import assert from 'node:assert/strict'
import { readingPath } from '../src/storyPath.ts'
import catalog from '../src/data/stories.json' with { type: 'json' }

test('reader shows one coherent story, not every alternative branch', () => {
  for (const story of catalog.stories) {
    const path = readingPath(story)
    assert.equal(path.length, story.typicalPathLength)
    for (const branch of path[0].checkpoint.branches) {
      const chosen = readingPath(story, [story.startBeatId, branch.nextBeatId])
      assert.equal(chosen[1].id, branch.nextBeatId)
      assert.equal(chosen.length, story.typicalPathLength)
    }
  }
})
