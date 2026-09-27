export const LEGACY_VOICE_STREAM_URL = 'wss://api.mousefit.pro/ai-toy/web/voice-stream'

export function voiceStreamURL(configured?: string): string {
  if (!configured) return LEGACY_VOICE_STREAM_URL
  const url = new URL(configured)
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Voice stream endpoint must be a secure URL without credentials or query parameters')
  }
  return url.href
}
