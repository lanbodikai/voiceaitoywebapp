import test from 'node:test'
import assert from 'node:assert/strict'
import { streamSpeech } from '../server/progressive-speech.mjs'

test('English progressive voice streams Deepgram MP3 chunks',async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.DEEPGRAM_API_KEY
  process.env.DEEPGRAM_API_KEY='synthetic-secret'
  let request
  globalThis.fetch=async(url,init)=>{
    request={url,init}
    return new Response(new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(73,68));controller.enqueue(Uint8Array.of(51));controller.close()}}),{status:200})
  }
  try{
    const chunks=[]
    const provider=await streamSpeech('Hello, friend','english',chunk=>chunks.push(Array.from(chunk)))
    assert.equal(provider,'deepgram-aura-2')
    assert.deepEqual(chunks,[[73,68],[51]])
    assert.match(request.url,/aura-2-thalia-en/)
    assert.equal(request.init.headers.Authorization,'Token synthetic-secret')
    assert.equal(JSON.parse(request.init.body).text,'Hello, friend')
  }finally{
    globalThis.fetch=oldFetch
    if(oldKey===undefined)delete process.env.DEEPGRAM_API_KEY;else process.env.DEEPGRAM_API_KEY=oldKey
  }
})
