// Fixed synthetic text only; never record or log child content or audio.
import { writeFile, rename, unlink } from 'node:fs/promises'
import { canaryPath, checkVoiceCanary } from '../server/voice-canary.mjs'

const report = await checkVoiceCanary()
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
