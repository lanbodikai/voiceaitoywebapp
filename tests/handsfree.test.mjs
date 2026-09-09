import test from 'node:test'
import assert from 'node:assert/strict'
import {readiness,moodFromSpeech,destinationFromSpeech,speechWav} from '../src/conversationIntents.ts'
import {SpeechTurn} from '../src/speechTurn.ts'
import {FrameProcessor} from '@ricky0123/vad-web/dist/frame-processor.js'

test('spoken readiness is explicit and negatives take precedence', () => {
  for(const text of ['yes please','I’m ready'.replace('’',"'"),'准备好了','好呀']) assert.equal(readiness(text),'yes')
  for(const text of ['not ready',"I'm not ready",'我还没准备好','不要']) assert.equal(readiness(text),'no')
  assert.equal(readiness('I like cake'),null)
})
test('intro and destination choices accept short bilingual speech', () => {
  assert.equal(moodFromSpeech('我不开心'),'sad')
  assert.equal(moodFromSpeech('I am not happy'),'sad')
  assert.equal(moodFromSpeech('我有点困'),'sleepy')
  assert.equal(destinationFromSpeech('我想坐小船'),'boat')
  assert.equal(destinationFromSpeech('the farm please'),'farm')
  assert.equal(destinationFromSpeech('farm or boat'),null)
})
test('new speech cancels an old turn, and mute invalidates pending replies', () => {
  const gate = new SpeechTurn()
  const first = gate.next(), signal = gate.controller.signal
  const second = gate.next()
  assert.equal(signal.aborted,true)
  assert.equal(gate.current(first),false)
  assert.equal(gate.current(second),true)
  gate.cancel()
  assert.equal(gate.current(second),false)
})
test('speech WAV is mono 16kHz PCM and bounded at 30 seconds', async () => {
  const wav = speechWav(new Float32Array([-1,0,1]))
  const view = new DataView(await wav.arrayBuffer())
  assert.equal(wav.type,'audio/wav')
  assert.equal(view.getUint32(24,true),16000)
  assert.equal(view.getUint16(22,true),1)
  assert.equal(view.getInt16(44,true),-32768)
  assert.equal(view.getInt16(48,true),32767)
  assert.equal(speechWav(new Float32Array(16000*31)).size,44+16000*30*2)
})

test('detector preserves a short answer and a thinking pause, but ignores silence and clicks', async () => {
  let probability=0
  const events=[]
  const processor=new FrameProcessor(async()=>({isSpeech:probability,notSpeech:1-probability}),()=>{}, {
    positiveSpeechThreshold:0.6,negativeSpeechThreshold:0.35,minSpeechMs:160,preSpeechPadMs:320,redemptionMs:1200,submitUserSpeechOnPause:true,
  },32)
  processor.resume()
  const feed=async(p,n)=>{ probability=p; for(let i=0;i<n;i++) await processor.process(new Float32Array(512),e=>events.push(e)) }
  await feed(0,100); await feed(1,2); await feed(0,45)
  assert.equal(events.filter(e=>e.audio).length,0)
  await feed(1,5); await feed(0,10); await feed(1,5); await feed(0,38)
  assert.equal(events.filter(e=>e.audio).length,1,'a 320 ms hesitation stays in the same turn')
  await feed(1,5); await feed(0,38)
  assert.equal(events.filter(e=>e.audio).length,2,'a short yes is still accepted')
})
