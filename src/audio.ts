import { takePreparedSpeech, type PreparedSpeech } from './preparedSpeech.ts'
import edgeCueIDs from './data/edge-cue-ids.json' with { type: 'json' }
import edgeCues from './data/edge-cues.json' with { type: 'json' }
import { audioContextClass } from './browserCompat.ts'
let activeAudio: HTMLAudioElement | undefined
let speechRequest: AbortController | undefined
let cancelPlayback: (() => void) | undefined
let playbackGeneration = 0
let speechRate = 0.85
const certifiedEdgeCues = new Set(edgeCueIDs)

export function setSpeechRate(value: number) {
  speechRate = Number.isFinite(value) ? Math.min(1.1, Math.max(0.7, value)) : 0.85
}

/** The iOS app and the web app use the same fixed Edge-TTS cue filenames. */
export function cueForLanguage(cueID: string, language: 'chinese' | 'english') {
  return language === 'english' ? `en_${cueID}` : cueID
}

export function storyFeedbackCue(storyID: string, checkpointID: string, kind: 'hint' | 'recast' | 'success', language: 'chinese' | 'english', hintLevel?: number) {
  if (language === 'english') return undefined
  const suffix = kind === 'hint' ? `hint_${hintLevel ?? 1}` : kind
  return `${suffix}_${storyID}_${checkpointID}`
}

export function stopVoice() {
  playbackGeneration += 1
  cancelPlayback?.()
  cancelPlayback = undefined
  speechRequest?.abort();speechRequest=undefined
  activeAudio?.pause()
  activeAudio?.removeAttribute('src')
  activeAudio = undefined
}

/**
 * Fixed and dynamic lines both use Edge-TTS. Never silently change voices.
 */
export async function speak(text: string, language: 'chinese' | 'english', cueID?: string) {
  stopVoice()
  const generation = playbackGeneration
  if (cueID && await playCue(cueID)) return true
  if (generation !== playbackGeneration) return true
  const controller=new AbortController();speechRequest=controller
  try {
    const prepared=takePreparedSpeech(text,language)
    const speech=prepared || await (await import('./backend')).synthesizeSpeech(text,language,controller.signal)
    if(generation!==playbackGeneration) return true
    return await playPrepared(speech)
  } catch {return generation!==playbackGeneration}
  finally {if(speechRequest===controller)speechRequest=undefined}
}

export function isCertifiedEdgeCue(cueID: string) {return certifiedEdgeCues.has(cueID)}
function playCue(cueID: string) {
  // Old or manually copied MP3s never bypass the runtime Edge-TTS provider.
  const metadata = (edgeCues as Record<string, {audioHash:string}>)[cueID]
  return isCertifiedEdgeCue(cueID) && metadata ? playAudio(`/audio/${encodeURIComponent(cueID)}.mp3?v=${metadata.audioHash.slice(0,12)}`) : Promise.resolve(false)
}
function playPrepared(speech:PreparedSpeech) {
  if(speech.provider!=='edge-tts' || speech.mimeType!=='audio/mpeg') return Promise.resolve(false)
  const bytes=Uint8Array.from(atob(speech.audioBase64),c=>c.charCodeAt(0))
  const url=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));bytes.fill(0)
  return playAudio(url).finally(()=>URL.revokeObjectURL(url))
}
function playAudio(url: string) {
  return new Promise<boolean>((resolve) => {
    const audio = new Audio(url)
    audio.playbackRate = speechRate
    audio.preservesPitch = true
    activeAudio = audio
    let settled = false
    const finish = (played: boolean) => {
      if (settled) return
      settled = true
      audio.pause();audio.removeAttribute('src')
      if (activeAudio === audio) activeAudio = undefined
      resolve(played)
    }
    audio.preload = 'auto'
    cancelPlayback = () => finish(true)
    audio.addEventListener('ended', () => finish(true), { once: true })
    audio.addEventListener('error', () => finish(false), { once: true })
    audio.play().catch(() => finish(false))
  })
}

export function playEarcon(kind: 'listen' | 'stop' | 'thinking' | 'success' | 'sticker' | 'complete') {
  const AudioContextConstructor = audioContextClass()
  if (!AudioContextConstructor) return
  const context = new AudioContextConstructor()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.connect(gain).connect(context.destination)
  oscillator.type = kind === 'thinking' ? 'sine' : 'triangle'
  oscillator.frequency.value = kind === 'listen' ? 560 : kind === 'stop' ? 430 : kind === 'thinking' ? 280 : kind === 'sticker' ? 880 : kind === 'complete' ? 660 : 740
  if (kind === 'listen' || kind === 'sticker' || kind === 'complete') {
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'complete' ? 990 : 820, context.currentTime + .18)
  }
  gain.gain.setValueAtTime(0.06, context.currentTime)
  const duration = kind === 'thinking' ? .45 : kind === 'complete' ? .48 : .22
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration)
  oscillator.start()
  oscillator.stop(context.currentTime + duration)
  oscillator.addEventListener('ended', () => context.close())
}

export function playEffect(sfxID: string) {
  if (sfxID.includes('phone')) return tonePattern([640, 640, 760], .12)
  if (sfxID.includes('horn')) return tonePattern([330, 390], .16)
  if (sfxID.includes('oven') || sfxID.includes('bell')) return tonePattern([760, 980], .18)
  if (sfxID.includes('duck') || sfxID.includes('quack')) return tonePattern([260, 210], .13)
  if (sfxID.includes('horse') || sfxID.includes('clip')) return tonePattern([190, 160, 190, 160], .1)
  if (sfxID.includes('party') || sfxID.includes('confetti')) return tonePattern([520, 660, 820, 1040], .08)
  if (sfxID.includes('sticker')) return playEarcon('sticker')
  return tonePattern([620, 760], .1)
}

function tonePattern(frequencies: number[], step: number) {
  const AudioContextConstructor = audioContextClass()
  if (!AudioContextConstructor) return
  const context = new AudioContextConstructor()
  const gain = context.createGain()
  gain.connect(context.destination)
  gain.gain.setValueAtTime(.045, context.currentTime)
  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.value = frequency
    oscillator.connect(gain)
    oscillator.start(context.currentTime + index * step)
    oscillator.stop(context.currentTime + (index + .75) * step)
  })
  const end = context.currentTime + frequencies.length * step
  gain.gain.exponentialRampToValueAtTime(.001, end)
  window.setTimeout(() => void context.close(), frequencies.length * step * 1000 + 80)
}
