// Explicit opt-in live test: synthetic guest, no child audio or private transcripts.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import catalog from '../src/data/stories.json' with { type: 'json' }
import cues from '../src/data/edge-cues.json' with { type: 'json' }

const site = process.env.CLASSIC_STORY_TEST_SITE
if (!site) throw new Error('Set CLASSIC_STORY_TEST_SITE to opt in to synthetic cloud test records')
const html = await (await fetch(site)).text()
const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
assert.ok(asset)
const bundle = await (await fetch(new URL(asset,site))).text()
const url = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
const key = bundle.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0]
assert.ok(url && key)
const signup = await fetch(url+'/auth/v1/signup',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}'})
assert.equal(signup.status,200)
const guest = await signup.json()
async function app(path,body) {
  const response = await fetch(new URL('/api/'+path,site),{
    method:'POST',headers:{Authorization:'Bearer '+guest.access_token,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(30000),
  })
  const result = await response.json()
  assert.equal(response.status,200,path+': '+JSON.stringify(result.error || ''))
  return result
}
await app('participants/consent',{consentVersion:'web-research-1.1'})
for (const story of catalog.stories.filter(s=>['little-red-hen','henny-penny'].includes(s.id))) {
  assert.ok(bundle.includes(story.englishTitle), 'deployed catalog: '+story.id)
  for (const language of ['english','chinese']) {
    const sessionID=randomUUID()
    const start={sessionID,mode:'story',storyID:story.id,language,visualCondition:'voice'}
    await app('sessions/start',start)
    await app('sessions/start',start)
    for (const [index,beat] of story.beats.entries()) {
      const snapshot={beatID:beat.id,phase:'story',attemptCount:0,hintLevel:0,completed:index===story.beats.length-1,
        beatPath:story.beats.slice(0,index+1).map(b=>b.id),completedCheckpoints:story.beats.slice(0,index+1).map(b=>b.checkpoint.id),
        rewardIDs:[],vocabularyIDs:[...new Set(story.beats.slice(0,index+1).flatMap(b=>b.checkpoint.vocabulary.map(v=>v.id)))]}
      const save={sessionID,revision:index+1,events:[{sequence:index+1,type:'checkpoint_completed',payload:{beatID:beat.id}}],snapshot}
      await app('sessions/log',save)
      await app('sessions/log',save)
      for (const cue of [beat.audioCue,beat.checkpoint.audioCue]) {
        const id=(language==='english'?'en_':'')+cue
        const response=await fetch(new URL('/audio/'+id+'.mp3',site))
        assert.equal(response.status,200,id)
        assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),cues[id].audioHash,id)
      }
    }
    const records=(await app('progress/load',{})).stories.filter(s=>s.storyID===story.id && s.language===language)
    assert.equal(records.length,1,'retries did not duplicate progress')
    assert.equal(records[0].snapshot.completed,true)
    assert.equal(records[0].snapshot.completedCheckpoints.length,story.beats.length)
    console.log('PASS '+story.id+' '+language+': all scenes, certified audio, idempotent start/save and completed progress')
  }
}
console.log('Synthetic guest ID for optional administrator cleanup:',guest.user.id)
