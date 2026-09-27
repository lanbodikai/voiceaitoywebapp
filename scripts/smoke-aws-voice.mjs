// Explicit opt-in canary. Uses one synthetic anonymous guest; no child audio/content.
// Prints only route results and timing, never tokens, keys, or generated content.
import assert from 'node:assert/strict'
import https from 'node:https'
import WebSocket from 'ws'

const site = process.env.SMOKE_SITE
if (!site) throw new Error('Set SMOKE_SITE to the existing public website URL')
const targets = [
  ['east', '100.51.236.202'],
  ['west', '100.23.30.205'],
]
const domain = 'api.260926731.xyz'
const lookupFor = ip => (_hostname, options, callback) => options.all
  ? callback(null, [{ address: ip, family: 4 }])
  : callback(null, ip, 4)
const html = await (await fetch(site)).text()
const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
assert.ok(asset, 'website asset found')
const js = await (await fetch(new URL(asset, site))).text()
const supabaseURL = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
const publishableKey = js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
assert.ok(supabaseURL && publishableKey, 'public Supabase configuration found')
assert.ok(js.includes(`wss://${domain}/web/voice-stream`), 'published browser bundle uses AWS streaming')
const signup = await fetch(`${supabaseURL}/auth/v1/signup`, {
  method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' }, body: '{}',
})
assert.equal(signup.status, 200, 'synthetic guest signup')
const { access_token: token } = await signup.json()
assert.ok(token, 'synthetic guest token')
const consent = await fetch(`${supabaseURL}/rest/v1/rpc/cc_guest_action`, {
  method: 'POST',
  headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_action: 'consent', p_input: { version: 'web-handsfree-1.3' } }),
})
assert.equal(consent.status, 200, 'synthetic guest consent')

function request(ip, path, body) {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const serialized = body === undefined ? '' : JSON.stringify(body)
    const call = https.request({ hostname: domain, port: 443, path, method: body === undefined ? 'GET' : 'POST',
      lookup: lookupFor(ip),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(serialized) },
      timeout: 30000,
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        resolve({ status: response.statusCode, body: JSON.parse(raw), ms: Math.round(performance.now() - started) })
      })
    })
    call.on('timeout', () => call.destroy(new Error('canary timeout')))
    call.on('error', reject)
    call.end(serialized)
  })
}

function streamingHandshake(ip) {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const socket = new WebSocket(`wss://${domain}/web/voice-stream`, {
      origin: new URL(site).origin,
      lookup: lookupFor(ip),
      handshakeTimeout: 10000,
    })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('streaming ready timeout')) }, 20000)
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token, language: 'english' })))
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString())
      if (message.type === 'ready') {
        clearTimeout(timer)
        socket.close()
        resolve(Math.round(performance.now() - started))
      }
    })
    socket.on('error', error => { clearTimeout(timer); reject(error) })
    socket.on('close', code => {
      if (code !== 1000) { clearTimeout(timer); reject(new Error(`streaming closed ${code}`)) }
    })
  })
}

for (const [region, ip] of targets) {
  const health = await request(ip, '/health')
  assert.equal(health.status, 200, `${region} health`)
  const grade = await request(ip, '/web/answers/evaluate', {
    storyID: 'choochoo-birthday-cake', checkpointID: 'call-a-friend',
    targetLanguage: 'english', transcript: 'Call Feifei the fox.',
  })
  assert.equal(grade.status, 200, `${region} synthetic grade status`)
  assert.ok(['correct', 'meaningUnderstood', 'partial'].includes(grade.body.verdict), `${region} synthetic grade verdict`)
  const speech = await request(ip, '/web/speech/synthesize', { text: 'Hello, friend.', language: 'english' })
  assert.equal(speech.status, 200, `${region} synthetic speech status`)
  assert.ok(speech.body.audio || speech.body.audioBase64, `${region} synthetic speech audio`)
  const streamMs = await streamingHandshake(ip)
  console.log(`${region}: health ${health.ms}ms, grade ${grade.ms}ms, speech ${speech.ms}ms, streaming ready ${streamMs}ms`)
}

const published = await fetch(new URL('/api/speech/synthesize', site), {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Hello, friend.', language: 'english' }),
})
assert.equal(published.status, 200, 'published HTTPS speech proxy')
assert.equal(published.headers.get('x-choochoo-voice'), 'voice-runtime', 'published proxy uses AWS, not Oracle')
assert.ok((await published.json()).audioBase64, 'published proxy returns speech')
console.log('production: browser stream URL and Vercel voice proxy use AWS')
