import test from 'node:test'
import assert from 'node:assert/strict'
import {setVoiceRPC,getVoiceRPC} from '../src/voiceTransport.ts'
import {StreamingSpeech} from '../src/StreamingSpeech.ts'

test('an older voice server keeps grading on HTTP; capabilities clear on disconnect',()=>{
  const rpc=async()=>({})
  setVoiceRPC(rpc);assert.equal(getVoiceRPC('evaluate'),undefined);assert.equal(getVoiceRPC('reply'),rpc)
  setVoiceRPC(rpc,['reply','synthesize','evaluate']);assert.equal(getVoiceRPC('evaluate'),rpc)
  setVoiceRPC(undefined);assert.equal(getVoiceRPC('evaluate'),undefined);assert.equal(getVoiceRPC(),undefined)
})

test('grading reuses a capable socket and supports interruption without a second request',async()=>{
  let socket
  globalThis.WebSocket=class {
    static OPEN=1
    readyState=1;bufferedAmount=0;sent=[]
    constructor(){socket=this;queueMicrotask(()=>this.onopen())}
    send(raw){const data=JSON.parse(raw);this.sent.push(data);if(data.type==='auth')queueMicrotask(()=>this.deliver({type:'ready',capabilities:['reply','synthesize','evaluate']}))}
    deliver(data){this.onmessage({data:JSON.stringify(data)})}
    close(){this.readyState=3;this.onclose()}
  }
  const speech=new StreamingSpeech(()=>{})
  await speech.connect('synthetic','english')
  assert.ok(speech.capabilities.includes('evaluate'))
  const answer=speech.request('evaluate',{transcript:'synthetic'})
  socket.deliver({type:'reply',requestID:1,result:{verdict:'correct'}})
  assert.deepEqual(await answer,{verdict:'correct'})
  const abort=new AbortController(),pending=speech.request('evaluate',{},abort.signal)
  const rejected=assert.rejects(pending,/cancelled/);abort.abort();await rejected
  assert.equal(socket.sent.filter(item=>item.type==='evaluate').length,2)
  assert.equal(socket.sent.at(-1).type,'cancel_request')
  speech.close()
})
