export type PreparedSpeech = {audioBase64:string;mimeType:string;provider:string;voice:string} | {stream:ReadableStream<Uint8Array>;mimeType:'audio/mpeg';provider:string}
type Safety = {safe:boolean;categories:string[]}
let prepared: {text:string;language:string;speech:PreparedSpeech;expires:number} | undefined
let checked: {text:string;safety:Safety;expires:number} | undefined
export function prepareSpeech(text:string,language:string,speech:PreparedSpeech) {
  if(prepared && 'stream' in prepared.speech) void prepared.speech.stream.cancel().catch(()=>{})
  prepared={text,language,speech,expires:Date.now()+15000}
}
export function takePreparedSpeech(text:string,language:string) {
  const item=prepared;prepared=undefined
  if(item?.text===text && item.language===language && item.expires>Date.now())return item.speech
  if(item && 'stream' in item.speech)void item.speech.stream.cancel().catch(()=>{})
  return undefined
}
export function rememberSafety(text:string,safety:Safety) { checked={text,safety,expires:Date.now()+5000} }
export function takeSafety(text:string) { const item=checked;checked=undefined;return item?.text===text && item.expires>Date.now()?item.safety:undefined }
export function clearSpeechMemory() {if(prepared && 'stream' in prepared.speech)void prepared.speech.stream.cancel().catch(()=>{});prepared=undefined;checked=undefined}
