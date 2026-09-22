export type VoiceRPC = (type:'reply'|'synthesize',body:unknown,signal?:AbortSignal)=>Promise<unknown>
let rpc:VoiceRPC|undefined
export function setVoiceRPC(value:VoiceRPC|undefined){rpc=value}
export function getVoiceRPC(){return rpc}
