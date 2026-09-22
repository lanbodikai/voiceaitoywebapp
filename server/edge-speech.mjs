import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
let active = 0

export function edgeSpeech(text, language, signal) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1600 || !['chinese','english'].includes(language)) return Promise.reject(Object.assign(new Error('Invalid speech'),{statusCode:400}))
  if (active >= 8) return Promise.reject(Object.assign(new Error('Speech busy'),{statusCode:429}))
  active++
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.EDGE_TTS_PYTHON || '/opt/edge-tts/bin/python', [fileURLToPath(new URL('./edge-speech.py', import.meta.url))], {stdio:['pipe','pipe','ignore']})
    let done = false, size = 0
    const chunks = []
    const finish = (ok) => {
      if (done) return
      done = true; active--; clearTimeout(timer); signal?.removeEventListener('abort', cancel)
      child.kill(); child.stdin.destroy()
      if (ok && size) resolve({audioBase64:Buffer.concat(chunks).toString('base64'),mimeType:'audio/mpeg',provider:'edge-tts',voice:language === 'english' ? 'en-US-AvaNeural' : 'zh-CN-XiaoxiaoNeural'})
      else reject(Object.assign(new Error('Edge voice unavailable'),{statusCode:502}))
      chunks.forEach((b) => b.fill(0))
    }
    const cancel = () => finish(false)
    const timer = setTimeout(cancel, 12000)
    signal?.addEventListener('abort',cancel,{once:true})
    child.on('error',cancel); child.stdin.on('error',cancel)
    child.stdout.on('data',(data) => { size += data.length; if (size > 2 * 1024 * 1024) cancel(); else chunks.push(data) })
    child.on('close',(code) => finish(code === 0))
    if (signal?.aborted) { cancel(); return }
    child.stdin.end(JSON.stringify({text,language}))
  })
}
