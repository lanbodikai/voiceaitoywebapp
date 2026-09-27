// Content-free, memory-only diagnostics. No identifiers, utterances, or cloud writes.
type Stage = 'endpointMs'|'transcriptionMs'|'evaluationMs'|'replyMs'|'synthesisMs'|'audioStartMs'|'responseMs'
export type LatencySample = Partial<Record<Stage,number>>
type Turn = {lastSpeech:number; stages:LatencySample}
let active:Turn|undefined
const samples:LatencySample[]=[]
const now=()=>performance.now()
export function beginLatencyTurn(at=now()){active={lastSpeech:at,stages:{}}}
export function noteSpeechFrame(at=now()){if(active)active.lastSpeech=at}
export function cancelLatencyTurn(){active=undefined}
export function markEndpoint(at=now()){if(active)active.stages.endpointMs=Math.max(0,Math.round(at-active.lastSpeech))}
export function startLatencyStage(stage:Stage,at=now()) {
  const turn=active
  return (end=now())=>{if(turn && turn===active)turn.stages[stage]=(turn.stages[stage]??0)+Math.max(0,Math.round(end-at))}
}
export async function measureLatency<T>(stage:Stage,work:()=>Promise<T>):Promise<T> {
  const finish=startLatencyStage(stage)
  try{return await work()}finally{finish()}
}
export function startAudioLatency(at=now()) {
  const turn=active
  return (end=now())=>{
    if(!turn || turn!==active)return
    turn.stages.audioStartMs=Math.max(0,Math.round(end-at))
    turn.stages.responseMs=Math.max(0,Math.round(end-turn.lastSpeech))
    const sample={...turn.stages}
    samples.push(sample);if(samples.length>64)samples.shift()
    active=undefined
    if(typeof window!=='undefined' && typeof window.dispatchEvent==='function')window.dispatchEvent(new CustomEvent('choochoo:latency',{detail:{...sample}}))
  }
}
export function readLatencySamples(){return samples.map(sample=>({...sample}))}
