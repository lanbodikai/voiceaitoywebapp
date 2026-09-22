// Explicit synthetic smoke test: no child microphone, audio, or transcript logging.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const site = process.env.VOICE_TEST_SITE
const voice = process.env.VOICE_TEST_ORIGIN || `${site}/api`
const audioPath = process.env.VOICE_TEST_SYNTHETIC_WAV
if (!site || !audioPath) throw new Error('Set VOICE_TEST_SITE and VOICE_TEST_SYNTHETIC_WAV')
const html = await (await fetch(site)).text()
const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
const js = await (await fetch(new URL(asset, site))).text()
const url = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
const key = js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
assert.ok(url && key)
const signup = await fetch(`${url}/auth/v1/signup`, { method:'POST', headers:{apikey:key,'Content-Type':'application/json'}, body:'{}' })
assert.equal(signup.status, 200)
const guest = await signup.json()
const headers = {Authorization:`Bearer ${guest.access_token}`,'Content-Type':'application/json'}
const denied = await fetch(`${voice}/answers/safety-check`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{"transcript":"hello"}'})
assert.equal(denied.status, 401)
const noConsent = await fetch(`${voice}/answers/safety-check`, {method:'POST',headers,body:'{"transcript":"hello"}'})
assert.equal(noConsent.status, 403)
const consent = await fetch(`${site}/api/participants/consent`, {method:'POST',headers,body:JSON.stringify({shareIdentity:false,consentVersion:'web-handsfree-1.2'})})
assert.equal(consent.status, 200)
async function call(path, init) {
  const start = Date.now()
  const response = await fetch(`${voice}/${path}`, {...init,signal:AbortSignal.timeout(35000)})
  const data = await response.json()
  console.log(JSON.stringify({route:path,status:response.status,oracle:response.headers.get('x-choochoo-voice'),latencyMs:Date.now()-start}))
  assert.equal(response.status,200)
  assert.equal(response.headers.get('x-choochoo-voice'),'oracle')
  return data
}
const form = new FormData()
form.append('audio',new Blob([await readFile(audioPath)],{type:'audio/wav'}),'synthetic.wav')
for (const [k,v] of Object.entries({language:'english',storyID:'choochoo-birthday-cake',beatID:'call-a-friend',durationMs:'3400'})) form.append(k,v)
const transcription = await call('transcribe',{method:'POST',headers:{Authorization:headers.Authorization},body:form})
assert.ok(transcription.transcript.trim().length > 0)
assert.ok((await call('answers/safety-check',{method:'POST',headers,body:JSON.stringify({transcript:transcription.transcript})})).safe)
const line = await call('lines/generate',{method:'POST',headers,body:JSON.stringify({language:'english',kind:'openReply',previousLine:'What would you like to play?',learnerSpeech:'Let us pretend to be cats.'})})
assert.ok(line.line?.length > 0)
const grade = await call('answers/evaluate',{method:'POST',headers,body:JSON.stringify({storyID:'choochoo-birthday-cake',checkpointID:'call-a-friend',targetLanguage:'english',transcript:'I choose the fox.',attempt:1,hintLevel:0,detectedLanguage:'english'})})
assert.ok(['correct','meaningUnderstood','partial','incorrect','uncertain'].includes(grade.verdict))
assert.ok((await (await fetch(`${site}/api/progress/load`,{method:'POST',headers})).json()).profileID)
console.log('PASS: unauthorized and unconsented requests blocked; real Oracle transcription, moderation, nano reply, grading, and guest progress')
console.log('Synthetic guest ID for optional cleanup:',guest.user.id)
