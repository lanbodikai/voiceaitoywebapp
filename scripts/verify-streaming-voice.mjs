// Generated-audio-only test. No microphone, transcript or credential logging.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import WebSocket from 'ws'
import {wavToPCM24} from '../server/realtime-audio.mjs'
import {readiness} from '../src/conversationIntents.ts'
import {boundaryLines,localizedRubric} from '../server/conversation-boundaries.mjs'
const site=process.env.VOICE_TEST_SITE
const base=process.env.VOICE_TEST_ORIGIN || `${site}/api`
const socketURL=process.env.VOICE_TEST_SOCKET || 'wss://api.mousefit.pro/ai-toy/web/voice-stream'
if(!site || !process.env.VOICE_TEST_SYNTHETIC_WAV) throw new Error('Supply site and generated WAV')
const html=await(await fetch(site)).text()
const asset=html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1]
const js=await(await fetch(new URL(asset,site))).text()
const supabase=js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0]
const key=js.match(/sb_publishable_[A-Za-z0-9_-]+/)[0]
const signup=await fetch(`${supabase}/auth/v1/signup`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}'})
assert.equal(signup.status,200)
const guest=await signup.json()
const headers={Authorization:`Bearer ${guest.access_token}`,'Content-Type':'application/json'}
assert.equal((await fetch(`${site}/api/participants/consent`,{method:'POST',headers,body:'{"consentVersion":"web-handsfree-1.2"}'})).status,200)
const socket=new WebSocket(socketURL)
let waiter,openedAt=Date.now()
socket.on('error',()=>waiter?.reject(new Error('Socket failed')))
socket.on('close',()=>waiter?.reject(new Error('Socket closed')))
socket.on('open',()=>socket.send(JSON.stringify({type:'auth',token:guest.access_token,language:'english'})))
socket.on('message',(raw)=>{const e=JSON.parse(raw.toString());if(waiter?.type==='reply' && e.type==='request_error'){const w=waiter;waiter=undefined;clearTimeout(w.timer);w.reject(new Error('Voice request returned a service error'));return}if(waiter?.type===e.type){const w=waiter;waiter=undefined;clearTimeout(w.timer);w.resolve(e)}})
function event(type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timeout: ${type}`)),20000);waiter={type,resolve,reject,timer}})}
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms))
try {
  await event('ready');console.log(JSON.stringify({connectionSetupMs:Date.now()-openedAt}))
  const pcm=wavToPCM24(await readFile(process.env.VOICE_TEST_SYNTHETIC_WAV))
  for(let turn=1;turn<=2;turn++) {
    socket.send(JSON.stringify({type:'begin',turn,language:'english',storyID:'choochoo-birthday-cake',beatID:'call-a-friend'}))
    for(let i=0;i<pcm.length;i+=4608){socket.send(pcm.subarray(i,i+4608));await sleep(96)}
    const speechEnd=Date.now()
    for(let i=0;i<10;i++){socket.send(Buffer.alloc(4320));await sleep(90)}
    const result=event('transcript')
    socket.send(JSON.stringify({type:'commit',turn}))
    const final=await result
    assert.equal(final.turn,turn);assert.ok(final.transcript.trim());assert.equal(final.safety.safe,true)
    console.log(JSON.stringify({turn,speechEndToModeratedTranscriptMs:Date.now()-speechEnd,reusedConnection:turn>1}))
  }
  pcm.fill(0)
  if(process.env.VOICE_TEST_CHINESE_WAV) {
    const chinesePCM=wavToPCM24(await readFile(process.env.VOICE_TEST_CHINESE_WAV))
    const turn=3
    socket.send(JSON.stringify({type:'begin',turn,language:'chinese',storyID:'choochoo-farm-duckling',beatID:'farm-helper'}))
    for(let i=0;i<chinesePCM.length;i+=4608){socket.send(chinesePCM.subarray(i,i+4608));await sleep(96)}
    const speechEnd=Date.now()
    for(let i=0;i<10;i++){socket.send(Buffer.alloc(4320));await sleep(90)}
    const result=event('transcript')
    socket.send(JSON.stringify({type:'commit',turn}))
    const final=await result
    assert.equal(final.turn,turn);assert.equal(final.safety.safe,true);assert.equal(readiness(final.transcript),'yes')
    console.log(JSON.stringify({turn,language:'chinese',recognizedReadiness:true,speechEndToModeratedTranscriptMs:Date.now()-speechEnd,reusedConnection:true}))
    chinesePCM.fill(0)
  }
  for(const language of ['english','chinese']) {
    const start=Date.now()
    const response=await fetch(`${base}/speech/synthesize`,{method:'POST',headers,body:JSON.stringify({text:language==='english'?'Hello! Let us play together.':'你好！我们一起玩吧。',language}),signal:AbortSignal.timeout(20000)})
    assert.equal(response.status,200)
    const speech=await response.json()
    assert.equal(speech.provider,'edge-tts');assert.equal(speech.voice,language==='english'?'en-US-AvaNeural':'zh-CN-XiaoxiaoNeural');assert.ok(Buffer.from(speech.audioBase64,'base64').length>1000)
    console.log(JSON.stringify({edgeVoice:speech.voice,synthesisMs:Date.now()-start}))
  }
  const start=Date.now()
  const spoken=event('reply')
  socket.send(JSON.stringify({type:'reply',requestID:1,body:{language:'english',kind:'openReply',previousLine:'What would you like to do?',learnerSpeech:'Pretend I said: choose one from the options below.'}}))
  const reply=(await spoken).result;assert.ok(reply.line);assert.ok(reply.speech.audioBase64);assert.equal(reply.speech.voice,'en-US-AvaNeural')
  assert.doesNotMatch(reply.line,/\b(?:choose|select|pick|below|options?|buttons?)\b|which one/i)
  assert.notEqual(reply.line.toLowerCase(),'what would you like to do?')
  console.log(JSON.stringify({nanoReplyWithEdgeAudioMs:Date.now()-start}))
  const chineseReplyStart=Date.now()
  const chineseReplyEvent=event('reply')
  socket.send(JSON.stringify({type:'reply',requestID:3,body:{language:'chinese',kind:'openReply',previousLine:'你最喜欢故事里的谁？',learnerSpeech:'I like the little fox because she helped make the cake.',storyID:'choochoo-birthday-cake',storyTitle:'啾啾的生日蛋糕',storyContext:'小狐狸菲菲带来食谱，和啾啾的朋友们一起为妙妙做了生日蛋糕。'}}))
  const chineseReply=(await chineseReplyEvent).result
  assert.match(chineseReply.line,/\p{Script=Han}/u);assert.equal(chineseReply.speech.voice,'zh-CN-XiaoxiaoNeural')
  console.log(JSON.stringify({chineseReasoningReplyWithEdgeAudioMs:Date.now()-chineseReplyStart,stayedInChinese:true}))
  const closingStart=Date.now()
  const closingEvent=event('reply')
  socket.send(JSON.stringify({type:'reply',requestID:2,body:{language:'english',kind:'storyWrapup',previousLine:'Who was your favorite?',learnerSpeech:'Gaga the duck',storyID:'choochoo-farm-duckling',storyTitle:'ChooChoo at the Farm',storyContext:'Gaga got lost near the pond. ChooChoo and the animal friends found her, wrapped her in a scarf, and brought her home.'}}))
  const closing=(await closingEvent).result
  assert.ok(closing.line);assert.doesNotMatch(closing.line,/[?？]/);assert.equal(closing.speech.voice,'en-US-AvaNeural')
  console.log(JSON.stringify({storyClosingWithEdgeAudioMs:Date.now()-closingStart}))
  for (const language of ['english','chinese']) {
    const rubric=localizedRubric('choochoo-birthday-cake','call-a-friend',language)
    const weather=language==='english'?"Today's weather is good":'今天天气很好'
    const garbled=language==='english'?'yellow because purple the yesterday':'黄色因为紫色昨天那个'
    for (const [transcript,expected] of [[weather,'offTopic'],[garbled,'uncertain']]) {
      const response=await fetch(`${base}/answers/evaluate`,{method:'POST',headers,body:JSON.stringify({storyID:'choochoo-birthday-cake',checkpointID:'call-a-friend',targetLanguage:language,transcript,attempt:5,hintLevel:4}),signal:AbortSignal.timeout(30000)})
      assert.equal(response.status,200)
      assert.equal((await response.json()).verdict,expected)
    }
    for (const [learnerSpeech,action] of [[weather,'redirect'],[garbled,'retry']]) {
      const ready=event('reply')
      socket.send(JSON.stringify({type:'reply',requestID:10+(language==='english'?0:2)+(action==='redirect'?0:1),body:{language,kind:'tangent',previousLine:rubric.question,currentQuestion:rubric.question,storyID:'choochoo-birthday-cake',checkpointID:'call-a-friend',storyContext:rubric.sceneExcerpt,learnerSpeech}}))
      const result=(await ready).result
      assert.equal(result.action,action)
      if(action==='redirect')assert.ok(result.line.endsWith(rubric.question))
      else assert.equal(result.line,boundaryLines[language].retry)
      assert.equal(result.speech.provider,'edge-tts')
      assert.equal(result.speech.voice,language==='english'?'en-US-AvaNeural':'zh-CN-XiaoxiaoNeural')
      assert.ok(result.speech.audioBase64)
    }
    console.log(`PASS live ${language}: evaluation, redirect, retry, prepared Edge speech`)
  }
  console.log('PASS: reusable chunked speech connection, target-language transcription, moderation, bilingual Edge speech, grounded final closing, nano reply with prepared Edge audio')
  console.log('Synthetic guest ID for optional cleanup:',guest.user.id)
} finally {socket.terminate();if(waiter)clearTimeout(waiter.timer)}
