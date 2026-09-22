import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {dirname,join} from 'node:path'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
const manifest=JSON.parse(await readFile(join(root,'src/data/edge-cues.json'),'utf8'))
const entries=Object.entries(manifest)
if(!entries.length) throw new Error('No certified Edge-TTS cues were found')
const runtimeIDs=JSON.parse(await readFile(join(root,'src/data/edge-cue-ids.json'),'utf8'))
if(JSON.stringify(runtimeIDs)!==JSON.stringify(entries.map(([cue])=>cue).sort())) throw new Error('Runtime Edge-TTS cue allowlist is stale')

await Promise.all(entries.map(async([cue,metadata])=>{
  if(!/^[a-zA-Z0-9_-]+$/.test(cue)) throw new Error(`Invalid cue id: ${cue}`)
  const expectedVoice=cue.startsWith('en_')?'en-US-AvaNeural':'zh-CN-XiaoxiaoNeural'
  if(metadata.voice!==expectedVoice) throw new Error(`Unexpected voice for ${cue}`)
  const bytes=await readFile(join(root,'public/audio',`${cue}.mp3`))
  const hash=createHash('sha256').update(bytes).digest('hex')
  if(hash!==metadata.audioHash) throw new Error(`Unverified audio for ${cue}`)
}))

console.log(`Verified ${entries.length} certified Edge-TTS cue files.`)
