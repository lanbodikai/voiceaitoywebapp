import test from 'node:test'
import assert from 'node:assert/strict'
import { guestAction, learningEvents, progressSnapshot } from '../server/progress-store.mjs'
const snapshot = {beatID:'call-a-friend',phase:'story',attemptCount:2,hintLevel:1,completed:false,beatPath:['call-a-friend'],completedCheckpoints:[],rewardIDs:[],vocabularyIDs:['friend']}
test('only structured learning metrics survive event sanitization', () => {
  assert.deepEqual(learningEvents([
    {sequence:1,type:'answer_evaluated',payload:{beatID:'call-a-friend',verdict:'incorrect',transcript:'private',name:'private',email:'private'}},
    {sequence:2,type:'puzzle_piece_earned',payload:{beatID:'call-a-friend',transcript:'private'}},
    {sequence:3,type:'puzzle_assembled',payload:{}},
    {sequence:4,type:'dynamic_line',payload:{text:'private'}},
  ]),[
    {sequence:1,kind:'answer_evaluated',beatID:'call-a-friend',verdict:'incorrect'},
    {sequence:2,kind:'puzzle_piece_earned',beatID:'call-a-friend'},
    {sequence:3,kind:'puzzle_assembled'},
  ])
})
test('progress excludes extra fields and bounds all counters', () => {
  assert.deepEqual(progressSnapshot({...snapshot,transcript:'private'}),snapshot)
  assert.throws(() => progressSnapshot({...snapshot,hintLevel:99}))
  assert.throws(() => progressSnapshot({...snapshot,beatID:'unknown'}))
  assert.throws(() => progressSnapshot({...snapshot,vocabularyIDs:['arbitrary sentence with spaces']}))
  assert.throws(() => learningEvents(Array(101).fill({})))
})

test('a duplicate database session key is treated as an idempotent start retry', async (t) => {
  process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'public-test-key'
  let calls = 0
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => calls++ === 0
    ? new Response(JSON.stringify({code:'23505',message:'duplicate key value violates unique constraint "cc_sessions_pkey"'}), {status:409,headers:{'Content-Type':'application/json'}})
    : new Response('{"saved":true}', {status:200,headers:{'Content-Type':'application/json'}}))
  const sessionID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  assert.deepEqual(await guestAction('Bearer test', 'start', { sessionID }), { sessionID })
  assert.equal(fetchMock.mock.callCount(), 2)
})
