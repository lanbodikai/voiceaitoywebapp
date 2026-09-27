import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {EventEmitter,once} from 'node:events'
import WebSocket from 'ws'
import {attachStreamingVoice} from '../server/streaming-voice.mjs'
import {evaluateAnswer,generateSpokenLine} from '../api/index.mjs'

test('progressive reply sends the safe line before audio, then ordered MP3 chunks',async()=>{
  const oldFetch=globalThis.fetch,oldPilot=process.env.CHILD_PILOT_MODE,oldKey=process.env.OPENAI_API_KEY
  process.env.CHILD_PILOT_MODE='false';process.env.OPENAI_API_KEY='synthetic'
  globalThis.fetch=async()=>Response.json({value:'synthetic'})
  class UpstreamSocket extends EventEmitter {
    readyState=1;bufferedAmount=0
    constructor(){super();queueMicrotask(()=>this.emit('message',JSON.stringify({type:'session.created'})))}
    send(){}terminate(){this.readyState=3}
  }
  let releaseAudio
  const server=createServer()
  const sockets=attachStreamingVoice(server,async()=>({safe:true,categories:[]}),{
    reply:async()=>{throw new Error('buffered path should not run')},
    replyStream:async()=>({line:'Safe synthetic line',action:'continue'}),
    streamAudio:async(_text,_language,onChunk,signal)=>{
      await new Promise(resolve=>{releaseAudio=resolve})
      signal.throwIfAborted()
      await onChunk(Buffer.from('ID3'))
    },
  },{UpstreamSocket,authenticate:async()=>({profileID:'synthetic-progressive-test'})})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  let client
  try{
    client=new WebSocket(`ws://127.0.0.1:${server.address().port}/web/voice-stream`)
    await once(client,'open')
    let next=once(client,'message');client.send(JSON.stringify({type:'auth',token:'synthetic',language:'english'}))
    assert.ok(JSON.parse((await next)[0].toString()).capabilities.includes('reply_stream'))
    next=once(client,'message')
    client.send(JSON.stringify({type:'reply',requestID:1,body:{preferProgressive:true,language:'english'}}))
    const early=JSON.parse((await next)[0].toString())
    assert.equal(early.result.line,'Safe synthetic line')
    assert.equal(early.result.speech.stream,true)
    const audioEvents=[];client.on('message',raw=>audioEvents.push(JSON.parse(raw.toString())))
    releaseAudio()
    const deadline=Date.now()+2000
    while(audioEvents.length<2 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5))
    assert.deepEqual(audioEvents[0],{type:'reply_audio_chunk',requestID:1,audio:'SUQz'})
    assert.equal(audioEvents[1]?.type,'reply_audio_done')
  }finally{
    client?.terminate();for(const socket of sockets.clients)socket.terminate()
    await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve))
    globalThis.fetch=oldFetch
    if(oldPilot===undefined)delete process.env.CHILD_PILOT_MODE;else process.env.CHILD_PILOT_MODE=oldPilot
    if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey
  }
})

test('authenticated socket grading preserves validation, moderation, and authoritative rubric; cancels upstream work',async()=>{
  const oldFetch=globalThis.fetch,oldPilot=process.env.CHILD_PILOT_MODE,oldKey=process.env.OPENAI_API_KEY
  process.env.CHILD_PILOT_MODE='false';process.env.OPENAI_API_KEY='synthetic'
  let authCalls=0,gradeCalls=0,pendingSignal
  const evaluated=[]
  globalThis.fetch=async(url,init)=>{
    if(url.endsWith('/client_secrets'))return Response.json({value:'synthetic'})
    const body=JSON.parse(init.body)
    if(url.endsWith('/moderations'))return Response.json({results:[{flagged:body.input==='unsafe synthetic',categories:{}}]})
    gradeCalls++;evaluated.push(JSON.parse(body.input.at(-1).content))
    if(evaluated.at(-1).learnerSpeech==='cancel synthetic') {
      pendingSignal=init.signal
      return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
    }
    return Response.json({output_text:JSON.stringify({meaningStatus:'clear',verdict:'correct',language:'english',matchedConcepts:[],confidence:0.99})})
  }
  class UpstreamSocket extends EventEmitter {
    readyState=1;bufferedAmount=0
    constructor(){super();queueMicrotask(()=>this.emit('message',JSON.stringify({type:'session.created'})))}
    send(){}terminate(){this.readyState=3}
  }
  const server=createServer()
  const sockets=attachStreamingVoice(server,async()=>({safe:true,categories:[]}),{evaluate:evaluateAnswer},{UpstreamSocket,authenticate:async(token,action)=>{assert.equal(token,'Bearer synthetic');assert.equal(action,'load');authCalls++;return {profileID:'synthetic-rpc-test'}}})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  let client,unauthenticated
  const next=async()=>JSON.parse((await once(client,'message'))[0].toString())
  try {
    const url=`ws://127.0.0.1:${server.address().port}/web/voice-stream`
    unauthenticated=new WebSocket(url);await once(unauthenticated,'open')
    const closed=once(unauthenticated,'close');unauthenticated.send(JSON.stringify({type:'evaluate',requestID:1,body:{}}));await closed
    assert.equal(gradeCalls,0);assert.equal(authCalls,0)
    client=new WebSocket(url);await once(client,'open')
    let reply=next();client.send(JSON.stringify({type:'auth',token:'synthetic',language:'english'}))
    assert.deepEqual((await reply).capabilities,['evaluate'])
    const body={storyID:'choochoo-birthday-cake',checkpointID:'call-a-friend',targetLanguage:'english',transcript:'safe synthetic',rubric:{question:'malicious override'}}
    for(const [requestID,change] of [[1,{}],[2,{transcript:'unsafe synthetic'}],[3,{targetLanguage:'unknown'}],[4,{checkpointID:'missing'}]]) {
      reply=next();client.send(JSON.stringify({type:'evaluate',requestID,body:{...body,...change}}))
      const result=await reply
      assert.equal(result.requestID,requestID)
      assert.equal(result.type,requestID===1?'reply':'request_error')
      if(requestID===1)assert.equal(result.result.verdict,'correct')
    }
    assert.equal(authCalls,1,'consent/auth checked once for the connection')
    assert.equal(gradeCalls,1,'unsafe or invalid speech never reaches grading')
    assert.notEqual(evaluated[0].question,'malicious override')
    client.send(JSON.stringify({type:'evaluate',requestID:5,body:{...body,transcript:'cancel synthetic'}}))
    const deadline=Date.now()+2000
    while(!pendingSignal && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5))
    assert.ok(pendingSignal)
    client.send(JSON.stringify({type:'cancel_request',requestID:5}))
    if(!pendingSignal.aborted)await once(pendingSignal,'abort')
    assert.equal(pendingSignal.aborted,true)
  }finally {
    client?.terminate();unauthenticated?.terminate()
    for(const socket of sockets.clients)socket.terminate()
    await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve))
    globalThis.fetch=oldFetch
    if(oldPilot===undefined)delete process.env.CHILD_PILOT_MODE;else process.env.CHILD_PILOT_MODE=oldPilot
    if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey
  }
})

test('streaming safety proof skips only the duplicate moderation of the exact transcript',async()=>{
  const oldFetch=globalThis.fetch,oldPilot=process.env.CHILD_PILOT_MODE,oldKey=process.env.OPENAI_API_KEY
  process.env.CHILD_PILOT_MODE='false';process.env.OPENAI_API_KEY='synthetic'
  let streamModerations=0,apiModerations=0,grades=0
  globalThis.fetch=async(url,init)=>{
    if(url.endsWith('/client_secrets'))return Response.json({value:'synthetic'})
    if(url.endsWith('/moderations')){apiModerations++;return Response.json({results:[{flagged:JSON.parse(init.body).input==='unsafe synthetic',categories:{}}]})}
    grades++;return Response.json({output_text:JSON.stringify({meaningStatus:'clear',verdict:'correct',language:'english',matchedConcepts:['thanks'],confidence:0.99})})
  }
  class UpstreamSocket extends EventEmitter {
    readyState=1;bufferedAmount=0
    constructor(){super();queueMicrotask(()=>this.emit('message',JSON.stringify({type:'session.created'})))}
    send(value){
      if(JSON.parse(value).type!=='input_audio_buffer.commit')return
      queueMicrotask(()=>{
        this.emit('message',JSON.stringify({type:'input_audio_buffer.committed',item_id:'synthetic-item'}))
        this.emit('message',JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'synthetic-item',transcript:'thanks'}))
      })
    }
    terminate(){this.readyState=3}
  }
  const server=createServer()
  const sockets=attachStreamingVoice(server,async()=>{streamModerations++;return {safe:true,categories:[]}},{evaluate:evaluateAnswer},{UpstreamSocket,authenticate:async()=>({profileID:'synthetic-proof-test'})})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  let client
  try {
    client=new WebSocket(`ws://127.0.0.1:${server.address().port}/web/voice-stream`);await once(client,'open')
    let reply=once(client,'message');client.send(JSON.stringify({type:'auth',token:'synthetic',language:'english'}));assert.equal(JSON.parse((await reply)[0]).type,'ready')
    client.send(JSON.stringify({type:'begin',turn:1,language:'english',storyID:'choochoo-noodle-shop',beatID:'bengbeng-thanks'}))
    client.send(Buffer.alloc(4800))
    reply=once(client,'message');client.send(JSON.stringify({type:'commit',turn:1}))
    assert.equal(JSON.parse((await reply)[0]).transcript,'thanks')
    assert.equal(streamModerations,1)
    const body={storyID:'choochoo-noodle-shop',checkpointID:'bengbeng-thanks',targetLanguage:'english',transcript:'thanks'}
    reply=once(client,'message');client.send(JSON.stringify({type:'evaluate',requestID:1,body}))
    assert.equal(JSON.parse((await reply)[0]).type,'reply')
    assert.equal(apiModerations,0,'exact trusted transcript uses its streaming moderation')
    reply=once(client,'message');client.send(JSON.stringify({type:'evaluate',requestID:2,body:{...body,transcript:'unsafe synthetic'}}))
    assert.equal(JSON.parse((await reply)[0]).type,'request_error')
    assert.equal(apiModerations,1,'changed text must be moderated again')
    assert.equal(grades,1,'unsafe changed text never reaches grading')
  }finally{
    client?.terminate();for(const socket of sockets.clients)socket.terminate()
    await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve))
    globalThis.fetch=oldFetch
    if(oldPilot===undefined)delete process.env.CHILD_PILOT_MODE;else process.env.CHILD_PILOT_MODE=oldPilot
    if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey
  }
})

test('a fixed retry skips speech synthesis but still moderates input and output',async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY='synthetic'
  let moderations=0,models=0
  globalThis.fetch=async(url)=>{
    if(url.endsWith('/moderations')){moderations++;return Response.json({results:[{flagged:false,categories:{}}]})}
    models++;return Response.json({output_text:JSON.stringify({action:'retry',confidence:0.99})})
  }
  try {
    const result=await generateSpokenLine({kind:'openReply',language:'english',learnerSpeech:'garbled synthetic words',previousLine:'Synthetic question?',preferFixedFeedback:true})
    assert.equal(result.action,'retry');assert.equal(result.speech,undefined)
    assert.equal(moderations,2);assert.equal(models,2)
  }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey}
})
