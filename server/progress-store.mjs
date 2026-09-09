import catalog from '../src/data/stories.json' with { type: 'json' }

const eventKinds = new Set(['answer_evaluated','hint_played','mercy_fired','unusable_audio','sticker_earned','branch_taken','beat_advanced','session_ended','checkpoint_completed','transcription_completed','comfort_fired','play_turn'])
const verdicts = new Set(['correct','meaningUnderstood','partial','incorrect','uncertain','unusable','offTopic'])
const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max
const badInput = () => { const error = new Error('Invalid progress'); error.statusCode = 400; throw error }

/** Only bounded, structured learning facts may reach storage. Drop all speech. */
export function learningEvents(events) {
  if (!Array.isArray(events) || events.length > 100) return badInput()
  return events.filter((e) => e && eventKinds.has(e.type)).map((e) => {
    if (!integer(e.sequence, 10000) || e.sequence < 1) return badInput()
    const payload = e.payload ?? {}
    const result = { sequence: e.sequence, kind: e.type }
    if (typeof payload.beatID === 'string' && /^[a-z0-9-]{1,100}$/.test(payload.beatID)) result.beatID = payload.beatID
    if (verdicts.has(payload.verdict)) result.verdict = payload.verdict
    if (integer(payload.level, 4)) result.hintLevel = payload.level
    if (integer(payload.audioDurationMs, 30000)) result.audioMs = payload.audioDurationMs
    if (integer(payload.transcriptionLatencyMs, 120000)) result.latencyMs = payload.transcriptionLatencyMs
    return result
  })
}

export function progressSnapshot(value) {
  if (value == null) return null
  const story = catalog.stories.find((s) => s.beats.some((b) => b.id === value.beatID))
  // The database additionally validates every ID against the session's story.
  if (!story || !['story','recast'].includes(value.phase) || !integer(value.attemptCount,10000) || !integer(value.hintLevel,4) || typeof value.completed !== 'boolean') return badInput()
  const result = { beatID:value.beatID, phase:value.phase, attemptCount:value.attemptCount, hintLevel:value.hintLevel, completed:value.completed }
  for (const [key,max] of [['beatPath',20],['completedCheckpoints',30],['rewardIDs',30],['vocabularyIDs',100]]) {
    if (!Array.isArray(value[key]) || value[key].length>max || value[key].some((id) => typeof id!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) return badInput()
    result[key] = value[key]
  }
  return result
}

export async function guestAction(authorization, action, input={}) {
  const response = await fetch(`${process.env.VITE_SUPABASE_URL.replace(/\/$/,'')}/rest/v1/rpc/cc_guest_action`, {
    method:'POST', headers:{ apikey:process.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization:authorization, 'Content-Type':'application/json' },
    body:JSON.stringify({p_action:action,p_input:input}), signal:AbortSignal.timeout(12000),
  })
  const data=await response.json().catch(()=>({}))
  if (!response.ok) {
    const error=new Error('Progress service unavailable')
    error.statusCode=data.code==='42501'?403 : data.message==='Invalid recovery code'?400 : 503
    throw error
  }
  return data
}
