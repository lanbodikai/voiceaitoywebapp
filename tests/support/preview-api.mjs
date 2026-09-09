// Local UI verification only; never imported by the application or deployed API.
import { createServer } from 'node:http'
let stories = []
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/participants/consent') { response.end(JSON.stringify({ participantID: 'local-ui-test' })); return }
  if (request.url === '/sessions/start') { response.end(JSON.stringify({ sessionID: 'local-ui-test' })); return }
  if (request.url === '/progress/load') { response.end(JSON.stringify({profileID:'local-ui-test',stories})); return }
  if (request.url === '/sessions/log') {
    let body = ''; for await (const chunk of request) body += chunk
    const {snapshot} = JSON.parse(body)
    if (snapshot) stories = [{storyID:'choochoo-birthday-cake',language:'chinese',snapshot,updatedAt:new Date().toISOString()}]
    response.end(JSON.stringify({saved:true})); return
  }
  if (request.url === '/progress/recovery-code') { response.end(JSON.stringify({code:'a'.repeat(40)})); return }
  if (request.url === '/progress/restore') { response.end(JSON.stringify({profileID:'local-ui-test'})); return }
  response.writeHead(503); response.end(JSON.stringify({ error: 'Voice is unavailable in this UI test' }))
})
server.listen(8788, '127.0.0.1', () => console.log('Local UI fixture listening on 8788; no audio is processed.'))
