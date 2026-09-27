// Real dashboard and story state, synthetic guest/speech only. No cloud writes or real mic.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const {stories}=JSON.parse(readFileSync(new URL('../../src/data/stories.json',import.meta.url)))
const site=process.env.FLOW_TEST_SITE || 'http://localhost:5180'
const browser=await chromium.launch({headless:true,channel:'chrome'})
const page=await browser.newPage({viewport:{width:1440,height:1100}})
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
try {
  const source=await (await page.request.get(`${site}/src/App.tsx`)).text()
  const reactURL=source.match(/"(\/node_modules\/\.vite\/deps\/react\.js\?v=[^"]+)"/)[1]
  await page.addInitScript(stories=>{
    if(!localStorage.getItem('dashboard-fixture')) {
      localStorage.setItem('dashboard-fixture','true')
      localStorage.setItem('choochoo:guest-profile',JSON.stringify('dashboard-guest'))
      localStorage.setItem('choochoo:preferences',JSON.stringify({language:'english'}))
      localStorage.setItem('choochoo:learner:dashboard-guest',JSON.stringify({nameAsked:true}))
      localStorage.setItem('choochoo:collections:dashboard-guest',JSON.stringify([
        {storyID:stories[0].id,language:'english'}, {storyID:stories[2].id,language:'english'}, {storyID:stories[4].id,language:'chinese'}
      ]))
      const records=stories.map((story,index)=>({storyID:story.id,language:'english',snapshot:{
        beatID:story.startBeatId,phase:'story',completed:index===0,attemptCount:0,hintLevel:0,beatPath:[story.startBeatId],
        completedCheckpoints:index===0?story.beats.slice(0,5).map(beat=>beat.checkpoint.id):index===1?[story.beats[0].checkpoint.id,story.beats[0].checkpoint.id,story.beats[1].checkpoint.id]:index===2?[story.beats[0].checkpoint.id]:index===4?story.beats.slice(0,3).map(beat=>beat.checkpoint.id):[],rewardIDs:[],vocabularyIDs:[]
      }})).filter((_,index)=>index!==3)
      localStorage.setItem('choochoo:progress:dashboard-guest',JSON.stringify(records))
      localStorage.setItem(`choochoo:puzzle-layout:${stories[2].id}:english`,JSON.stringify({active:'ribbons',lastCompleted:'ribbons'}))
      localStorage.setItem(`choochoo:puzzle-layout:${stories[4].id}:english`,JSON.stringify({active:'panels'}))
    }
    window.spoken=[];window.events=[];window.micStarts=0
  },stories)
  await page.route('**/src/supabase.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const supabase=null;export const restoreParticipant=async()=>({id:'fixture'});
    export const signInAnonymously=restoreParticipant;export const accessToken=async()=>'fixture';
  `}))
  await page.route('**/src/backend.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const hasPendingProgress=()=>false;export const loadProgress=async()=>({});export const flushEventQueue=async()=>{};
    export const createRecoveryCode=async()=>({code:'fixture'});export const restoreProgress=async()=>{};
    export const recordConsent=async()=>{};export const safetyCheck=async()=>({safe:true});
    export const startResearchSession=async()=>({sessionID:'fixture'});export const uploadEvents=async(_id,events)=>{window.events=events};
    export const evaluateRemotely=async()=>({verdict:'correct',matchedConcepts:[]});export const generateLine=async()=>({action:'continue',line:'Our story continues.'});
  `}))
  await page.route('**/src/audio.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    export const speak=async(text)=>{window.spoken.push(text);return true};export const stopVoice=()=>{};
    export const setSpeechRate=()=>{};export const cueForLanguage=x=>x;export const storyFeedbackCue=()=>undefined;
    export const preloadStoryFeedback=()=>()=>{};
        export const preloadFixedSpeech=()=>()=>{};
    export const playEarcon=()=>{};export const playEffect=()=>{};
  `}))
  await page.route('**/src/useHandsFree.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    import React from '${reactURL}';const {useState,useRef}=React;
    export function useHandsFree(options){const [enabled,setEnabled]=useState(false);const active=useRef(false);
      window.respond=async(text)=>{options.onStart();await options.onTranscript(text,()=>true)};
      return {enabled,starting:false,recording:false,error:'',enable:async()=>{window.micStarts++;active.current=true;setEnabled(true);return true},
      disable:()=>{active.current=false;setEnabled(false)},toggle:()=>{},isEnabled:()=>active.current};}
  `}))
  await page.goto(site)
  await page.locator('.dashboard-home').waitFor()
  assert.equal(await page.locator('.dashboard-story-card').count(),5)
  assert.equal(await page.locator('.collection-card').count(),5)
  assert.equal(await page.locator('.collection-card.is-collected').count(),2,JSON.stringify(await page.evaluate(()=>({guest:localStorage.getItem('choochoo:guest-profile'),collections:localStorage.getItem('choochoo:collections:dashboard-guest'),language:document.documentElement.lang,errors:document.body.innerText.slice(0,200)}))))
  assert.equal(await page.getByRole('progressbar').getAttribute('value'),'2')
  assert.match(await page.locator('.dashboard-story-card').nth(1).innerText(),/40% complete/)
  assert.match(await page.locator('.dashboard-story-card').nth(2).innerText(),/20% complete[\s\S]*Puzzle collected[\s\S]*Continue story/)
  assert.match(await page.locator('.dashboard-story-card').nth(4).innerText(),/50% complete/)
  assert.match(await page.locator('.dashboard-story-card').first().innerText(),/100% complete/)
  assert.match(await page.locator('.dashboard-story-card').nth(3).innerText(),/0% complete/)
  assert.equal(await page.locator('.collection-cover > img[loading="lazy"]').count(),5)
  const partial=page.locator('.collection-card').nth(1)
  assert.equal(await partial.locator('.collection-piece-reveal').count(),2,'five-piece picture reveals exactly its two unique earned pieces')
  assert.equal(await partial.locator('.collection-lock-copy').count(),0,'unlock text must not cover earned artwork')
  assert.equal(await partial.locator('.collection-piece-reveal img').first().evaluate(el=>getComputedStyle(el).filter),'none')
  assert.equal(await partial.locator('.collection-piece-reveal img').first().evaluate(el=>getComputedStyle(el).opacity),'1')
  assert.match(await partial.locator('.collection-cover > img').evaluate(el=>getComputedStyle(el).filter),/brightness\(0.55\)/)
  assert.equal(await page.locator('.collection-card').nth(4).locator('.collection-piece-reveal').count(),3,'six-piece picture reveals three pieces')
  assert.ok(await page.locator('.collection-card').nth(4).locator('.collection-piece-reveal').first().evaluate(el=>el.style.clipPath.split(',').length>30),'gallery pieces use curved jigsaw silhouettes, not rectangular slices')
  assert.equal(await page.locator('.collection-card').nth(4).locator('.puzzle-seams path').count(),6)
  assert.match(await partial.locator('.puzzle-seams path').first().getAttribute('d'),/C /)
  assert.equal(await page.locator('.collection-card.is-collected .collection-piece-reveal').count(),0,'previously collected pictures stay fully visible during replay')
  const columns=async selector=>page.locator(selector).evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)
  assert.equal(await columns('.dashboard-story-grid'),3)
  assert.equal(await columns('.collection-grid'),5)
  if(process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.DASHBOARD_SCREENSHOT_DIR}/dashboard-desktop.png`,fullPage:true})
  await page.setViewportSize({width:820,height:1180})
  assert.equal(await columns('.dashboard-story-grid'),2)
  assert.equal(await columns('.collection-grid'),3)
  await page.setViewportSize({width:390,height:844})
  assert.equal(await columns('.dashboard-story-grid'),1)
  assert.equal(await columns('.collection-grid'),2)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
  assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.every(button=>button.getBoundingClientRect().height>=44)),true)
  if(process.env.DASHBOARD_SCREENSHOT_DIR) await page.screenshot({path:`${process.env.DASHBOARD_SCREENSHOT_DIR}/dashboard-phone.png`,fullPage:true})
  await page.getByRole('button',{name:'中文',exact:true}).click()
  assert.equal(await page.getByRole('progressbar').getAttribute('value'),'1')
  assert.equal(await page.locator('.collection-card.is-collected').count(),1)
  await page.getByRole('button',{name:'English',exact:true}).click()
  const firstCollection=page.locator('.collection-card').first()
  await firstCollection.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('.collection-detail img').getAttribute('alt'),stories[0].puzzle.englishAltText)
  assert.deepEqual(await page.evaluate(()=>({spoken:window.spoken,events:window.events,micStarts:window.micStarts})),{spoken:[],events:[],micStarts:0})
  await page.keyboard.press('Escape')
  assert.equal(await firstCollection.evaluate(el=>document.activeElement===el),true)
  await page.emulateMedia({reducedMotion:'reduce'})
  assert.equal(await page.locator('.dashboard-story-card').first().evaluate(el=>getComputedStyle(el).transitionDuration),'0s')
  await page.reload()
  await page.locator('.dashboard-home').waitFor()
  assert.equal(await page.getByRole('progressbar').getAttribute('value'),'2','collection survives refresh')
  assert.equal(await page.locator('.collection-card').nth(1).locator('.collection-piece-reveal').count(),2,'partial artwork restores after refresh')
  // Replay from an unlocked picture must start fresh, even during an interrupted replay.
  await page.locator('.collection-card').nth(2).click()
  await page.getByRole('button',{name:'Replay story',exact:true}).click()
  assert.equal(await page.locator('.puzzle-tray-pieces .earned').count(),0)
  assert.equal(await page.evaluate(()=>window.micStarts),0)
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem(`choochoo:puzzle-layout:${id}:english`)).active,stories[2].id),'patchwork')
  await page.getByRole('button',{name:'Turn on mic & begin',exact:true}).click()
  await page.waitForFunction(()=>window.spoken.at(-1)?.includes('Ready for our story'))
  await page.evaluate(()=>window.respond('I am ready'))
  await page.waitForFunction(()=>document.querySelector('.room-state')?.textContent==='Your turn')
  await page.getByRole('button',{name:'End',exact:true}).click()
  await page.getByRole('button',{name:'End conversation',exact:true}).click()
  await page.getByRole('button',{name:'All done',exact:true}).click()
  await page.locator('.dashboard-home').waitFor()
  assert.equal(await page.getByRole('progressbar').getAttribute('value'),'2')
  assert.match(await page.locator('.dashboard-story-card').nth(2).innerText(),/0% complete[\s\S]*Puzzle collected/)
  assert.equal(await page.evaluate(()=>window.events.filter(event=>event.type==='puzzle_assembled').length),0,'early exit does not assemble')
  const micBefore=await page.evaluate(()=>window.micStarts)
  await page.locator('.collection-card.is-locked').first().click()
  await page.getByRole('button',{name:'Turn on mic & begin',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.micStarts),micBefore,'locked gallery navigation never starts the microphone')
  await page.getByRole('button',{name:'Back to home',exact:true}).click()
  // Simulate the real cloud acceptance path on a recovered guest; dashboard updates live.
  await page.evaluate(async storyID=>{
    const {acceptCloudProgress}=await import('/src/progress.ts')
    acceptCloudProgress({profileID:'recovered-guest',stories:[],collections:[{storyID,language:'english'}]})
  },stories[4].id)
  await page.waitForFunction(()=>document.querySelector('.collection-summary progress')?.value===1)
  assert.equal(await page.locator('.collection-card.is-collected').getAttribute('data-story-id'),stories[4].id)
  await page.route('**/illustrations/scene_penny_home.png',route=>route.abort())
  await page.reload()
  await page.locator('.collection-card.is-collected').scrollIntoViewIfNeeded()
  await page.locator('.collection-card.is-collected .collection-art-fallback').waitFor()
  await page.locator('.collection-card.is-collected').click()
  await page.locator('.collection-detail .collection-art-fallback').waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS dashboard: bilingual collections, unique piece counts, responsive grids, keyboard dialog, reduced motion, refresh, replay retention, recovery isolation, locked navigation, and missing-art fallback.')
} finally {await browser.close()}
