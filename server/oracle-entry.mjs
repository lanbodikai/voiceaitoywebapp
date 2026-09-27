// Run alongside the unchanged iOS request handler in the same container.
import '/app/src/load-env.mjs'
process.env.ORACLE_VOICE_RUNTIME = 'true'
const { createAppServer } = await import('/app/src/app.mjs')
const { default: webHandler, moderate, generateSpokenLine, evaluateAnswer } = await import('../api/index.mjs')
const { edgeSpeech } = await import('./edge-speech.mjs')
const { attachStreamingVoice } = await import('./streaming-voice.mjs')
const server = createAppServer()
const legacy = server.listeners('request')[0]
server.removeAllListeners('request')
server.on('request', (request, response) => {
  if (!request.url.startsWith('/web/')) return legacy(request, response)
  request.url = `/api/${request.url.slice(5)}`
  response.status = (status) => { response.statusCode = status; return response }
  response.json = (value) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) }
  void webHandler(request, response).catch(() => { if (!response.writableEnded) { response.statusCode = 502; response.end('{"error":"Voice service unavailable"}') } })
})
attachStreamingVoice(server, moderate, {reply:generateSpokenLine,evaluate:evaluateAnswer,synthesize:(body,signal)=>edgeSpeech(body?.text,body?.language,signal)})
server.listen(Number(process.env.PORT || 8787), '0.0.0.0')
