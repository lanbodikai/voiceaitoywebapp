// Explicit opt-in integration test. Creates two synthetic anonymous guests.
// Credentials and recovery codes stay in process memory; stdout contains checks only.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const site = process.env.PROGRESS_TEST_SITE
if (!site) throw new Error('Set PROGRESS_TEST_SITE to opt in to cloud test records')
const html = await (await fetch(site)).text()
const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
const js = await (await fetch(new URL(asset,site))).text()
const url = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
const key = js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
assert.ok(url && key, 'Public Supabase configuration exists')
async function signup() {
  const r = await fetch(`${url}/auth/v1/signup`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}'})
  const data = await r.json()
  assert.equal(r.status,200,`Guest signup status ${r.status}`)
  return data
}
async function rpc(guest, action, input={}, expected=200) {
  const r = await fetch(`${url}/rest/v1/rpc/cc_guest_action`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${guest.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_input:input})})
  const data=await r.json()
  assert.equal(r.status,expected,`RPC ${action}: ${data.message ?? r.status}`)
  return data
}
const a=await signup(), b=await signup()
const pa=await rpc(a,'consent',{version:'web-research-1.1'})
await rpc(b,'consent',{version:'web-research-1.1'})
const sid=randomUUID()
await rpc(a,'start',{sessionID:sid,mode:'story',storyID:'choochoo-birthday-cake',language:'chinese',visual:'voice'})
const snapshot={beatID:'call-a-friend',phase:'story',attemptCount:1,hintLevel:1,completed:false,beatPath:['call-a-friend'],completedCheckpoints:[],rewardIDs:[],vocabularyIDs:['friend']}
const save={sessionID:sid,revision:2,events:[{sequence:1,kind:'answer_evaluated',beatID:'call-a-friend',verdict:'incorrect'},{sequence:2,kind:'hint_played',beatID:'call-a-friend',hintLevel:1}],snapshot}
await rpc(a,'save',save)
await rpc(a,'save',save)
await rpc(a,'save',{...save,revision:1,snapshot:{...snapshot,attemptCount:0}})
assert.equal((await rpc(a,'load')).stories[0].snapshot.attemptCount,1)
assert.equal((await rpc(b,'load')).stories.length,0)
await rpc(b,'save',save,403)
await rpc(a,'save',{...save,snapshot:{...snapshot,transcript:'must not persist'}},400)
const direct=await fetch(`${url}/rest/v1/cc_story_progress?select=*`,{headers:{apikey:key,Authorization:`Bearer ${a.access_token}`}})
assert.equal(direct.status,403)
const recovery=await rpc(a,'recovery_create')
await rpc(b,'recovery_restore',{code:recovery.code})
assert.equal((await rpc(b,'load')).profileID,pa.participantID)
assert.equal((await rpc(b,'load')).stories[0].snapshot.hintLevel,1)
const newer=randomUUID()
await rpc(b,'start',{sessionID:newer,mode:'story',storyID:'choochoo-birthday-cake',language:'chinese',visual:'voice'})
await rpc(b,'save',{...save,sessionID:newer,revision:3,snapshot:{...snapshot,attemptCount:3}})
await rpc(a,'save',{...save,revision:999})
assert.equal((await rpc(a,'load')).stories[0].snapshot.attemptCount,3)
console.log('PASS: guest signup, consent, persistence, duplicate/stale retry, cross-guest isolation, raw-text rejection, recovery, newer-visit protection')
console.log('Synthetic test user IDs for optional administrator cleanup:', a.user.id, b.user.id)
