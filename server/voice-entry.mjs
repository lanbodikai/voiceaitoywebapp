// Environment is injected by systemd; no shared Oracle environment is loaded.
process.env.VOICE_RUNTIME = 'true'
const { createVoiceServer } = await import('./voice-server.mjs')
const { server, sockets } = createVoiceServer()
server.listen(Number(process.env.PORT || 8787), '127.0.0.1')

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  for (const client of sockets.clients) client.close(1012, 'Service restarting')
  sockets.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
