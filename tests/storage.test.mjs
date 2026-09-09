import test from 'node:test'
import assert from 'node:assert/strict'
import { readStored, writeStored } from '../src/storage.ts'

test('unavailable browser storage does not break navigation', () => {
  globalThis.localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  assert.equal(readStored('preferences', 'default'), 'default')
  assert.doesNotThrow(() => writeStored('preferences', {}))
})
test('corrupt progress falls back safely', () => {
  globalThis.localStorage = { getItem() { return '{broken' } }
  assert.deepEqual(readStored('rewards', []), [])
})
