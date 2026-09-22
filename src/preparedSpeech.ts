export type PreparedSpeech = {audioBase64:string;mimeType:string;provider:string;voice:string}
type Safety = {safe:boolean;categories:string[]}
let prepared: {text:string;language:string;speech:PreparedSpeech;expires:number} | undefined
let checked: {text:string;safety:Safety;expires:number} | undefined
export function prepareSpeech(text:string,language:string,speech:PreparedSpeech) { prepared={text,language,speech,expires:Date.now()+15000} }
export function takePreparedSpeech(text:string,language:string) {
  const item=prepared;prepared=undefined
  return item?.text===text && item.language===language && item.expires>Date.now()?item.speech:undefined
}
export function rememberSafety(text:string,safety:Safety) { checked={text,safety,expires:Date.now()+5000} }
export function takeSafety(text:string) { const item=checked;checked=undefined;return item?.text===text && item.expires>Date.now()?item.safety:undefined }
export function clearSpeechMemory() {prepared=undefined;checked=undefined}
