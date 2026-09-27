// Browser coverage for the concrete September 25 feedback, with synthetic speech.
import assert from 'node:assert/strict'
import catalog from '../../src/data/stories.json' with { type: 'json' }
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const site = process.env.FLOW_TEST_SITE || 'http://localhost:5180'
const noodle = catalog.stories.find(story => story.id === 'choochoo-noodle-shop')
const thanksBeat = noodle.beats.find(beat => beat.checkpoint.id === 'bengbeng-thanks')

try {
  for (const language of ['english', 'chinese']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const transformed = await (await page.request.get(`${site}/src/App.tsx`)).text()
    const reactURL = transformed.match(/"(\/node_modules\/\.vite\/deps\/react\.js\?v=[^"]+)"/)[1]
    await page.addInitScript(({ language, storyID, beatID }) => {
      localStorage.setItem('choochoo:preferences', JSON.stringify({ language }))
      localStorage.setItem('choochoo:learner:device', JSON.stringify({ nameAsked: true, name: 'Luna' }))
      localStorage.setItem('choochoo:progress:', JSON.stringify([{ storyID, language, snapshot: { beatID, phase: 'story', completed: false, attemptCount: 0, hintLevel: 0, beatPath: [beatID], completedCheckpoints: [], rewardIDs: [], vocabularyIDs: [] } }]))
      window.spoken = []; window.remoteGrades = 0; window.events = []
    }, { language, storyID: noodle.id, beatID: thanksBeat.id })
    await page.route('**/src/supabase.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export const supabase=null; export const restoreParticipant=async()=>({id:'fixture'});
      export const signInAnonymously=restoreParticipant; export const accessToken=async()=>'fixture';
    ` }))
    await page.route('**/src/backend.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export const hasPendingProgress=()=>false; export const createRecoveryCode=async()=>({code:'fixture'});
      export const restoreProgress=async()=>({}); export const loadProgress=async()=>({}); export const flushEventQueue=async()=>{};
      export const evaluateRemotely=async()=>{window.remoteGrades++;return {verdict:'uncertain',matchedConcepts:[]}};
      export const generateLine=async()=>({line:'Let us try again.',action:'retry'});
      export const recordConsent=async()=>{}; export const safetyCheck=async()=>({safe:true});
      export const startResearchSession=async()=>({sessionID:'fixture'});
      export const uploadEvents=async(_id,events)=>{window.events=events};
    ` }))
    await page.route('**/src/audio.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export const speak=async(text)=>{window.spoken.push(text);return true}; export const stopVoice=()=>{};
      export const setSpeechRate=()=>{}; export const cueForLanguage=x=>x; export const storyFeedbackCue=()=>undefined;
      export const preloadStoryFeedback=()=>()=>{}; export const preloadFixedSpeech=()=>()=>{};
      export const playEarcon=()=>{}; export const playEffect=()=>{};
    ` }))
    await page.route('**/src/useHandsFree.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
      import React from '${reactURL}'; const {useState,useRef}=React;
      export function useHandsFree(options){const [enabled,setEnabled]=useState(false);const active=useRef(false);
        window.respond=async(text)=>{if(!active.current||!options.allowed)return;options.onStart();options.onProcessing();await options.onTranscript(text,()=>true)};
        return {enabled,starting:false,recording:false,error:'',enable:async()=>{active.current=true;setEnabled(true);return true},
          disable:()=>{active.current=false;setEnabled(false)},toggle:()=>{},isEnabled:()=>active.current};}
    ` }))
    await page.clock.install()
    await page.goto(site)
    await page.getByRole('button', { name: language === 'english' ? 'Turn on mic and choose' : '打开麦克风，开始选故事' }).click()
    await page.waitForFunction(() => window.spoken.at(-1)?.includes('Which story') || window.spoken.at(-1)?.includes('想听哪个故事'))
    await page.evaluate(text => window.respond(text), language === 'english' ? 'the noodle shop' : '小面馆')
    await page.waitForFunction(() => document.querySelector('.room') && window.spoken.some(line => /Ready for our story|准备好听故事/.test(line)))
    assert.equal(await page.getByRole('button', { name: language === 'english' ? 'Turn on mic & begin' : '打开麦克风，开始聊天' }).count(), 0, 'voice selection automatically joins')
    await page.evaluate(text => window.respond(text), language === 'english' ? 'I am ready' : '准备好了')
    await page.waitForFunction(question => window.spoken.at(-1) === question, language === 'english' ? thanksBeat.checkpoint.englishQuestion : thanksBeat.checkpoint.question)
    const before = await page.evaluate(() => window.events.filter(event => event.type === 'checkpoint_completed').length)
    await page.evaluate(text => window.respond(text), language === 'english' ? 'thanks' : '谢谢')
    await page.waitForFunction(before => window.events.filter(event => event.type === 'checkpoint_completed').length > before, before)
    assert.equal(await page.evaluate(() => window.remoteGrades), 0, 'short valid answer needs no slow model grade')
    assert.ok(!(await page.evaluate(() => window.spoken)).some(line => /two things|哪两句话|One answer/.test(line)))
    await page.waitForFunction(() => window.spoken.at(-1)?.includes('favorite thing') || window.spoken.at(-1)?.includes('最想吃'))
    await page.evaluate(() => window.respond('purple the because yesterday'))
    await page.waitForFunction(() => document.querySelector('.room-state')?.textContent?.includes('turn') || document.querySelector('.room-state')?.textContent?.includes('轮到'))
    const afterRepair = await page.evaluate(() => window.events.filter(event => event.type === 'checkpoint_completed').length)
    await page.clock.fastForward(12100)
    assert.equal(await page.evaluate(() => window.events.filter(event => event.type === 'checkpoint_completed').length), afterRepair)
    await page.clock.fastForward(12100)
    await page.waitForFunction(before => window.events.filter(event => event.type === 'checkpoint_completed').length > before, afterRepair)
    assert.deepEqual(errors, [])
    console.log(`PASS ${language}: voice choice auto-starts; thanks is immediate; unclear speech plus silence continues after invitation`)
    await page.close()
  }
} finally { await browser.close() }
