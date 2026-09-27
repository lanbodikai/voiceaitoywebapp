// Real React state transitions, synthetic speech; no external account or microphone.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { boundaryLines } from '../../server/conversation-boundaries.mjs'
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const catalog = JSON.parse(readFileSync(new URL('../../src/data/stories.json',import.meta.url)))
const browser = await chromium.launch({headless:true,channel:'chrome'})
const site = process.env.FLOW_TEST_SITE || 'http://localhost:5180'
const story = catalog.stories[2]
try {
  for (const language of ['english','chinese']) {
    for (const mode of ['choice','open','play']) {
      if (process.env.FLOW_TEST_MODES && !process.env.FLOW_TEST_MODES.split(',').includes(mode)) continue
      const page = await browser.newPage()
      const errors=[]; page.on('pageerror',error=>errors.push(error.message))
      const transformed = await (await page.request.get(`${site}/src/App.tsx`)).text()
      const reactURL = transformed.match(/"(\/node_modules\/\.vite\/deps\/react\.js\?v=[^"]+)"/)[1]
      const beat = story.beats.find(beat => beat.checkpoint.kind === (mode === 'open' ? 'open' : 'choice'))
      const question = language === 'english' ? beat.checkpoint.englishQuestion : beat.checkpoint.question
      const completedBeforeBeat = story.beats.filter(item => item.id !== beat.id).slice(0, story.typicalPathLength - 1).map(item => item.checkpoint.id)
      await page.addInitScript(({language,mode,beat,storyID,completedBeforeBeat}) => {
        localStorage.setItem('choochoo:preferences',JSON.stringify({language}))
        localStorage.setItem('choochoo:learner:device',JSON.stringify({nameAsked:true,name:'Luna'}))
        if(mode === 'open') localStorage.setItem('choochoo:progress:',JSON.stringify([{storyID,language,snapshot:{beatID:beat.id,phase:'story',completed:false,attemptCount:0,hintLevel:0,beatPath:[beat.id],completedCheckpoints:completedBeforeBeat,rewardIDs:[],vocabularyIDs:[]}}]))
        window.spoken=[]; window.events=[]; window.requests=[]; window.verdict='offTopic'; window.action='redirect'
      },{language,mode,beat,storyID:story.id,completedBeforeBeat})
      await page.route('**/src/supabase.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
        export const supabase=null; export const restoreParticipant=async()=>({id:'fixture'});
        export const signInAnonymously=restoreParticipant; export const accessToken=async()=>'fixture';
      `}))
      await page.route('**/src/backend.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
        const fixed=${JSON.stringify(boundaryLines[language])};
        export const hasPendingProgress=()=>false;
        export const createRecoveryCode=async()=>({code:'fixture'}); export const restoreProgress=async()=>({});
        export const loadProgress=async()=>({}); export const flushEventQueue=async()=>{};
        export const evaluateRemotely=async(body)=>{window.requests.push(body);if(window.verdict==='error')throw Error('synthetic');return {verdict:window.verdict,matchedConcepts:[],language:'${language}',confidence:0.9}};
        export const generateLine=async(body)=>{window.requests.push(body);if(window.action==='error')throw Error('synthetic');return {action:window.action,line:window.action==='retry'?fixed.retry:window.action==='redirect'?fixed.acknowledgement+' '+fixed.bridge+' '+(body.currentQuestion||body.previousLine):'${language === 'english' ? 'Our little dragon carefully helps the rabbit.' : '小龙轻轻地帮小兔子拿起了篮子。'}'}};
        export const recordConsent=async()=>{}; export const safetyCheck=async()=>({safe:true});
        export const startResearchSession=async()=>({sessionID:'fixture'});
        export const uploadEvents=async(_id,events)=>{window.events=events};
      `}))
      await page.route('**/src/audio.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
        export const speak=async(text)=>{window.spoken.push(text);return true}; export const stopVoice=()=>{};
        export const setSpeechRate=()=>{}; export const cueForLanguage=x=>x;
        export const storyFeedbackCue=()=>undefined; export const playEarcon=()=>{}; export const playEffect=()=>{};
        export const preloadStoryFeedback=()=>()=>{};
        export const preloadFixedSpeech=()=>()=>{};
      `}))
      await page.route('**/src/useHandsFree.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
        import React from '${reactURL}'; const {useState,useRef}=React;
        export function useHandsFree(options){const [enabled,setEnabled]=useState(false);const active=useRef(false);
          window.respond=async(text)=>{if(!active.current || !options.allowed)return;options.onStart();await options.onTranscript(text,()=>true)};
          window.failSpeech=()=>options.onError();
          window.hideTab=()=>{active.current=false;setEnabled(false);options.onMuted()};
          return {enabled,starting:false,recording:false,error:'',enable:async()=>{if(window.micFailure){options.onError();return false}active.current=true;setEnabled(true);return true},
            disable:()=>{active.current=false;setEnabled(false)},toggle:()=>{},isEnabled:()=>active.current};}
      `}))
      await page.clock.install()
      await page.goto(site)
      await page.locator(mode === 'play' ? '.play-card' : '.mode-card').nth(mode === 'play' ? 0 : 2).click()
      await page.getByRole('button',{name:language === 'english' ? 'Turn on mic & begin' : '打开麦克风，开始聊天'}).click()
      async function respond(text) {
        await page.evaluate(text=>window.respond(text),text)
        // Wait for React effects, including timers and event persistence, to settle.
        await page.waitForFunction(()=>!['Thinking','想一想','ChooChoo is speaking','ChooChoo 在说话'].includes(document.querySelector('.room-state')?.textContent))
        await page.clock.runFor(40)
      }
      if(mode === 'play') await respond(language === 'english' ? 'boat' : '小船')
      else {
        await page.waitForFunction(()=>window.spoken.at(-1)?.match(/Ready for our story|准备好听故事/),undefined,{timeout:5000}).catch(async error=>{console.error(await page.evaluate(()=>({spoken:window.spoken,body:document.body.innerText})));throw error})
        const readyPrompt = await page.evaluate(()=>window.spoken.at(-1))
        await page.evaluate(()=>window.hideTab())
        await page.getByRole('button',{name:language==='english'?'Resume story':'继续故事',exact:true}).click()
        await page.getByRole('button',{name:language==='english'?'Resume story':'继续故事',exact:true}).waitFor({state:'hidden'})
        await page.clock.runFor(40)
        await page.waitForFunction(q=>window.spoken.at(-1)===q,readyPrompt)
        await respond(language === 'english' ? 'I am ready' : '准备好了')
        await page.waitForFunction(question=>window.spoken.at(-1)===question,question)
        await page.waitForFunction(question=>document.querySelector('.room-copy h1')?.textContent===question,question)
      }
      const originalQuestion=await page.evaluate(()=>window.spoken.at(-1))
      const initialCompletions=await page.evaluate(()=>window.events.filter(event=>event.type==='checkpoint_completed'||event.type==='play_turn').length)
      const initialPieces = await page.locator('.story-puzzle-picture .puzzle-piece').count()
      assert.equal(await page.locator('.story-puzzle-picture .piece-entering').count(), 0, 'restored pieces must not animate again')
      if (mode !== 'play') {
        assert.equal(await page.locator('.story-puzzle-stage').isVisible(), false, 'resuming collected pieces must not replace the agent')
        assert.equal(await page.locator('.story-agent-stage .three-orb').isVisible(), true)
        assert.equal(await page.locator('.story-agent-stage .three-orb').evaluate(el => getComputedStyle(el).opacity), '1')
        assert.equal(await page.locator('.puzzle-tray').isVisible(), false, 'puzzle status is not persistent during conversation')
        await page.locator('.story-agent-stage .three-orb canvas').waitFor()
        await page.locator('.story-agent-stage .three-orb').evaluate(el => { window.originalOrb = el })
      }
      for(let i=0;i<4;i++) {
        await respond(language === 'english' ? "Today's weather is good" : '今天天气很好')
        assert.ok((await page.evaluate(()=>window.spoken.at(-1))).endsWith(originalQuestion), JSON.stringify(await page.evaluate(()=>({spoken:window.spoken.slice(-4),state:document.querySelector('.room-state')?.textContent}))))
      }
      await page.evaluate(()=>{window.verdict='uncertain';window.action='retry'})
      for(const text of ['', 'purple the because yesterday','啊那个蓝七昨天','purple the because yesterday']) {
        await respond(text)
        assert.equal(await page.evaluate(()=>window.spoken.at(-1)),boundaryLines[language].retry)
      }
      await page.evaluate(()=>{window.verdict='error';window.action='error'})
      await respond('unrecognized synthetic speech')
      assert.equal(await page.evaluate(()=>window.spoken.at(-1)),boundaryLines[language].retry)
      await page.evaluate(()=>window.failSpeech())
      await page.waitForFunction(retry=>window.spoken.at(-1)===retry,boundaryLines[language].retry)
      const beforeSilence=await page.evaluate(()=>window.spoken.length)
      await page.clock.fastForward(12100)
      assert.equal(await page.evaluate(()=>window.spoken.length),beforeSilence+(mode==='play'?0:1),'a quiet story repair gets one spoken invitation')
      assert.equal(await page.evaluate(()=>window.events.filter(event=>event.type==='checkpoint_completed'||event.type==='play_turn').length),initialCompletions)
      assert.equal(await page.locator('.completion-screen').count(),0)
      assert.equal(await page.locator('.story-puzzle-picture .puzzle-piece').count(), initialPieces, 'repairs must not place puzzle pieces')
      await respond(language==='english'?'pause':'暂停')
      if (mode === 'play') await respond(language==='english'?'continue':'继续')
      else {
        const resume = page.getByRole('button', {name:language==='english'?'Resume story':'继续故事',exact:true})
        await resume.waitFor()
        assert.equal(await page.getByText('Say “continue” when you’re ready.', {exact:true}).count(), 0)
        const pausedSpeechCount = await page.evaluate(()=>window.spoken.length)
        await respond(language==='english'?'continue':'继续')
        await page.clock.fastForward(60000)
        assert.equal(await page.evaluate(()=>window.spoken.length),pausedSpeechCount,'paused story must neither listen nor auto-advance')
        await resume.click()
        await resume.waitFor({state:'hidden'})
        await page.clock.runFor(40)
        await page.waitForFunction(q=>window.spoken.at(-1)===q,originalQuestion)
        await page.evaluate(()=>window.hideTab())
        await resume.waitFor()
        await page.evaluate(()=>window.micFailure=true)
        await resume.click()
        assert.equal(await resume.isVisible(),true,'failed mic reconnect must leave Resume available')
        assert.equal(await page.evaluate(()=>window.spoken.length),pausedSpeechCount+1,'failed reconnect must not trigger speech or guidance')
        await page.evaluate(()=>window.micFailure=false)
        // Keyboard activation follows the same resume path after tab return.
        await resume.focus()
        await page.keyboard.press('Enter')
        await page.waitForFunction(q=>window.spoken.at(-1)===q,originalQuestion)
        await page.getByRole('button',{name:language==='english'?'Turn microphone off':'关闭麦克风',exact:true}).waitFor()
      }
      assert.equal(await page.evaluate(()=>window.spoken.at(-1)),originalQuestion,'explicit resume must return to the pending question')
      assert.equal(await page.evaluate(()=>window.events.filter(event=>event.type==='checkpoint_completed'||event.type==='play_turn').length),initialCompletions)
      await page.evaluate(()=>{window.verdict='correct';window.action='continue'})
      const answer = mode === 'play' ? (language === 'english' ? 'A flying dragon can help us sail' : '一条会飞的龙帮我们开船') : beat.checkpoint.concepts[0][language === 'english' ? 'en' : 'zh'][0]
      await respond(answer)
      await page.waitForFunction(initial=>window.events.filter(event=>event.type==='checkpoint_completed'||event.type==='play_turn').length>initial,initialCompletions)
      if (mode !== 'play') {
        assert.equal(await page.locator('.story-puzzle-stage').isVisible(), true)
        assert.equal(await page.locator('.story-puzzle-picture .puzzle-piece').count(), initialPieces + 1)
        const entering = page.locator('.story-puzzle-picture .piece-entering').last()
        assert.equal(await entering.evaluate(el => getComputedStyle(el).animationDelay), '0s', 'place the piece immediately after the answer')
        assert.equal(await entering.evaluate(el => getComputedStyle(el).animationName), 'puzzle-grow-into-slot')
        if (mode === 'choice') {
          const firstPiece = page.locator('.story-puzzle-picture .puzzle-piece').first()
          // Playwright's JS clock does not advance CSS animations.
          await firstPiece.evaluate(el => { window.firstPuzzlePiece = el; el.getAnimations().forEach(animation => animation.finish()) })
          await respond('synthetic correct response')
          assert.equal(await page.locator('.story-puzzle-picture .puzzle-piece').count(), 2)
          assert.equal(await firstPiece.evaluate(el => el === window.firstPuzzlePiece), true, 'previous pieces remain mounted')
          assert.equal(await firstPiece.evaluate(el => getComputedStyle(el).transform), 'none', 'previous pieces stay placed')
          if (process.env.ORB_REWARD_SCREENSHOT_DIR && language === 'english') {
            await page.screenshot({path:`${process.env.ORB_REWARD_SCREENSHOT_DIR}/reward-desktop.png`})
            await page.setViewportSize({width:390,height:844})
            await page.screenshot({path:`${process.env.ORB_REWARD_SCREENSHOT_DIR}/reward-phone.png`})
          }
          await page.emulateMedia({ reducedMotion: 'reduce' })
          assert.equal(await entering.evaluate(el => getComputedStyle(el).animationName), 'none')
        }
        await page.clock.runFor(2700)
        assert.equal(await page.locator('.story-puzzle-stage').isVisible(), false, 'checkpoint reward must dismiss automatically')
        assert.equal(await page.locator('.puzzle-tray').isVisible(), false)
        assert.equal(await page.locator('.story-agent-stage .three-orb').evaluate(el => el === window.originalOrb), true, 'reward must not remount the agent')
        assert.equal(await page.locator('.story-agent-stage').evaluate(el => el.classList.contains('showing-reward')), false)
        if (mode === 'choice') {
          if (process.env.ORB_REWARD_SCREENSHOT_DIR && language === 'english') await page.screenshot({path:`${process.env.ORB_REWARD_SCREENSHOT_DIR}/orb-phone.png`})
          await respond('another synthetic correct response')
          assert.equal(await page.locator('.story-puzzle-stage').isVisible(), true, 'each new checkpoint gets a fresh reward')
          await page.evaluate(()=>window.hideTab())
          assert.equal(await page.locator('.story-puzzle-stage').isVisible(), false, 'pausing immediately dismisses the reward')
          await page.getByRole('button',{name:language==='english'?'Resume story':'继续故事',exact:true}).click()
          await page.clock.runFor(40)
          assert.equal(await page.locator('.story-puzzle-stage').isVisible(), false, 'resuming never replays a dismissed reward')
        }
      }
      if(mode==='open') {
        await page.waitForFunction(()=>window.spoken.at(-1)?.match(/Who was your favorite|你最喜欢故事里的谁/))
        const finalQuestion = await page.evaluate(()=>window.spoken.at(-1))
        await page.evaluate(()=>window.hideTab())
        await page.getByRole('button',{name:language==='english'?'Resume story':'继续故事',exact:true}).click()
        await page.getByRole('button',{name:language==='english'?'Resume story':'继续故事',exact:true}).waitFor({state:'hidden'})
        await page.clock.runFor(40)
        await page.waitForFunction(q=>window.spoken.at(-1)===q,finalQuestion)
        assert.equal(await page.locator('.completion-screen').count(),0,'resuming the favorite-character question must not finish or restart the story')
        await page.evaluate(()=>window.action='retry')
        await respond('purple the because yesterday')
        assert.equal(await page.evaluate(()=>window.spoken.at(-1)),boundaryLines[language].retry)
        await page.evaluate(()=>window.action='redirect')
        await respond(language==='english'?"Today's weather is good":'今天天气很好')
        assert.match(await page.evaluate(()=>window.spoken.at(-1)),/Who was your favorite in our story|你最喜欢故事里的谁/)
        await page.clock.fastForward(60000)
        assert.equal(await page.locator('.completion-screen').count(),0)
        await page.evaluate(()=>window.action='continue')
        await respond(language==='english'?'Grandma Panda':'熊猫奶奶')
        await page.locator('.completion-screen').waitFor()
        assert.equal(await page.locator('.puzzle-finale').count(),1)
        await page.locator('.puzzle-finale.assembled').waitFor()
        assert.equal(await page.locator('.puzzle-finale .piece-entering').count(), 0, 'the ending must not replay piece assembly')
        assert.equal(await page.getByRole('button',{name:language==='english'?'Play again':'再玩一次'}).count(),1)
        assert.equal(await page.evaluate(()=>window.events.filter(event=>event.type==='puzzle_assembled').length),1)
        assert.equal(await page.evaluate(({storyID,language})=>JSON.parse(localStorage.getItem('choochoo:collections:')).filter(item=>item.storyID===storyID && item.language===language).length,{storyID:story.id,language}),1,'fully completed finale permanently collects exactly one picture')
      }
      if(mode==='play') {
        const requests=await page.evaluate(()=>window.requests.filter(request=>request.kind==='imaginativePlay'))
        assert.ok(requests.every(request=>request.previousLine===originalQuestion),'repairs must not replace play context')
        assert.equal(await page.evaluate(()=>window.events.filter(event=>event.type==='play_turn').length),1)
      }
      assert.deepEqual(errors,[])
      console.log(`PASS ${language} ${mode}: repeated redirects, unclear speech, service errors, spoken silence recovery, meaningful recovery${mode==='open'?', wrapup guard':''}`)
      await page.close()
    }
  }
} finally {await browser.close()}
