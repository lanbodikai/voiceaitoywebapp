// Local UI verification only; never imported by the application or deployed API.
import { createServer } from 'node:http'
const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/participants/consent') { response.end(JSON.stringify({ participantID: 'local-ui-test' })); return }
  if (request.url === '/sessions/start') { response.end(JSON.stringify({ sessionID: 'local-ui-test' })); return }
  if (request.url === '/sessions/log') { response.writeHead(503); response.end(JSON.stringify({ error: 'Test storage offline' })); return }
  response.writeHead(503); response.end(JSON.stringify({ error: 'Voice is unavailable in this UI test' }))
})
server.listen(8788, '127.0.0.1', () => console.log('Local UI fixture listening on 8788; no audio is processed.'))
