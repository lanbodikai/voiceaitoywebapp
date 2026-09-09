import test from 'node:test'
import assert from 'node:assert/strict'
import { learningEvents, progressSnapshot } from '../server/progress-store.mjs'
const snapshot = {beatID:'call-a-friend',phase:'story',attemptCount:2,hintLevel:1,completed:false,beatPath:['call-a-friend'],completedCheckpoints:[],rewardIDs:[],vocabularyIDs:['friend']}
test('only structured learning metrics survive event sanitization', () => {
  assert.deepEqual(learningEvents([{sequence:1,type:'answer_evaluated',payload:{beatID:'call-a-friend',verdict:'incorrect',transcript:'private',name:'private',email:'private'}},{sequence:2,type:'dynamic_line',payload:{text:'private'}}]),[{sequence:1,kind:'answer_evaluated',beatID:'call-a-friend',verdict:'incorrect'}])
})
test('progress excludes extra fields and bounds all counters', () => {
  assert.deepEqual(progressSnapshot({...snapshot,transcript:'private'}),snapshot)
  assert.throws(() => progressSnapshot({...snapshot,hintLevel:99}))
  assert.throws(() => progressSnapshot({...snapshot,beatID:'unknown'}))
  assert.throws(() => progressSnapshot({...snapshot,vocabularyIDs:['arbitrary sentence with spaces']}))
  assert.throws(() => learningEvents(Array(101).fill({})))
})
