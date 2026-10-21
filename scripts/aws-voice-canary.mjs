// Fixed synthetic text only; never record or log child content or audio.
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { canaryPath, checkVoiceCanary, memoryPressureFromLinux } from '../server/voice-canary.mjs'

const report = await checkVoiceCanary()
const previous = await readFile(canaryPath, 'utf8').then(JSON.parse).catch(() => ({}))
const [meminfo, vmstat] = await Promise.all([readFile('/proc/meminfo', 'utf8'), readFile('/proc/vmstat', 'utf8')])
report.memory = memoryPressureFromLinux(meminfo, vmstat, previous.memory?.oomKills ?? Number.MAX_SAFE_INTEGER)
const temporary = `${canaryPath}.${process.pid}`
try {
  await writeFile(temporary, JSON.stringify(report), { mode: 0o600 })
  await rename(temporary, canaryPath)
} finally {
  await unlink(temporary).catch(() => {})
}
if (!report.ok) {
  process.stderr.write('voice_canary_unhealthy\n')
  process.exitCode = 1
}
if (report.memory.warning) process.stderr.write('voice_memory_pressure\n')
