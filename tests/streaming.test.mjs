import test from 'node:test'
import assert from 'node:assert/strict'
import { StreamingSpeech, pcmFrame } from '../src/StreamingSpeech.ts'
import { takeSafety,rememberSafety,clearSpeechMemory,prepareSpeech } from '../src/preparedSpeech.ts'
import { setSpeechRate, speak } from '../src/audio.ts'

test('speech chunks are sent before commit, reuse a socket, and discard stale turns',async()=>{
  let instance,connections=0
  globalThis.WebSocket=class {
    static OPEN=1
    readyState=1;bufferedAmount=0;sent=[]
    constructor(){instance=this;connections++;queueMicrotask(()=>this.onopen())}
    send(data){this.sent.push(typeof data==='string'?JSON.parse(data):data.slice());if(typeof data==='string'&&JSON.parse(data).type==='auth')queueMicrotask(()=>this.deliver({type:'ready'}))}
    deliver(data){this.onmessage({data:JSON.stringify(data)})}
    close(){this.readyState=3;this.onclose()}
  }
  const speech=new StreamingSpeech(()=>{})
  await speech.connect('synthetic','english')
  const context={language:'english',storyID:'story',beatID:'beat'}
  speech.begin(context)
  for(let i=0;i<3;i++)speech.append(new Float32Array(512).fill(.5))
  assert.ok(instance.sent.some(item=>item instanceof Uint8Array && item.length===4608),'96ms is sent while still speaking')
  assert.equal(instance.sent.some(item=>item.type==='commit'),false)
  const cancelled=speech.commit();const rejected=assert.rejects(cancelled)
  speech.begin(context);await rejected
  speech.append(new Float32Array(512));const result=speech.commit()
  instance.deliver({type:'transcript',turn:1,transcript:'stale'})
  instance.deliver({type:'transcript',turn:2,transcript:'current',safety:{safe:true,categories:[]}})
  assert.equal((await result).transcript,'current')
  assert.equal(connections,1)
  const response=speech.request('reply',{learnerSpeech:'hi'})
  instance.deliver({type:'reply',requestID:1,result:{line:'hello'}})
  assert.equal((await response).line,'hello')
  const cancelledReply=speech.request('reply',{learnerSpeech:'hi'})
  const rejectedReply=assert.rejects(cancelledReply)
  speech.begin(context);await rejectedReply
  speech.close()
  assert.throws(()=>speech.begin(context))
})

test('PCM chunks have the expected sample rate, bounds and amplitude',()=>{
  const pcm=pcmFrame(new Float32Array(512).fill(-1))
  assert.equal(pcm.length,1536)
  assert.equal(new DataView(pcm.buffer).getInt16(0,true),-32768)
})

test('progressive reply resolves before audio finishes and interruption cancels its stream',async()=>{
  let socket
  globalThis.WebSocket=class {
    static OPEN=1
    readyState=1;bufferedAmount=0;sent=[]
    constructor(){socket=this;queueMicrotask(()=>this.onopen())}
    send(raw){const data=JSON.parse(raw);this.sent.push(data);if(data.type==='auth')queueMicrotask(()=>this.deliver({type:'ready',capabilities:['reply','reply_stream']}))}
    deliver(data){this.onmessage({data:JSON.stringify(data)})}
    close(){this.readyState=3;this.onclose()}
  }
  const speech=new StreamingSpeech(()=>{})
  await speech.connect('synthetic','english')
  const pending=speech.request('reply',{preferProgressive:true})
  socket.deliver({type:'reply',requestID:1,result:{line:'Hello',action:'continue',speech:{stream:true,mimeType:'audio/mpeg',provider:'deepgram-aura-2'}}})
  const result=await pending
  const reader=result.speech.stream.getReader()
  socket.deliver({type:'reply_audio_chunk',requestID:1,audio:'SUQz'})
  assert.deepEqual(Array.from((await reader.read()).value),[73,68,51])
  socket.deliver({type:'reply_audio_done',requestID:1})
  assert.equal((await reader.read()).done,true)
  const next=speech.request('reply',{preferProgressive:true})
  socket.deliver({type:'reply',requestID:2,result:{line:'Again',speech:{stream:true,mimeType:'audio/mpeg',provider:'edge-tts'}}})
  const second=await next
  await second.speech.stream.cancel()
  assert.equal(socket.sent.at(-1).type,'cancel_request')
  speech.close()
})

test('stream moderation is consumed once and erased on interruption',()=>{
  rememberSafety('hello',{safe:true,categories:[]})
  assert.equal(takeSafety('different'),undefined)
  assert.equal(takeSafety('hello'),undefined)
  rememberSafety('hello',{safe:false,categories:['test']})
  assert.equal(takeSafety('hello').safe,false)
  rememberSafety('hello',{safe:true,categories:[]});clearSpeechMemory()
  assert.equal(takeSafety('hello'),undefined)
})

test('generated replies play prepared Edge audio, never a browser voice',async()=>{
  let source,rate,preservesPitch,revoked=false
  globalThis.Audio=class {
    constructor(url){source=url;this.listeners={}}
    set playbackRate(value){rate=value}
    set preservesPitch(value){preservesPitch=value}
    addEventListener(event,fn){this.listeners[event]=fn}
    async play(){queueMicrotask(()=>this.listeners.ended())}
    pause(){} removeAttribute(){}
  }
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL
  URL.createObjectURL=()=> 'blob:edge-test';URL.revokeObjectURL=()=>{revoked=true}
  try {
    setSpeechRate(.8)
    prepareSpeech('Hi','english',{audioBase64:'SUQz',mimeType:'audio/mpeg',provider:'edge-tts',voice:'en-US-JennyNeural'})
    assert.equal(await speak('Hi','english'),true)
    assert.equal(source,'blob:edge-test');assert.equal(rate,.8);assert.equal(preservesPitch,true);assert.equal(revoked,true)
  } finally {URL.createObjectURL=create;URL.revokeObjectURL=revoke}
})
