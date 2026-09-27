// Synthetic production canary. Logs only timings and provider identifiers.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import WebSocket from 'ws'

const site=process.env.PROFILE_SITE || 'https://web-chi-one-ojsrqj7r9h.vercel.app'
const region=process.env.PROFILE_REGION || 'east'
const ip={east:'100.51.236.202',west:'100.23.30.205'}[region]
if(!ip)throw new Error('PROFILE_REGION must be east or west')
const html=await (await fetch(site)).text()
const asset=html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
assert.ok(asset)
const js=await (await fetch(new URL(asset,site))).text()
const supabaseURL=js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
const publishableKey=js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
assert.ok(supabaseURL && publishableKey)
const signup=await fetch(`${supabaseURL}/auth/v1/signup`,{method:'POST',headers:{apikey:publishableKey,'Content-Type':'application/json'},body:'{}'})
assert.equal(signup.status,200)
const {access_token:token}=await signup.json()
assert.ok(token)
const consent=await fetch(`${supabaseURL}/rest/v1/rpc/cc_guest_action`,{method:'POST',headers:{apikey:publishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:'consent',p_input:{version:'web-handsfree-1.3'}})})
assert.equal(consent.status,200)
const loaded=await fetch(`${supabaseURL}/rest/v1/rpc/cc_guest_action`,{method:'POST',headers:{apikey:publishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:'load',p_input:{}})})
assert.equal(loaded.status,200)
assert.equal((await loaded.json()).consentVersion,'web-handsfree-1.3')

for(const language of ['english','chinese']){
  const pcm=process.env.PROFILE_PCM_DIR ? await readFile(join(process.env.PROFILE_PCM_DIR,`${language}.raw`)) : undefined
  const body=language==='english'
    ? {kind:'imaginativePlay',language,learnerSpeech:'Let us make our train blue and give it big wheels.',previousLine:'What should we add to our train?',storyContext:'ChooChoo and the child are building a toy train together.',preferProgressive:true,preferFixedFeedback:true}
    : {kind:'imaginativePlay',language,learnerSpeech:'我们给小火车装上蓝色的大轮子吧。',previousLine:'我们给小火车加什么呢？',storyContext:'啾啾和孩子正在一起做玩具小火车。',preferProgressive:true,preferFixedFeedback:true}
  const started=performance.now()
  const result=await new Promise((resolve,reject)=>{
    const socket=new WebSocket('wss://api.260926731.xyz/web/voice-stream',{origin:new URL(site).origin,lookup:(_host,options,callback)=>options.all?callback(null,[{address:ip,family:4}]):callback(null,ip,4),handshakeTimeout:10000})
    const timer=setTimeout(()=>{socket.terminate();reject(new Error('Progressive canary timed out'))},40000)
    let requested=0,lineAt,firstAt,bytes=0,provider,audioStart,audioEnd,transcriptionMs,transcribedLength
    socket.on('open',()=>socket.send(JSON.stringify({type:'auth',token,language})))
    socket.on('message',raw=>{
      const event=JSON.parse(raw.toString())
      if(event.type==='ready'){
        if(!event.capabilities?.includes('reply_stream')){clearTimeout(timer);socket.close();reject(new Error('Progressive reply not advertised'));return}
        if(pcm){
          audioStart=performance.now()
          socket.send(JSON.stringify({type:'begin',turn:1,language,storyID:'synthetic-train',beatID:'synthetic-beat'}))
          void (async()=>{
            for(let offset=0;offset<pcm.length;offset+=4608){
              socket.send(pcm.subarray(offset,offset+4608))
              if(offset+4608<pcm.length)await new Promise(resolve=>setTimeout(resolve,96))
            }
            audioEnd=performance.now();socket.send(JSON.stringify({type:'commit',turn:1}))
          })().catch(reject)
        } else {requested=performance.now();socket.send(JSON.stringify({type:'reply',requestID:1,body}))}
      }
      if(event.type==='transcript' && pcm){
        transcriptionMs=Math.round(performance.now()-audioEnd)
        transcribedLength=String(event.transcript||'').length
        if(!transcribedLength){clearTimeout(timer);socket.close();reject(new Error('Synthetic audio was not transcribed'));return}
        requested=performance.now();socket.send(JSON.stringify({type:'reply',requestID:1,body}))
      }
      if(event.type==='reply' && event.requestID===1){lineAt=performance.now();provider=event.result?.speech?.provider;if(!event.result?.speech?.stream){clearTimeout(timer);socket.close();reject(new Error('Synthetic line did not produce a speech stream'))}}
      if(event.type==='reply_audio_chunk' && event.requestID===1){firstAt??=performance.now();bytes+=Buffer.byteLength(event.audio,'base64')}
      if(event.type==='reply_audio_done' && event.requestID===1){clearTimeout(timer);socket.close();resolve({region,language,connectMs:Math.round((audioStart||requested)-started),...(pcm?{audioDurationMs:Math.round(audioEnd-audioStart),transcriptionMs,transcribedLength,speechEndToFirstAudioMs:Math.round(firstAt-audioEnd)}:{}),lineMs:Math.round(lineAt-requested),firstAudioMs:Math.round(firstAt-requested),completeMs:Math.round(performance.now()-requested),bytes,provider})}
      if(event.type==='request_error'){clearTimeout(timer);socket.close();reject(new Error('Progressive reply failed'))}
    })
    socket.on('error',error=>{clearTimeout(timer);reject(error)})
  })
  console.log(JSON.stringify(result))
}
