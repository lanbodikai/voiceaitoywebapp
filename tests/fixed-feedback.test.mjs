import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {englishHintFor} from '../src/fixedFeedback.ts'
import {fixedFeedbackCue,storyFeedbackCue,isCertifiedEdgeCue,preloadStoryFeedback,speak} from '../src/audio.ts'
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)))
const stories=read('../src/data/stories.json').stories
const feedback=read('../src/data/fixed-feedback.json')
const metadata=read('../src/data/edge-cues.json')
const boundaries=read('../src/data/conversation-boundaries.json')

test('every English checkpoint hint and success has exact fixed audio, including branch checkpoints',()=>{
  for(const story of stories)for(const {checkpoint} of story.beats) {
    for(let level=1;level<=4;level++) {
      const cue=storyFeedbackCue(story.id,checkpoint.id,'hint','english',level)
      assert.equal(feedback[cue]?.text,englishHintFor(checkpoint,level),cue)
      assert.ok(isCertifiedEdgeCue(cue))
    }
    assert.equal(feedback[storyFeedbackCue(story.id,checkpoint.id,'success','english')].text,'You did it!')
  }
  for(const language of ['english','chinese'])assert.ok(isCertifiedEdgeCue(fixedFeedbackCue(boundaries[language].retry,language)))
  assert.equal(fixedFeedbackCue('a dynamic answer','english'),undefined)
})

test('feedback provenance matches the normalized text and actual MP3',()=>{
  for(const [cue,{text,language}] of Object.entries(feedback)) {
    const spoken=language==='english'?text.replace(/\blo{3,}ng\b/gi,'long').replace(/\bwhoo+\b/gi,'a gentle breath').replace(/\s*[—–…]+\s*/g,'. ').trim():text
    // These feedback lines contain no elongated sound-effect words.
    assert.equal(metadata[cue].textHash,createHash('sha256').update(spoken).digest('hex'),cue)
    assert.equal(metadata[cue].audioHash,createHash('sha256').update(readFileSync(new URL(`../public/audio/${cue}.mp3`,import.meta.url))).digest('hex'),cue)
  }
})

test('only the active checkpoint feedback is prefetched and cleanup removes its hints',()=>{
  const old=globalThis.document,links=[]
  globalThis.document={createElement:()=>({remove(){this.removed=true}}),head:{append(link){links.push(link)}}}
  try {
    const story=stories[0],checkpoint=story.beats[0].checkpoint
    const cleanup=preloadStoryFeedback(story.id,checkpoint.id,'english')
    assert.equal(links.length,6)
    assert.ok(links.every(link=>link.rel==='prefetch' && link.as==='audio' && (link.href.includes(checkpoint.id)||link.href.includes('feedback_'))))
    cleanup();assert.ok(links.every(link=>link.removed))
  }finally{globalThis.document=old}
})

test('fixed feedback speaks from bundled audio without requesting TTS',async()=>{
  const old=globalThis.Audio;let source
  globalThis.Audio=class {
    constructor(url){source=url;this.listeners={}}
    addEventListener(event,fn){this.listeners[event]=fn}
    async play(){queueMicrotask(()=>this.listeners.ended())}
    pause(){}removeAttribute(){}
  }
  try {
    assert.equal(await speak(boundaries.english.retry,'english'),true)
    assert.match(source,/\/audio\/english_feedback_retry_v1\.mp3\?v=/)
  }finally{globalThis.Audio=old}
})
