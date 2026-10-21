import { readFileSync } from 'node:fs'
import { streamEdgeSpeech } from './edge-speech.mjs'
import { streamOpenAISpeech } from './openai-speech.mjs'

export const canaryPath = process.env.VOICE_CANARY_STATUS_FILE || '/var/lib/voice-ai-toy-monitor/status.json'
const maxAgeMs = 15 * 60 * 1000
const phrases = { english: 'Hello, friend.', chinese: '你好，朋友。' }

export async function checkVoiceCanary(primary = streamEdgeSpeech, fallback = streamOpenAISpeech) {
  const languages = {}
  for (const [language, phrase] of Object.entries(phrases)) {
    const count = { bytes: 0 }
    const receive = chunk => { count.bytes += chunk.byteLength }
    try {
      await primary(phrase, language, receive)
      if (!count.bytes) throw new Error('Empty speech')
      languages[language] = { ok: true, provider: 'edge-tts' }
    } catch {
      count.bytes = 0
      try {
        if (process.env.SPEECH_FALLBACK_ENABLED !== 'true') throw new Error('Fallback disabled')
        await fallback(phrase, language, receive)
        if (!count.bytes) throw new Error('Empty speech')
        languages[language] = { ok: true, provider: 'openai-tts' }
      } catch {
        languages[language] = { ok: false, provider: 'none' }
      }
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    ok: Object.values(languages).every(result => result.ok),
    degraded: Object.values(languages).some(result => result.provider !== 'edge-tts'),
    languages,
  }
}

export function readVoiceCanary(path = process.env.VOICE_CANARY_STATUS_FILE || canaryPath, now = Date.now()) {
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'))
    if (!Number.isFinite(Date.parse(report.checkedAt)) || now - Date.parse(report.checkedAt) > maxAgeMs || now < Date.parse(report.checkedAt)) return { ok: false, degraded: true }
    return {
      ok: report.ok === true && ['english', 'chinese'].every(language => report.languages?.[language]?.ok === true),
      degraded: report.degraded === true,
      memoryPressure: report.memory?.warning === true,
      checkedAt: report.checkedAt,
    }
  } catch { return { ok: false, degraded: true } }
}

export function memoryPressureFromLinux(meminfo, vmstat, previousOomKills = 0) {
  const value = (source, key) => Number(source.match(new RegExp(`^${key}:?\\s+(\\d+)`, 'm'))?.[1] || 0)
  const availableMiB = Math.round(value(meminfo, 'MemAvailable') / 1024)
  const swapUsedMiB = Math.round((value(meminfo, 'SwapTotal') - value(meminfo, 'SwapFree')) / 1024)
  const oomKills = value(vmstat, 'oom_kill')
  return {
    availableMiB, swapUsedMiB, oomKills,
    warning: availableMiB < 64 || swapUsedMiB > 256 || oomKills > previousOomKills,
  }
}
