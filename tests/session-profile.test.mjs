import test from 'node:test'
import assert from 'node:assert/strict'
import {activeSessionID,completeActiveSession,nextEventSequence} from '../src/session.ts'
import {learnerProfile,nameFromSpeech,rememberLearnerName} from '../src/learnerProfile.ts'

function storage() {
  const values=new Map()
  return {getItem:(key)=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:(key)=>values.delete(key),key:(index)=>[...values.keys()][index]??null,get length(){return values.size}}
}

test('one guest reuses an active visit across reloads but a completed visit gets a fresh id',()=>{
  globalThis.localStorage=storage()
  localStorage.setItem('choochoo:guest-profile',JSON.stringify('guest-a'))
  const scope={mode:'story',storyID:'story-a',language:'english'}
  const first=activeSessionID(scope)
  assert.equal(activeSessionID(scope),first)
  assert.equal(nextEventSequence(scope),1)
  assert.equal(nextEventSequence(scope),2)
  completeActiveSession(scope)
  assert.notEqual(activeSessionID(scope),first)
  assert.equal(nextEventSequence(scope),1)
})

test('nickname parsing is conversational and the asked flag is isolated by guest',()=>{
  globalThis.localStorage=storage()
  localStorage.setItem('choochoo:guest-profile',JSON.stringify('guest-a'))
  assert.equal(nameFromSpeech('My name is Luna!'),'Luna')
  assert.equal(nameFromSpeech('我叫小雨。'),'小雨')
  assert.equal(nameFromSpeech('Captain Banana'),'Captain Banana')
  assert.equal(nameFromSpeech("I don't want to tell"),undefined)
  for (const command of ['Continue','continue the story',"I'm ready",'准备好了','暂停']) assert.equal(nameFromSpeech(command),undefined)
  localStorage.setItem('choochoo:learner:guest-a',JSON.stringify({name:'Continue',nameAsked:true}))
  assert.deepEqual(learnerProfile(),{name:undefined,nameAsked:true})
  rememberLearnerName('Luna')
  assert.deepEqual(learnerProfile(),{name:'Luna',nameAsked:true})
  localStorage.setItem('choochoo:guest-profile',JSON.stringify('guest-b'))
  assert.deepEqual(learnerProfile(),{name:undefined,nameAsked:false})
})
