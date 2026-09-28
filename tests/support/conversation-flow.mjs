// Real React conversation flow with synthetic speech and no external services.
import assert from 'node:assert/strict'
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({headless:true,channel:'chrome'})
try {
  const page = await browser.newPage()
  page.on('pageerror',error=>console.error(error.message))
  const site = process.env.FLOW_TEST_SITE || 'http://localhost:5180'
  const transformed = await (await page.request.get(`${site}/src/App.tsx`)).text()
  const reactURL = transformed.match(/"(\/node_modules\/\.vite\/deps\/react\.js\?v=[^"]+)"/)[1]
  await page.addInitScript(() => {
    localStorage.setItem('choochoo:preferences',JSON.stringify({language:'english'}))
    localStorage.setItem('choochoo:consent:fixture',JSON.stringify('web-handsfree-1.4'))
    window.spoken=[]
  })
  await page.route('**/src/supabase.ts*', route=>route.fulfill({contentType:'application/javascript',body:`
    export const supabase=null;
    export const restoreParticipant=async()=>({id:'fixture'});
    export const signInAnonymously=restoreParticipant;
    export const accessToken=async()=>'fixture';
  `}))
  await page.route('**/src/backend.ts*', route=>route.fulfill({contentType:'application/javascript',body:`
    export const hasPendingProgress=()=>false;
    export const createRecoveryCode=async()=>({code:'fixture'});
    export const restoreProgress=async()=>({});
    export const loadProgress=async()=>({});
    export const flushEventQueue=async()=>{};
    export const evaluateRemotely=async()=>({verdict:'correct',matchedConcepts:[]});
    export const generateLine=async()=>({line:'Our adventure continues.'});
    export const recordConsent=async()=>{};
    export const safetyCheck=async()=>({safe:true});
    export const startResearchSession=async()=>({sessionID:'fixture'});
    export const uploadEvents=async()=>{};
  `}))
  await page.route('**/src/audio.ts*', route=>route.fulfill({contentType:'application/javascript',body:`
    export const speak=async(text)=>{window.spoken.push(text);return true};
    export const stopVoice=()=>{};
    export const setSpeechRate=()=>{};
    export const cueForLanguage=x=>x;
    export const storyFeedbackCue=()=>undefined;
    export const preloadStoryFeedback=()=>()=>{};
    export const preloadFixedSpeech=()=>()=>{};
    export const playEarcon=()=>{};
    export const playEffect=()=>{};
  `}))
  await page.route('**/src/useHandsFree.ts*', route=>route.fulfill({contentType:'application/javascript',body:`
    import React from '${reactURL}';
    const {useState,useRef}=React;
    export function useHandsFree(options){
      const [enabled,setEnabled]=useState(false);const active=useRef(false);
      window.respond=async(text)=>{options.onStart();await options.onTranscript(text,()=>true)};
      return {enabled,starting:false,recording:false,error:'',
        enable:async()=>{active.current=true;setEnabled(true);return true},
        disable:()=>{active.current=false;setEnabled(false)},toggle:()=>{},isEnabled:()=>active.current};
    }
  `}))
  await page.clock.install()
  await page.goto(site)
  await page.locator('.mode-card').nth(2).click()
  await page.getByRole('button',{name:'Turn on mic & begin'}).click()
  await page.waitForFunction(()=>window.spoken.some(x=>x.includes('call you')))
  await page.evaluate(()=>window.respond('Continue'))
  await page.waitForFunction(()=>window.spoken.at(-1)?.includes('Ready for our story'))
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('choochoo:learner:device')).name),undefined)
  await page.evaluate(()=>window.respond('I am ready'))
  await page.waitForFunction(()=>document.querySelector('.progress-dots .filled'))
  const initial=await page.locator('.progress-dots .filled').count()
  assert.equal(await page.locator('.puzzle-tray-pieces .earned').count(),0)
  await page.clock.fastForward(18100)
  await page.waitForFunction(()=>window.spoken.at(-1)?.includes('tummy is rumbling'))
  assert.equal(await page.locator('.progress-dots .filled').count(),initial)
  assert.equal(await page.locator('.puzzle-tray-pieces .earned').count(),0)
  await page.clock.fastForward(18100)
  await page.waitForFunction(n=>document.querySelectorAll('.progress-dots .filled').length>n,initial)
  assert.equal(await page.locator('.puzzle-tray-pieces .earned').count(),1)
  assert.equal(await page.locator('.story-puzzle-stage').isVisible(),true)
  assert.equal(await page.locator('.story-puzzle-picture .piece-entering').count(),1)
  await page.clock.runFor(2700)
  assert.equal(await page.locator('.story-puzzle-stage').isVisible(),false)
  assert.equal(await page.locator('.story-agent-stage .three-orb').isVisible(),true)
  const lines=await page.evaluate(()=>window.spoken)
  assert.ok(!lines.some(x=>/sticker|take your time/i.test(x)))
  assert.equal(await page.locator('.sticker-shelf, .completion-stickers').count(),0)
  console.log('PASS: Continue is not saved as a name; first silence encourages; second silence earns one puzzle piece and advances; no sticker speech or display.')
} finally { await browser.close() }
