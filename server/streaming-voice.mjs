import WebSocket, { WebSocketServer } from 'ws'
import { createHash } from 'node:crypto'
import { guestAction } from './progress-store.mjs'
import { localizedRubric, storySelectionWords } from './conversation-boundaries.mjs'
import { runtimeLimit } from './runtime-limits.mjs'

export function transcriptionConfig(language, storyID, beatID) {
  const rubric = localizedRubric(storyID, beatID, language)
  const picker = storyID === 'story-picker'
  const context = picker ? (language === 'english' ? 'The child is naming a story to hear.' : '孩子正在说想听哪个故事。')
    : rubric ? (language === 'english' ? `Current story question: ${rubric.question}` : `当前故事问题：${rubric.question}`) : (language === 'english' ? 'This is an open, friendly conversation.' : '这是一次自然、友好的中文对话。')
  const prompt = language === 'english'
    ? 'A child age three to six is practicing English. They may speak softly, use a high pitch, pause often, or use developing pronunciation. Transcribe only words actually spoken; never complete, rewrite, or guess their answer; never translate it.'
    : '三至六岁的孩子正在练习普通话。孩子可能声音很轻、音调较高、停顿较多或发音尚在发展中。只转写孩子实际说出的中文，不要补全、改写、翻译或猜测答案。常见回答包括“准备好了”“我已经准备好了”“好了，我们开始吧”。'
  const keywords = (picker ? storySelectionWords(language) : rubric?.requiredConcepts?.flatMap((concept)=>language === 'english' ? (concept.english||[]) : (concept.chinese||[])) || []).filter((word)=>!/[<>\r\n]/.test(word)).slice(0,48)
  return { type:'transcription', audio:{input:{
    format:{type:'audio/pcm',rate:24000},noise_reduction:{type:'near_field'},turn_detection:null,
    transcription:{model:process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-live-transcribe',languages:language === 'english' ? ['en'] : ['zh'],delay:'low',
      prompt:[prompt,context].join('\n'),
      keywords,
    },
  }}}
}

const counts = new Map()
export function attachStreamingVoice(server, moderate, handlers = {}, dependencies = {}) {
  const authenticate=dependencies.authenticate || guestAction
  const UpstreamSocket=dependencies.UpstreamSocket || WebSocket
  const sockets = new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false})
  server.on('upgrade',(request,socket,head)=>{
    const path = new URL(request.url,'http://localhost').pathname
    const origins = new Set(['https://web-chi-one-ojsrqj7r9h.vercel.app',process.env.WEB_ORIGIN,'http://localhost:5173'])
    if (path !== '/web/voice-stream' || sockets.clients.size >= runtimeLimit('VOICE_MAX_CONNECTIONS', 64, 64) || (request.headers.origin && !origins.has(request.headers.origin))) { socket.destroy(); return }
    sockets.handleUpgrade(request,socket,head,(client)=>sockets.emit('connection',client))
  })
  sockets.on('connection',(client)=>{
    let upstream, profile, authenticating = false, ready = false, current = 0, capturing = false, bytes = 0, turns = 0
    let startedAt = Date.now(), lastMessage = Date.now(), safeTranscriptHash
    const commits = [], items = new Map()
    const requests = new Map()
    let requestCount=0,requestWindow=Date.now()
    const controller = new AbortController()
    const send = (value) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)) }
    const close = () => { if (client.readyState < WebSocket.CLOSING) client.close(1011,'Voice connection ended') }
    const authTimer = setTimeout(close,10000)
    const lifetime = setTimeout(close,30*60*1000)
    const idle = setInterval(()=>{if(Date.now()-lastMessage>5*60*1000) close()},30000)
    client.on('close',()=>{
      clearTimeout(authTimer); clearTimeout(lifetime); clearInterval(idle); controller.abort(); upstream?.terminate()
      if(profile) { const n=(counts.get(profile)||1)-1; if(n) counts.set(profile,n); else counts.delete(profile) }
      commits.length=0; items.clear(); safeTranscriptHash=undefined
      for(const pending of requests.values())pending.abort();requests.clear()
    })
    client.on('error',close)
    client.on('message',async (data,binary)=>{
      lastMessage = Date.now()
      try {
        if(binary) {
          if(!ready || !capturing || data.length % 2 || !data.length || (bytes+=data.length)>24000*2*30 || upstream.bufferedAmount>256000) { close(); return }
          upstream.send(JSON.stringify({type:'input_audio_buffer.append',audio:data.toString('base64')})); return
        }
        const message=JSON.parse(data.toString())
        if(message.type==='auth' && !authenticating) {
          authenticating=true
          if(typeof message.token!=='string' || message.token.length>8000 || !['chinese','english'].includes(message.language)) {close();return}
          if(process.env.CHILD_PILOT_MODE!=='false' && process.env.OPENAI_ZDR_VERIFIED!=='true') {close();return}
          const guest=await authenticate(`Bearer ${message.token}`,'load')
          if(controller.signal.aborted || (counts.get(guest.profileID)||0)>=2) {close();return}
          profile=guest.profileID; counts.set(profile,(counts.get(profile)||0)+1)
          const response=await fetch('https://api.openai.com/v1/realtime/client_secrets',{
            method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
            body:JSON.stringify({expires_after:{anchor:'created_at',seconds:60},session:transcriptionConfig(message.language)}),
            signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]),
          })
          const credential=await response.json()
          if(!response.ok || !credential.value || controller.signal.aborted) {close();return}
          upstream=new UpstreamSocket('wss://api.openai.com/v1/realtime',{headers:{Authorization:`Bearer ${credential.value}`},handshakeTimeout:8000})
          upstream.on('error',close); upstream.on('close',close)
          upstream.on('message',async(raw)=>{
            try {
              const event=JSON.parse(raw.toString())
              if(event.type==='session.created' || event.type==='transcription_session.created') {ready=true;clearTimeout(authTimer);send({type:'ready',capabilities:[...['reply','synthesize','evaluate'].filter(type=>typeof handlers[type]==='function'),...(handlers.replyStream && handlers.streamAudio ? ['reply_stream'] : [])]})}
              if(event.type==='input_audio_buffer.committed') items.set(event.item_id,commits.shift())
              if(event.type==='conversation.item.input_audio_transcription.completed') {
                const turn=items.get(event.item_id); items.delete(event.item_id)
                // Do not retain previous utterances as conversational model context.
                if(upstream.readyState===WebSocket.OPEN) upstream.send(JSON.stringify({type:'conversation.item.delete',item_id:event.item_id}))
                if(turn!==current || !turn) return
                const transcript=String(event.transcript||'').slice(0,500)
                const safety=transcript.trim()?await moderate(transcript):{safe:true,categories:[]}
                if(turn===current && !controller.signal.aborted) {
                  // Keep only a hash of this server-moderated turn; a client-supplied grade
                  // can reuse safety only for the exact same transcript on this socket.
                  safeTranscriptHash=safety.safe && transcript.trim() ? createHash('sha256').update(transcript).digest('hex') : undefined
                  send({type:'transcript',turn,transcript,safety})
                }
              }
              if(event.type==='conversation.item.input_audio_transcription.failed') {send({type:'error',turn:items.get(event.item_id)});items.delete(event.item_id)}
              if(event.type==='error') close()
            } catch {close()}
          })
          return
        }
        if(!ready) {close();return}
        if(message.type==='cancel_request') {requests.get(message.requestID)?.abort();requests.delete(message.requestID);return}
        if(message.type==='reply' || message.type==='synthesize' || message.type==='evaluate') {
          if(Date.now()-requestWindow>60000){requestWindow=Date.now();requestCount=0}
          if(++requestCount>60 || requests.size>=2 || !Number.isSafeInteger(message.requestID) || requests.has(message.requestID) || !handlers[message.type]) {close();return}
          const pending=new AbortController();requests.set(message.requestID,pending)
          try {
            const proof=message.type==='evaluate' ? safeTranscriptHash : undefined
            if(message.type==='reply' && message.body?.preferProgressive===true && handlers.replyStream && handlers.streamAudio) {
              const result=await handlers.replyStream(message.body,pending.signal)
              if(pending.signal.aborted)return
              const language=message.body.language
              if(result.skipSpeech){send({type:'reply',requestID:message.requestID,result:{line:result.line,action:result.action}});return}
              send({type:'reply',requestID:message.requestID,result:{...result,speech:{stream:true,mimeType:'audio/mpeg',provider:language==='english' && process.env.DEEPGRAM_API_KEY?'deepgram-aura-2':'edge-tts'}}})
              await handlers.streamAudio(result.line,language,async chunk=>{
                while(client.bufferedAmount>256000 && !pending.signal.aborted)await new Promise(resolve=>setTimeout(resolve,10))
                pending.signal.throwIfAborted()
                send({type:'reply_audio_chunk',requestID:message.requestID,audio:Buffer.from(chunk).toString('base64')})
              },pending.signal)
              if(!pending.signal.aborted)send({type:'reply_audio_done',requestID:message.requestID})
            } else {
              const result=await handlers[message.type](message.body,pending.signal,proof)
              if(!pending.signal.aborted)send({type:'reply',requestID:message.requestID,result})
            }
          } catch {if(!pending.signal.aborted)send({type:'request_error',requestID:message.requestID})}
          finally {requests.delete(message.requestID)}
          return
        }
        if(message.type==='begin') {
          for(const pending of requests.values())pending.abort();requests.clear()
          if(!Number.isSafeInteger(message.turn) || message.turn<=current || !['chinese','english'].includes(message.language)) {close();return}
          if(Date.now()-startedAt>60000) {turns=0;startedAt=Date.now()}
          if(++turns>60 || commits.length>5 || items.size>5) {close();return}
          current=message.turn;bytes=0;capturing=true;safeTranscriptHash=undefined
          upstream.send(JSON.stringify({type:'input_audio_buffer.clear'}))
          upstream.send(JSON.stringify({type:'session.update',session:transcriptionConfig(message.language,message.storyID,message.beatID)}))
        } else if(message.type==='commit' && message.turn===current && capturing) {
          capturing=false
          if(bytes<4800) {send({type:'transcript',turn:current,transcript:'',safety:{safe:true,categories:[]}});return}
          commits.push(current);upstream.send(JSON.stringify({type:'input_audio_buffer.commit'}))
        } else {close()}
      } catch {close()}
    })
  })
  return sockets
}
