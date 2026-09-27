import test from 'node:test'
import assert from 'node:assert/strict'
import {beginLatencyTurn,noteSpeechFrame,cancelLatencyTurn,markEndpoint,startLatencyStage,startAudioLatency,readLatencySamples} from '../src/latency.ts'

test('timings include silence detection, transcription, grading, and actual audio start, with no content',()=>{
  beginLatencyTurn(100);noteSpeechFrame(200);markEndpoint(1400)
  startLatencyStage('transcriptionMs',1400)(1600)
  startLatencyStage('evaluationMs',1600)(1900)
  startAudioLatency(1900)(1950)
  assert.deepEqual(readLatencySamples().at(-1),{endpointMs:1200,transcriptionMs:200,evaluationMs:300,audioStartMs:50,responseMs:1750})
})

test('late callbacks and cancelled turns never contaminate the next measurement',()=>{
  const count=readLatencySamples().length
  beginLatencyTurn(10);const staleStage=startLatencyStage('evaluationMs',20),staleAudio=startAudioLatency(30)
  cancelLatencyTurn();staleAudio(50)
  beginLatencyTurn(100);staleStage(150);staleAudio(200)
  assert.equal(readLatencySamples().length,count)
  startAudioLatency(200)(300)
  assert.deepEqual(readLatencySamples().at(-1),{audioStartMs:100,responseMs:200})
})

test('diagnostics are bounded, copied, and emit only once per turn',()=>{
  for(let i=0;i<100;i++){beginLatencyTurn(0);const play=startAudioLatency(1);play(2);play(3)}
  const samples=readLatencySamples();assert.equal(samples.length,64)
  samples[0].responseMs=999
  assert.equal(readLatencySamples()[0].responseMs,2)
})
