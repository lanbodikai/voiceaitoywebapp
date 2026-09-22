import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { acceptCloudProgress, cacheProgress, collectPuzzle, savedCollections } from '../src/progress.ts'

function storage() {
  const values = new Map()
  globalThis.localStorage = {getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  return values
}

test('collections are unique, language-specific, and survive incomplete replay snapshots', () => {
  storage()
  acceptCloudProgress({profileID:'guest-one',stories:[]})
  collectPuzzle('henny-penny','english')
  collectPuzzle('henny-penny','english')
  collectPuzzle('henny-penny','chinese')
  cacheProgress('henny-penny','english',{beatID:'start',completed:false,completedCheckpoints:[]})
  assert.deepEqual(savedCollections(),[{storyID:'henny-penny',language:'english'},{storyID:'henny-penny',language:'chinese'}])
})

test('cloud merges preserve offline awards and accept old servers without collections', () => {
  storage()
  acceptCloudProgress({profileID:'offline-guest',stories:[]})
  collectPuzzle('little-red-hen','english')
  acceptCloudProgress({profileID:'offline-guest',stories:[],collections:[]})
  assert.equal(savedCollections().length,1)
  acceptCloudProgress({profileID:'offline-guest',stories:[]})
  assert.equal(savedCollections().length,1)
  acceptCloudProgress({profileID:'offline-guest',stories:[],collections:[{storyID:'henny-penny',language:'english'}]})
  assert.equal(savedCollections().length,2)
})

test('recovery and guest changes never copy awards from the previous guest', () => {
  storage()
  acceptCloudProgress({profileID:'guest-a',stories:[],collections:[{storyID:'little-red-hen',language:'english'}]})
  acceptCloudProgress({profileID:'guest-b',stories:[],collections:[{storyID:'henny-penny',language:'chinese'}]})
  assert.deepEqual(savedCollections(),[{storyID:'henny-penny',language:'chinese'}])
  acceptCloudProgress({profileID:'guest-a',stories:[]})
  assert.deepEqual(savedCollections(),[{storyID:'little-red-hen',language:'english'}])
})

test('corrupt collection caches and malformed entries fail safely without storing extra content', () => {
  const values=storage()
  acceptCloudProgress({profileID:'malformed-guest',stories:[]})
  values.set('choochoo:collections:malformed-guest','{"broken":true}')
  assert.deepEqual(savedCollections(),[])
  acceptCloudProgress({profileID:'malformed-guest',stories:[],collections:[null,{storyID:'henny-penny',language:'invalid'},{storyID:'henny-penny',language:'english',speech:'private'},{storyID:'henny-penny',language:'english'}]})
  assert.deepEqual(savedCollections(),[{storyID:'henny-penny',language:'english'}])
})

test('collection migration changes only load behavior and adds a historical event index', () => {
  const before=readFileSync(new URL('../supabase/20260910_handsfree_consent.sql',import.meta.url),'utf8')
  const after=readFileSync(new URL('../supabase/20260923_puzzle_collections.sql',import.meta.url),'utf8')
  assert.equal(after.slice(after.indexOf("  elsif p_action='recovery_create'")),before.slice(before.indexOf("  elsif p_action='recovery_create'")))
  assert.match(after,/s\.profile_id=pid and s\.mode='story'/)
  assert.match(after,/select distinct s\.story_id,s\.language/)
  assert.match(after,/e\.session_id=s\.id and e\.kind='puzzle_assembled'/)
  // PL/pgSQL needs parentheses around CASE inside this IF condition.
  assert.match(after,/sess\.story_id is distinct from \(case when .* else null end\)/)
})
