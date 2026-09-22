/** Browser-safe timeout signal for iOS versions without AbortSignal.timeout(). */
export function timeoutSignal(milliseconds: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(milliseconds)
  const controller = new AbortController()
  window.setTimeout(() => controller.abort(new DOMException('The request timed out', 'TimeoutError')), milliseconds)
  return controller.signal
}

/** Combine cancellation sources without requiring AbortSignal.any(). */
export function combinedSignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  const abort = (signal: AbortSignal) => controller.abort(signal.reason)
  for (const signal of signals) {
    if (signal.aborted) { abort(signal); break }
    signal.addEventListener('abort', () => abort(signal), { once: true })
  }
  return controller.signal
}

/** RFC 4122 v4 UUID using Web Crypto, including Safari before randomUUID(). */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

/** AudioContext was WebKit-prefixed on older iPhones still used as demo devices. */
export function audioContextClass(): typeof AudioContext | undefined {
  return window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}
