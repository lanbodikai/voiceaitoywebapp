export type StreamContext = {language:'chinese'|'english';storyID:string;beatID:string}
export type StreamResult = {transcript:string;safety:{safe:boolean;categories:string[]}}

// 16k detector frames become 24k PCM. Three frames form a 96 ms network chunk.
export function pcmFrame(frame:Float32Array):Uint8Array {
  const data=new Uint8Array(frame.length*3),view=new DataView(data.buffer)
  for(let i=0;i<data.length/2;i++) {
    const at=i*2/3,left=Math.floor(at),mix=at-left
    const value=Math.max(-1,Math.min(1,frame[left]*(1-mix)+frame[Math.min(left+1,frame.length-1)]*mix))
    view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true)
  }
  return data
}

export class StreamingSpeech {
  private socket?:WebSocket
  private pending?:{turn:number;resolve:(v:StreamResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}
  private frames:Uint8Array[]=[]
  private turn=0
  private capturing=false
  private closed=false
  private disconnected:()=>void
  private requestID=0
  capabilities:readonly string[]=['reply','synthesize']
  private requests=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;cleanup:()=>void}>()
  constructor(disconnected:()=>void) {this.disconnected=disconnected}
  async connect(token:string,language:string,url='wss://api.mousefit.pro/ai-toy/web/voice-stream') {
    this.closed=false
    return new Promise<void>((resolve,reject)=>{
      const socket=new WebSocket(url);this.socket=socket
      let ready=false
      const timeout=setTimeout(()=>{reject(new Error('Speech connection timeout'));this.close()},15000)
      socket.onopen=()=>socket.send(JSON.stringify({type:'auth',token,language}))
      socket.onmessage=(event)=>{
        try {
          const data=JSON.parse(event.data)
          if(data.type==='ready') {
            this.capabilities=Array.isArray(data.capabilities)?data.capabilities.filter((type:unknown)=>['reply','synthesize','evaluate'].includes(String(type))):['reply','synthesize']
            ready=true;clearTimeout(timeout);resolve()
          }
          if(data.type==='reply' || data.type==='request_error') {
            const request=this.requests.get(data.requestID)
            if(request){this.requests.delete(data.requestID);request.cleanup();if(data.type==='reply')request.resolve(data.result);else request.reject(new Error('Voice request failed'))}
          }
          if(data.type==='transcript' && this.pending && data.turn===this.pending.turn) {
            const pending=this.pending;this.pending=undefined;clearTimeout(pending.timer);pending.resolve(data)
          }
          if(data.type==='error' && data.turn===this.pending?.turn) this.cancelPending()
        } catch {this.close();reject(new Error('Invalid speech event'))}
      }
      socket.onerror=()=>{if(!ready)reject(new Error('Speech connection unavailable'))}
      socket.onclose=()=>{clearTimeout(timeout);this.cancelPending();this.cancelRequests();if(!ready)reject(new Error('Speech connection unavailable'));if(!this.closed)this.disconnected()}
    })
  }
  begin(context:StreamContext) {
    this.cancelPending();this.cancelRequests();this.frames=[]
    this.send({type:'begin',turn:++this.turn,...context});this.capturing=true
  }
  append(frame:Float32Array) {if(!this.capturing)return;this.frames.push(pcmFrame(frame));if(this.frames.length>=3)this.flush()}
  private flush() {
    if(!this.frames.length)return
    const audio=new Uint8Array(this.frames.reduce((n,b)=>n+b.length,0));let offset=0
    for(const frame of this.frames) {audio.set(frame,offset);offset+=frame.length;frame.fill(0)}
    this.frames=[]
    if(this.socket?.readyState!==WebSocket.OPEN || this.socket.bufferedAmount>256000) throw new Error('Speech connection is slow')
    this.socket.send(audio);audio.fill(0)
  }
  commit():Promise<StreamResult> {
    this.flush();this.capturing=false
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.cancelPending();this.socket?.close()},10000)
      this.pending={turn:this.turn,resolve,reject,timer}
      try {this.send({type:'commit',turn:this.turn})} catch {this.cancelPending()}
    })
  }
  private send(value:unknown) {if(this.socket?.readyState!==WebSocket.OPEN)throw new Error('Speech is not ready');this.socket.send(JSON.stringify(value))}
  private cancelPending() {if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error('Speech interrupted'));this.pending=undefined}}
  request(type:VoiceRequest,body:unknown,signal?:AbortSignal):Promise<unknown> {
    if(!this.capabilities.includes(type))return Promise.reject(new Error('Unsupported voice request'))
    return new Promise((resolve,reject)=>{
      const requestID=++this.requestID
      const cancel=()=>{const request=this.requests.get(requestID);if(!request)return;this.requests.delete(requestID);request.cleanup();reject(new Error('Voice request cancelled'));try{this.send({type:'cancel_request',requestID})}catch{/* already closed */}}
      const timer=setTimeout(cancel,20000)
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
      this.requests.set(requestID,{resolve,reject,cleanup});signal?.addEventListener('abort',cancel,{once:true})
      if(signal?.aborted){cancel();return}
      try{this.send({type,body,requestID})}catch{cancel()}
    })
  }
  private cancelRequests(){for(const request of this.requests.values()){request.cleanup();request.reject(new Error('Speech interrupted'))}this.requests.clear()}
  close() {this.closed=true;this.capturing=false;this.frames.forEach(f=>f.fill(0));this.frames=[];this.cancelPending();this.cancelRequests();this.socket?.close();this.socket=undefined}
}
import type { VoiceRequest } from './voiceTransport.ts'
