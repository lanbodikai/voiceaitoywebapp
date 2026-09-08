let activeAudio: HTMLAudioElement | undefined

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
  window.speechSynthesis.cancel()
  activeAudio?.pause()
  activeAudio?.removeAttribute('src')
  activeAudio = undefined
}

/**
 * Fixed story lines always play an Edge-TTS MP3. Browser speech synthesis is
 * retained only for a dynamic line that cannot be prerecorded (for example,
 * a live imaginative-play reply) or if an asset is unavailable during local
 * development.
 */
export async function speak(text: string, language: 'chinese' | 'english', cueID?: string) {
  stopVoice()
  if (cueID && await playCue(cueID)) return
  return speakWithBrowser(text, language)
}

function playCue(cueID: string) {
  return new Promise<boolean>((resolve) => {
    const audio = new Audio(`/audio/${encodeURIComponent(cueID)}.mp3`)
    activeAudio = audio
    let settled = false
    const finish = (played: boolean) => {
      if (settled) return
      settled = true
      if (activeAudio === audio) activeAudio = undefined
      resolve(played)
    }
    audio.preload = 'auto'
    audio.addEventListener('ended', () => finish(true), { once: true })
    audio.addEventListener('error', () => finish(false), { once: true })
    audio.play().catch(() => finish(false))
  })
}

function speakWithBrowser(text: string, language: 'chinese' | 'english') {
  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language === 'chinese' ? 'zh-CN' : 'en-US'
    utterance.rate = 0.85
    utterance.pitch = 1.08
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    window.speechSynthesis.speak(utterance)
  })
}

export function playEarcon(kind: 'listen' | 'stop' | 'thinking' | 'success' | 'sticker' | 'complete') {
  const context = new AudioContext()
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
  const context = new AudioContext()
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
