export type VoiceRequest = 'reply'|'synthesize'|'evaluate'
export type VoiceRPC = (type:VoiceRequest,body:unknown,signal?:AbortSignal)=>Promise<unknown>
let rpc:VoiceRPC|undefined
let supported:readonly string[]=[]
export function setVoiceRPC(value:VoiceRPC|undefined, capabilities:readonly string[]=['reply','synthesize']){rpc=value;supported=value?capabilities:[]}
export function getVoiceRPC(type:VoiceRequest='reply'){return supported.includes(type)?rpc:undefined}
