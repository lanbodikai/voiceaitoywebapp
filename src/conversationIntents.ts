const normalized = (text: string) => text.toLowerCase().replace(/[’‘]/g,"'").replace(/[，。！？,.!?]/g, '').trim()

export function readiness(text: string): 'yes' | 'no' | null {
  const s = normalized(text)
  if (/^(?:no\b|not yet\b|not ready\b|i(?:'m| am) not ready\b|wait$|later$)/.test(s) || /还没|没准备好|不想听|不要|等一等|等一下/.test(s)) return 'no'
  if (/^(?:(?:yes )?(?:i(?:'m| am) )?ready(?: now| for (?:the )?story)?|yes(?: please)?|yeah|yep|okay|ok|sure|let'?s (?:go|start)|start(?: the story)?)$/.test(s) || /^(?:我)?(?:准备好[了啦]|好了|好的|好呀|好啊|好|可以[呀啊]?|开始吧|开始|想听|要听|嗯|要)$/.test(s)) return 'yes'
  return null
}
export function moodFromSpeech(text: string): 'happy' | 'calm' | 'sleepy' | 'sad' | null {
  const s = normalized(text)
  if (/不开心|难过|伤心|sad|unhappy|not happy/.test(s)) return 'sad'
  if (/困|累|sleepy|tired/.test(s)) return 'sleepy'
  if (/开心|高兴|happy|excited|great/.test(s)) return 'happy'
  if (/平静|安静|calm|quiet|fine/.test(s)) return 'calm'
  return null
}
export function destinationFromSpeech(text: string): 'boat' | 'farm' | 'restaurant' | null {
  const s = normalized(text)
  const matches = [
    ['boat', /船|云朵|boat|sail|cloud/],
    ['farm', /农场|动物|farm|animal/],
    ['restaurant', /餐厅|面馆|做饭|好吃|restaurant|cook|food|noodle/],
  ] as const
  const found = matches.filter(([, pattern]) => pattern.test(s))
  return found.length === 1 ? found[0][0] : null
}

/** VAD returns 16 kHz mono float samples. WAV avoids per-browser recorder codecs. */
export function speechWav(samples: Float32Array): Blob {
  const length = Math.min(samples.length, 16000 * 30)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => [...text].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)))
  ascii(0,'RIFF'); view.setUint32(4,36+length*2,true); ascii(8,'WAVE'); ascii(12,'fmt ')
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true)
  view.setUint32(24,16000,true); view.setUint32(28,32000,true); view.setUint16(32,2,true); view.setUint16(34,16,true)
  ascii(36,'data'); view.setUint32(40,length*2,true)
  for(let i=0;i<length;i++) { const value=Math.max(-1,Math.min(1,samples[i])); view.setInt16(44+i*2,value<0?value*32768:value*32767,true) }
  return new Blob([buffer],{type:'audio/wav'})
}
