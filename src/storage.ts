/** Storage may be unavailable in private browsing or contain an older schema. */
const memory = new Map<string, unknown>()
export function readStored<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? memory.get(key) ?? fallback } catch { return (memory.get(key) as T) ?? fallback }
}

export function writeStored(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); memory.delete(key) } catch { memory.set(key, value) }
}
