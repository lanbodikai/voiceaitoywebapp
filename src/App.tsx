import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { readStored, writeStored } from './storage'
import { detectVoiceCommand, type VoiceCommand } from './voiceCommands'
import { useHandsFree } from './useHandsFree'
import { readiness, destinationFromSpeech, storyResumeTarget } from './conversationIntents'
import handsFreeLines from './data/handsfree-lines.json'
import boundaryLines from './data/conversation-boundaries.json'
import { readingPath } from './storyPath'
import './App.css'
import type { OrbState } from './ConversationOrb'
import { findBeat, languageText } from './content'
import { evaluateLocal } from './evaluator'
import { hasPendingProgress, createRecoveryCode, restoreProgress, loadProgress, flushEventQueue, evaluateRemotely, generateLine, recordConsent, safetyCheck, startResearchSession, uploadEvents } from './backend'
import { cacheProgress, collectPuzzle, savedProgress, type ProgressSnapshot } from './progress'
import { Dashboard, PuzzleArtwork } from './Dashboard'
import { cueForLanguage, playEarcon, playEffect, setSpeechRate, speak, stopVoice, storyFeedbackCue } from './audio'
import { restoreParticipant, signInAnonymously } from './supabase'
import { playDestinations, playIntro, playText, type PlayDestination } from './playContent'
import { activeSessionID, clearLocalResearchData, completeActiveSession, downloadJSON, nextEventSequence, type CompletionData, type SessionConfig, type VisitScope } from './session'
import { learnerProfile, nameFromSpeech, rememberLearnerName } from './learnerProfile'
import { storyFollowup } from './storyFollowup'
import { PuzzleFinale, PuzzleSeams, PuzzleTray, StoryPuzzlePicture, type PuzzleFinaleData } from './StoryPuzzle'
import { earnedPuzzlePieceCount, markPuzzleLayoutCompleted, puzzleLayout, savedPuzzleLayout, selectPuzzleLayout } from './puzzle'
import type { Checkpoint, LessonLanguage, Reward, SessionEvent, Story, VocabularyItem } from './types'

type AppScreen = 'loading' | 'consent' | 'home' | 'story' | 'play' | 'complete'
type ConversationState = 'join' | 'speaking' | 'listening' | 'thinking' | 'ready' | 'paused'
type StoryPhase = 'lobby' | 'name' | 'ready' | 'story' | 'recast' | 'wrapup' | 'audioProblem' | 'unsafe'

const LazyConversationOrb = lazy(() => import('./ConversationOrb').then((module) => ({ default: module.ConversationOrb })))

function ConversationOrb({ state }: { state: OrbState }) {
  return <Suspense fallback={<div className="three-orb"><div className="three-orb-fallback" /></div>}><LazyConversationOrb state={state} /></Suspense>
}

const defaultConfig: SessionConfig = {
  language: 'chinese', visualCondition: 'voice', sessionLabel: '', englishSubtitles: false, speechRate: 0.85,
}

function App() {
  const [screen, setScreen] = useState<AppScreen>('loading')
  const [config, setConfig] = useState<SessionConfig>(() => {
    const saved = readStored<Partial<SessionConfig> | null>('choochoo:preferences', null)
    const storedRate = Number(saved?.speechRate)
    return { ...defaultConfig, language: saved?.language === 'english' ? 'english' : 'chinese', visualCondition: saved?.visualCondition === 'pictures' ? 'pictures' : 'voice', englishSubtitles: saved?.englishSubtitles === true, speechRate: Number.isFinite(storedRate) ? Math.min(1.1, Math.max(0.7, storedRate)) : defaultConfig.speechRate }
  })
  useEffect(() => { writeStored('choochoo:preferences', config); setSpeechRate(config.speechRate); document.documentElement.lang = config.language === 'chinese' ? 'zh-CN' : 'en' }, [config])
  const [activeStory, setActiveStory] = useState<Story | null>(null)
  const [replayRequested, setReplayRequested] = useState(false)
  const [completion, setCompletion] = useState<CompletionData | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (!await restoreParticipant()) { if (!cancelled) setScreen('consent'); return }
        // Local, guest-scoped progress remains usable while cloud sync is offline.
        await loadProgress().catch(() => undefined)
        if (!cancelled) setScreen('home')
      } catch { if (!cancelled) setScreen('consent') }
    })()
    return () => { cancelled = true }
  }, [])

  async function consent() {
    await signInAnonymously()
    await recordConsent({ shareIdentity: false, consentVersion: 'web-handsfree-1.2' })
    await loadProgress()
    setScreen('home')
  }
  useEffect(() => {
    const retry = () => { void flushEventQueue().catch(() => undefined) }
    window.addEventListener('online', retry)
    const timer = window.setInterval(retry, 30_000)
    return () => { window.removeEventListener('online', retry); window.clearInterval(timer) }
  }, [])

  function finish(data: CompletionData) { setCompletion(data); setScreen('complete') }
  function replay() {
    if (completion?.mode === 'story' && completion.story) { setActiveStory(completion.story); setReplayRequested(true); setScreen('story') }
    else if (completion?.mode === 'play') setScreen('play')
    else setScreen('home')
  }

  if (screen === 'loading') return <main className="consent-screen"><section className="consent-card"><span className="wordmark">CHOOCHOO</span><p>{languageText('正在找回你的故事…', 'Getting your stories ready…', config.language)}</p></section></main>
  if (screen === 'consent') return <ConsentScreen language={config.language} onLanguage={(language) => setConfig({ ...config, language })} onContinue={consent} />
  if (screen === 'home') return <HomeScreen config={config} onConfig={setConfig} onStory={(story, replay = false) => { if (replay) completeActiveSession({ mode: 'story', storyID: story.id, language: config.language }); setActiveStory(story); setReplayRequested(replay); setScreen('story') }} onPlay={() => setScreen('play')} />
  if (screen === 'story' && activeStory) return <StorySession story={activeStory} config={config} replayRequested={replayRequested} onClose={() => setScreen('home')} onComplete={finish} />
  if (screen === 'play') return <ImaginativePlaySession config={config} onClose={() => setScreen('home')} onComplete={finish} />
  if (screen === 'complete' && completion) return <CompletionScreen data={completion} onHome={() => setScreen('home')} onReplay={replay} />
  return null
}

function ConsentScreen({ language, onLanguage, onContinue }: { language: LessonLanguage; onLanguage: (language: LessonLanguage) => void; onContinue: () => Promise<void> }) {
  const [accepted, setAccepted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const t = (zh: string, en: string) => languageText(zh, en, language)
  async function proceed() { if (!accepted || saving) return; setSaving(true); setError(false); try { await onContinue() } catch { setError(true) } finally { setSaving(false) } }
  return <main className="consent-screen">
    <section className="consent-card">
      <span className="wordmark">CHOOCHOO</span>
      <Segmented value={language} options={ [['chinese', '中文'], ['english', 'English']] } onChange={(value) => onLanguage(value as LessonLanguage)} />
      <h1>{t('故事，从这里开始。', 'A little story. A big adventure.')}</h1>
      <div className="consent-copy">
        <p>{t('和 ChooChoo 听故事、聊想法。开始前，请由成人确认。', 'Listen, talk, and imagine with ChooChoo. A grown-up needs to confirm before you begin.')}</p>
        <p>{t('打开麦克风后，应用在本机检测说话声，并将语音分段发送给 OpenAI 识别。AI 的回复文字通过微软 Edge 语音服务朗读。附近其他人的声音也可能被识别。随时可关闭麦克风；除下方说明的本机称呼外，本应用不保存录音或对话文字。', 'While the microphone is on, speech is detected on this device and streamed in small chunks to OpenAI. AI reply text is sent to Microsoft’s Edge speech service to read aloud. Nearby voices may also be picked up. You can turn the mic off at any time. Except for the local nickname described below, this app does not save recordings or conversation transcripts.')}</p>
        <p>{t('请在成人陪同下使用。ChooChoo 是 AI，可能听错或说错。', 'Stay with your child while using ChooChoo. It is AI and can misunderstand or make mistakes.')}</p>
        <p>{t('ChooChoo 会问一次你喜欢的称呼，只保存在这个浏览器中，不会随进度上传。我们用随机访客编号保存故事进度、答题次数和需要练习的词语。', 'ChooChoo asks once what you like to be called. That nickname stays only in this browser and is not uploaded with progress. A random guest ID saves story progress, answer attempts, and words to practice.')}</p>
      </div>
      <label className="check-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>{t('我已阅读并同意，并会陪同孩子使用。', 'I have read and agree, and will stay with my child.')}</span></label>
      {error && <p className="inline-error" role="alert">{t('暂时无法连接。请检查网络，然后重试。', 'We could not connect. Check your connection and try again.')}</p>}
      <button className="primary-action" disabled={!accepted || saving} onClick={proceed}>{saving ? t('正在连接…', 'Connecting…') : error ? t('重试', 'Try again') : t('同意并继续', 'Agree and continue')}</button>
    </section>
  </main>
}

function HomeScreen({ config, onConfig, onStory, onPlay }: { config: SessionConfig; onConfig: (config: SessionConfig) => void; onStory: (story: Story, replay?: boolean) => void; onPlay: () => void }) {
  const [settings, setSettings] = useState(false)
  const [artwork, setArtwork] = useState<Story | null>(null)
  const t = (zh: string, en: string) => languageText(zh, en, config.language)
  return <main className="home-screen dashboard-home">
    <Dashboard config={config} onLanguage={language => onConfig({ ...config, language })} onSettings={() => setSettings(true)} onStory={onStory} onPlay={onPlay} onInspect={setArtwork} />
    {artwork && <Modal title={languageText(artwork.title, artwork.englishTitle, config.language)} closeLabel={t('关闭', 'Close')} onClose={() => setArtwork(null)}>
      <div className="collection-detail"><div className="collection-cover"><PuzzleArtwork key={artwork.id} story={artwork} language={config.language} /><PuzzleSeams pieces={puzzleLayout(savedPuzzleLayout(artwork.id, config.language), artwork.typicalPathLength)} /></div><p>{languageText(artwork.puzzle.celebrationText, artwork.puzzle.englishCelebrationText, config.language)}</p><button className="primary-action" onClick={() => onStory(artwork, true)}>{t('再听一次', 'Replay story')}</button></div>
    </Modal>}
    {settings && <Modal title={t('设置', 'Settings')} closeLabel={t('完成', 'Done')} onClose={() => setSettings(false)}><div className="setup-panel">
      <fieldset><legend>{t('对话语言', 'Conversation language')}</legend><Segmented value={config.language} options={ [['chinese', '中文'], ['english', 'English']] } onChange={(value) => onConfig({ ...config, language: value as LessonLanguage })} /></fieldset>
      <fieldset><legend>{t('故事画面', 'Story display')}</legend><Segmented value={config.visualCondition} options={ [['voice', t('语音圆球', 'Voice orb')], ['pictures', t('故事场景', 'Story scenes')]] } onChange={(value) => onConfig({ ...config, visualCondition: value as SessionConfig['visualCondition'] })} /></fieldset>
      <fieldset className="speed-setting"><legend>{t('说话速度', 'Speaking speed')}</legend><label htmlFor="speech-rate"><span>{t('慢', 'Slower')}</span><strong>{config.speechRate.toFixed(2)}×</strong><span>{t('快', 'Faster')}</span></label><input id="speech-rate" type="range" min="0.7" max="1.1" step="0.05" value={config.speechRate} onChange={(event) => onConfig({ ...config, speechRate: Number(event.target.value) })} /><p className="setting-note">{t('默认速度已调慢，更适合孩子听故事。', 'The default is gently slowed for young listeners.')}</p></fieldset>
      {config.language === 'chinese' && <label className="switch-row"><span>英文字幕</span><input type="checkbox" checked={config.englishSubtitles} onChange={(event) => onConfig({ ...config, englishSubtitles: event.target.checked })} /></label>}
      <p className="setting-note">{t('下次打开时会记住你的设置。', 'Your preferences will be remembered on this device.')}</p>
      <RecoverySettings language={config.language} onRestored={() => setSettings(false)} />
      <ProgressSaveStatus language={config.language} />
    </div></Modal>}
  </main>
}

function ProgressSaveStatus({language}: {language: LessonLanguage}) {
  const [pending, setPending] = useState(hasPendingProgress)
  useEffect(() => { const refresh = () => setPending(hasPendingProgress()); window.addEventListener('choochoo-progress', refresh); return () => window.removeEventListener('choochoo-progress', refresh) }, [])
  return <p className="setting-note" role="status">{languageText(pending ? '进度暂存于此设备，联网后会重试同步。' : '进度已同步。', pending ? 'Progress is saved on this device. Cloud sync will retry when connected.' : 'Progress is synced.', language)}</p>
}

function RecoverySettings({language, onRestored}: {language: LessonLanguage; onRestored: () => void}) {
  const t = (zh: string, en: string) => languageText(zh, en, language)
  const [code, setCode] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function recover(restore: boolean) {
    setBusy(true); setError('')
    try {
      if (restore) { await restoreProgress(input.trim()); onRestored() }
      else setCode((await createRecoveryCode()).code.match(/.{1,5}/g)!.join('-'))
    } catch { setError(t('未能完成。请检查连接或恢复码后重试。', 'Could not finish. Check your connection or recovery code and try again.')) }
    finally { setBusy(false) }
  }
  return <fieldset className="recovery-settings"><legend>{t('进度与恢复', 'Progress & recovery')}</legend>
    <p className="setting-note">{t('进度自动保存。换设备或清除浏览器数据前，请让家长保存恢复码。', 'Progress saves automatically. Before changing devices or clearing browser data, ask a grown-up to keep a recovery code.')}</p>
    <button className="secondary-action" disabled={busy} onClick={() => void recover(false)}>{t('生成恢复码', 'Create recovery code')}</button>
    {code && <><output className="recovery-code">{code}</output><p className="setting-note">{t('请妥善保管。持有码的人可访问进度；新码会替换旧码。', 'Keep it private: anyone with this code can access progress. A new code replaces the old one.')}</p></>}
    <label><span>{t('已有恢复码', 'Have a recovery code?')}</span><input autoComplete="off" spellCheck={false} value={input} maxLength={60} onChange={(e) => setInput(e.target.value)} /></label>
    <button className="secondary-action" disabled={busy || !/^[a-f0-9]{40}$/i.test(input.trim().replace(/-/g,''))} onClick={() => void recover(true)}>{t('恢复进度', 'Restore progress')}</button>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </fieldset>
}

function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <div className="segmented">{options.map(([key, label]) => <button key={key} aria-pressed={value === key} className={value === key ? 'selected' : ''} onClick={() => onChange(key)}>{label}</button>)}</div>
}

function Modal({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (opener?.isConnected) opener.focus() }
  }, [])
  return <dialog className="app-dialog" ref={dialog} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose() }}><header><h2>{title}</h2><button className="secondary-action" onClick={onClose}>{closeLabel}</button></header>{children}</dialog>
}

function StorySession({ story, config, replayRequested = false, onClose, onComplete }: { story: Story; config: SessionConfig; replayRequested?: boolean; onClose: () => void; onComplete: (data: CompletionData) => void }) {
  const visitScope: VisitScope = { mode: 'story', storyID: story.id, language: config.language }
  const [previous] = useState(() => savedProgress(story.id, config.language))
  const resume = !replayRequested && previous && !previous.completed ? previous : undefined
  const [puzzleLayoutID] = useState(() => selectPuzzleLayout(story.id, config.language, resume ? 'resume' : replayRequested || previous?.completed ? 'replay' : 'new'))
  const [beatID, setBeatID] = useState(resume?.beatID ?? story.startBeatId)
  const [phase, setPhase] = useState<StoryPhase>('lobby')
  const [state, setState] = useState<ConversationState>('join')
  const [headline, setHeadline] = useState(languageText(resume ? '欢迎回来，继续上次的故事吧。' : previous?.completed ? '欢迎回来。准备好再听一次了吗？' : '准备好和 ChooChoo 见面了吗？', resume ? 'Welcome back. Let’s continue your story.' : previous?.completed ? 'Welcome back. Ready to listen again?' : 'Ready to meet ChooChoo?', config.language))
  const [connectionError, setConnectionError] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [hintLevel, setHintLevel] = useState(resume?.hintLevel ?? 0)
  const [attemptCount, setAttemptCount] = useState(resume?.attemptCount ?? 0)
  const [unusableCount, setUnusableCount] = useState(0)
  const [questionAsked, setQuestionAsked] = useState(false)
  const [rewards] = useState<Reward[]>([])
  const [struggledVocabulary, setStruggledVocabulary] = useState<string[]>(resume?.vocabularyIDs ?? [])
  const [beatPath, setBeatPath] = useState<string[]>(resume?.beatPath ?? [story.startBeatId])
  const completedRef = useRef<string[]>(resume?.completedCheckpoints ?? [])
  const [earnedPuzzlePieces, setEarnedPuzzlePieces] = useState(() => earnedPuzzlePieceCount(completedRef.current, story.typicalPathLength))
  const finishedRef = useRef(false)
  const startedRef = useRef(false)
  const storyComplete = useRef(false)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [sessionID, setSessionID] = useState<string>()
  const runID = useRef(0)
  const mounted = useRef(true)
  const autoplayNext = useRef(false)
  const rewardsRef = useRef(rewards)
  const struggledRef = useRef(struggledVocabulary)
  const eventsRef = useRef(events)
  const beatPathRef = useRef(beatPath)
  const lastSpokenKind = useRef<'scene' | 'question'>('scene')
  const paused = useRef(false)
  const resuming = useRef(false)
  const resumeAt = useRef<'scene' | 'question'>('scene')
  const reminderUsed = useRef(false)
  const pendingRepair = useRef(false)
  const beat = findBeat(story, beatID)
  const checkpoint = beat.checkpoint
  const narration = languageText(beat.narration, beat.englishNarration, config.language)
  const question = languageText(checkpoint.question, checkpoint.englishQuestion, config.language)
  const t = (zh: string, en: string) => languageText(zh, en, config.language)
  const addEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const next = [...eventsRef.current, { sequence: nextEventSequence(visitScope), type, occurredAt: new Date().toISOString(), payload }]
    eventsRef.current = next; setEvents(next)
  }

  useEffect(() => {
    mounted.current = true
    addEvent('session_started', { storyID: story.id, mode: 'story', condition: { language: config.language, visual: config.visualCondition } })
    const puzzleImage = new Image()
    puzzleImage.src = `/illustrations/${encodeURIComponent(story.puzzle.imageAsset)}.png`
    return () => { mounted.current = false; runID.current += 1; stopVoice() }
    // Session identity is intentionally fixed for one mounted story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id])
  function snapshot(completed = storyComplete.current): ProgressSnapshot {
    return {beatID, phase: phase === 'recast' ? 'recast' : 'story', attemptCount, hintLevel, completed, beatPath: beatPathRef.current, completedCheckpoints: completedRef.current, rewardIDs: rewardsRef.current.map((r) => r.id), vocabularyIDs: struggledRef.current}
  }
  useEffect(() => {
    if (!sessionID || !startedRef.current || finishedRef.current) return
    const progress = snapshot()
    cacheProgress(story.id, config.language, progress)
    void uploadEvents(sessionID, events, progress, true)
    const timer = window.setTimeout(() => { void flushEventQueue().catch(() => undefined) }, 1200)
    return () => window.clearTimeout(timer)
    // All state captured in a saved checkpoint is included below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, sessionID, beatID, phase, attemptCount, hintLevel, rewards, struggledVocabulary])
  useEffect(() => { addEvent('state_transition', { state, phase, beatID }) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, phase, beatID])
  useEffect(() => { if (autoplayNext.current) { autoplayNext.current = false; void playScene() } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatID])
  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input,textarea')) return
      if (paused.current || state === 'paused') return
      if (event.key.toLowerCase() === 'r') void repeatQuestion()
      if (event.key.toLowerCase() === 'h') void giveHint()
      if (event.key === '0') void mercyAdvance()
      if (/^[123]$/.test(event.key)) void forceChoice(Number(event.key) - 1)
    }
    window.addEventListener('keydown', keyHandler)
    return () => window.removeEventListener('keydown', keyHandler)
  })
  useEffect(() => {
    if (state !== 'ready' || !recorder.enabled || paused.current || pendingRepair.current || !['name', 'ready', 'story', 'recast', 'wrapup'].includes(phase)) return
    const timer = window.setTimeout(async () => {
      if (reminderUsed.current) {
        if (phase === 'name') { rememberLearnerName(); await askReady(); return }
        if (phase === 'ready') { await playScene(!startedRef.current); return }
        if (phase === 'wrapup') {
          if (await say(t('谢谢你和我一起听故事，下次再见！', 'I loved sharing this story with you. See you next time!'))) finishStory('completed')
          return
        }
        await mercyAdvance(true); return
      }
      reminderUsed.current = true
      const followup = phase === 'name' ? t('晚点告诉我也可以，我们先一起听故事吧。', 'You can tell me later. We can enjoy a story together.')
        : phase === 'ready' ? t('故事里的朋友都到啦，我们一起去看看吧。', 'Our story friends are here. Let’s see what they’re doing.')
        : phase === 'wrapup' ? t('我很喜欢和你一起听这个故事。你也可以说说喜欢的那一段。', 'I loved sharing this adventure. You can tell me about a favorite moment, too.')
        : storyFollowup(checkpoint.id,config.language)
      if (await say(followup)) setState('ready')
    }, 18_000)
    return () => window.clearTimeout(timer)
  })

  const interrupt = () => { runID.current += 1; stopVoice() }
  const rememberPausePoint = () => {
    paused.current = true
    resumeAt.current = storyResumeTarget(questionAsked,lastSpokenKind.current)
  }
  function pauseStory() {
    rememberPausePoint()
    recorder.disable(false)
    interrupt()
    setState('paused')
  }

  async function resumeStory() {
    if (resuming.current || ['unsafe', 'audioProblem'].includes(phase)) return
    resuming.current = true
    try {
      if (!sessionID) { paused.current = false; await beginWarmup(); return }
      if (!await recorder.enable() || !mounted.current || !recorder.isEnabled()) return
      paused.current = false
      setConnectionError(''); reminderUsed.current = false
      if (phase === 'name') {
        if (await say(t('我可以怎么称呼你呢？', 'What would you like me to call you?'))) setState('ready')
      } else if (phase === 'ready' || phase === 'lobby') await askReady()
      else if (phase === 'wrapup') {
        const line = handsFreeLines.storyDone
        if (await say(t(line.zh, line.en), line.en, cueForLanguage(line.cue, config.language))) setState('ready')
      } else if (storyResumeTarget(questionAsked, resumeAt.current) === 'question') await repeatQuestion()
      else await playScene(false)
    } finally { resuming.current = false }
  }
  const displaySubtitle = (english: string) => config.language === 'chinese' && config.englishSubtitles ? english : ''

  async function say(text: string, english = '', cueID?: string) {
    if (!mounted.current) return false
    const currentRun = ++runID.current
    setState('speaking'); setHeadline(text); setSubtitle(displaySubtitle(english))
    const played=await speak(text, config.language, cueID)
    if(!played && currentRun===runID.current) {setConnectionError(t('语音播放失败，请重试。','Voice playback failed. Please try again.'));pauseStory();return false}
    return currentRun === runID.current
  }

  async function beginWarmup() {
    setConnectionError(''); setState('thinking')
    if (!await recorder.enable()) { setState('join'); return }
    try {
      const clientSessionID = activeSessionID(visitScope)
      const result = await startResearchSession({ sessionID: clientSessionID, mode: 'story', storyID: story.id, language: config.language, visualCondition: config.visualCondition, label: config.sessionLabel || undefined })
      if (!mounted.current || !recorder.isEnabled()) { setState('join'); return }
      setSessionID(result.sessionID)
    } catch { recorder.disable(false); setConnectionError(t('无法连接语音服务。请检查网络，然后重试。', 'Could not connect. Check your connection, then try again.')); setState('join'); return }
    const profile = learnerProfile()
    if (profile.nameAsked) {
      const welcome = profile.name ? t(`${profile.name}，欢迎回来！我们接着聊故事吧。`, `Welcome back, ${profile.name}! Let’s continue our story.`) : t('欢迎回来！我们接着聊故事吧。', 'Welcome back! Let’s continue our story.')
      if (!await say(welcome, '', profile.name ? undefined : cueForLanguage('welcome_returning', config.language))) return
      await askReady(); return
    }
    if (!await say(t('嗨！我是 ChooChoo，很高兴见到你。', 'Hi! I’m ChooChoo. I’m happy to meet you!'), '', cueForLanguage('welcome_greeting', config.language))) return
    setPhase('name')
    if (!await say(t('我可以怎么称呼你呢？', 'What would you like me to call you?'))) return
    setState('ready')
  }

  async function askReady() {
    setPhase('ready'); reminderUsed.current = false; pendingRepair.current = false
    const line = handsFreeLines.ready
    if (await say(t(line.zh,line.en),line.en,cueForLanguage(line.cue,config.language))) setState('ready')
  }

  async function smallTalk(text: string, current: () => boolean, inviteStory = true) {
    let line = boundaryLines[config.language].retry
    let action = 'retry'
    try { const reply = await generateLine({language:config.language,kind:'openReply',previousLine:headline.slice(0,180),currentQuestion:phase === 'ready' ? t(handsFreeLines.ready.zh,handsFreeLines.ready.en) : question,learnerSpeech:text,storyID:story.id,storyTitle:languageText(story.title,story.englishTitle,config.language),storyContext:`${narration}\n${question}`}); line=reply.line; action=reply.action } catch { /* Keep the pending turn on network failure. */ }
    if (!current()) return
    pendingRepair.current = action !== 'continue'
    if (!current() || !await say(line)) return
    if (action !== 'continue') { setState('ready'); return }
    if (inviteStory) await askReady()
    else setState('ready')
  }

  async function playScene(reset = true) {
    reminderUsed.current = false; pendingRepair.current = false
    const keepRecast = !reset && (phase === 'recast' || (!startedRef.current && resume?.phase === 'recast'))
    startedRef.current = true
    setPhase(keepRecast ? 'recast' : 'story'); if (reset) { setHintLevel(0); setAttemptCount(0) }; setUnusableCount(0); setQuestionAsked(false)
    beat.soundEffects.filter((item) => item.timing === 'beforeNarration').forEach((item) => playEffect(item.sfxId))
    lastSpokenKind.current = 'scene'
    if (!await say(narration, beat.englishNarration, cueForLanguage(beat.audioCue, config.language))) return
    beat.soundEffects.filter((item) => item.timing === 'afterNarration').forEach((item) => playEffect(item.sfxId))
    lastSpokenKind.current = 'question'
    setQuestionAsked(true)
    if (!await say(question, checkpoint.englishQuestion, cueForLanguage(checkpoint.audioCue, config.language))) return
    setQuestionAsked(true)
    setState('ready')
  }

  async function repeatQuestion() {
    if (phase !== 'story' && phase !== 'recast') return
    if (await say(question, checkpoint.englishQuestion, cueForLanguage(checkpoint.audioCue, config.language))) { setQuestionAsked(true); setState('ready') }
  }

  function markStruggled() {
    const next = [...new Set([...struggledRef.current, ...checkpoint.vocabulary.map((item) => item.id)])]
    struggledRef.current = next; setStruggledVocabulary(next)
  }

  async function giveHint() {
    if (phase !== 'story' && phase !== 'recast') return
    if (hintLevel >= checkpoint.hints.length) { await mercyAdvance(); return }
    markStruggled()
    const level = hintLevel + 1
    const hint = checkpoint.hints[level - 1]
    const hintText = config.language === 'english' ? englishHintFor(checkpoint, level) : hint.text
    setHintLevel(level); addEvent('hint_played', { beatID, level })
    if (await say(hintText, '', storyFeedbackCue(story.id, checkpoint.id, 'hint', config.language, level))) setState('ready')
  }

  async function advance(matchedConcepts: string[] = [], forcedBranchIndex?: number) {
    pendingRepair.current = false
    const branch = forcedBranchIndex !== undefined ? checkpoint.branches[forcedBranchIndex]
      : checkpoint.branches.find((item) => matchedConcepts.includes(item.conceptId))
        ?? checkpoint.branches.find((item) => item.id === checkpoint.defaultBranchId)
    if (branch) {
      addEvent('branch_taken', { beatID, branchID: branch.id })
      const transition = config.language === 'chinese' ? branch.transitionLine.replace(/选一个/gu, '告诉我你的想法') : 'I like that idea! Let’s see what happens next.'
      if (!await say(transition)) return
      checkpoint.successSfx.forEach((item) => playEffect(item.sfxId))
    }
    const next = branch?.nextBeatId ?? beat.nextBeatId
    if (!next) {
      reminderUsed.current = false
      storyComplete.current = true; setPhase('wrapup')
      const line=handsFreeLines.storyDone
      if (await say(t(line.zh,line.en),line.en,cueForLanguage(line.cue,config.language))) setState('ready')
      return
    }
    addEvent('beat_advanced', { from: beat.id, to: next })
    const nextPath = [...beatPathRef.current, next]
    beatPathRef.current = nextPath; setBeatPath(nextPath); setBeatID(next); autoplayNext.current = true
  }

  async function celebrate(matchedConcepts: string[] = [], forcedBranchIndex?: number) {
    completeCheckpoint(false)
    setPhase('story'); playEarcon('success')
    const success = config.language === 'chinese' ? checkpoint.successLine : 'You did it!'
    if (!await say(success, '', storyFeedbackCue(story.id, checkpoint.id, 'success', config.language))) return
    await advance(matchedConcepts, forcedBranchIndex)
  }

  async function completeKindly(line: string, matchedConcepts: string[] = [], celebrateMeaning = false) {
    completeCheckpoint(!celebrateMeaning)
    setUnusableCount(0); setPhase('story')
    if (celebrateMeaning) playEarcon('success')
    if (!await say(line)) return
    await advance(matchedConcepts)
  }

  function completeCheckpoint(assisted: boolean) {
    if (completedRef.current.includes(checkpoint.id)) return
    completedRef.current = [...completedRef.current, checkpoint.id]
    setEarnedPuzzlePieces(earnedPuzzlePieceCount(completedRef.current, story.typicalPathLength))
    addEvent('checkpoint_completed', assisted ? { beatID, assisted: true } : { beatID })
    addEvent('puzzle_piece_earned', { beatID })
  }

  async function mercyAdvance(noResponse = false) {
    markStruggled(); addEvent('mercy_fired', { beatID, mercy: true })
    const branch = checkpoint.branches.find((item) => item.id === checkpoint.defaultBranchId)
    const chineseModel = branch?.recast ?? checkpoint.recast
    const englishModel = checkpoint.concepts.map((concept) => concept.en[0]).filter(Boolean).join(' and ')
    const line = noResponse
      ? t(`没关系，我们继续听。刚才可以这样说：${chineseModel}`, `That’s okay—we can keep going. One answer was: ${englishModel}.`)
      : t(`谢谢你和我一起想！可以这样说：${chineseModel} 我们继续看看发生什么。`, `Thanks for thinking with me! One answer is: ${englishModel}. Let’s see what happens next.`)
    await completeKindly(line, branch ? [branch.conceptId] : [])
  }

  async function forceChoice(index: number) {
    const branch = checkpoint.branches[index]
    if (!branch) return
    addEvent('researcher_override', { action: 'force_choice', option: index + 1 })
    await celebrate([branch.conceptId], index)
  }

  async function handleStruggle() {
    markStruggled()
    const attempts = attemptCount + 1
    setAttemptCount(attempts)
    // Match the iOS flow: one useful hint, then model an answer and continue.
    // A child is never trapped in a loop of the same question.
    if (attempts >= 2) { await mercyAdvance(); return }
    await giveHint()
  }

  async function handleTangent(text: string, current: () => boolean) {
    pendingRepair.current = true
    addEvent('tangent_fired', { beatID })
    const fixed = boundaryLines[config.language]
    let line = `${fixed.acknowledgement} ${fixed.bridge} ${question}`
    try {
      const result = await generateLine({ role: 'ChooChoo', language: config.language, visualCondition: config.visualCondition, kind: 'tangent', checkpointID: checkpoint.id, currentQuestion: question, previousLine: question, learnerSpeech: text, storyID: story.id, storyTitle: languageText(story.title,story.englishTitle,config.language), storyContext: `${narration}\n${question}` })
      line = result.line
    } catch { /* Scripted fallback guarantees a way forward. */ }
    if (!current()) return
    if (!await say(line)) return
    setState('ready')
  }

  async function checkSafety(text: string, current: () => boolean) {
    if (!sessionID) { setState('paused'); setConnectionError(t('连接尚未准备好，请返回首页重试。', 'The connection is not ready. Return home and try again.')); return false }
    try {
      const result = await safetyCheck(sessionID, text)
      if (!current()) return false
      if (result.safe) return true
      addEvent('safety_pause', { beatID, categories: result.categories })
      recorder.disable(false)
      setPhase('unsafe'); setState('paused'); setHeadline(t('我们先停一下，请叫身边的大人来。', 'Let’s pause and ask the grown-up nearby for help.')); setSubtitle('')
      return false
    } catch {
      if (!current()) return false
      await handleUnusable()
      return false
    }
  }

  async function handleSpeech(text: string, current: () => boolean) {
    if (paused.current) { setState('paused'); return }
    if (!text.trim()) { if (paused.current) { setState('paused'); return }; await handleUnusable(); return }
    if (!await checkSafety(text, current)) return
    if (text.trim()) setUnusableCount(0)
    const command = detectVoiceCommand(text)
    if (phase === 'wrapup') {
      if (command === 'end') { finishStory('voice_end'); return }
      if (command === 'pause') { await handleCommand(command); return }
      if (command === 'repeat' || command === 'question' || command === 'continue') {
        const line=handsFreeLines.storyDone
        if (await say(t(line.zh,line.en),line.en,cueForLanguage(line.cue,config.language))) setState('ready')
        return
      }
      await finishAfterFavorite(text,current)
      return
    }
    if (['name','ready'].includes(phase)) {
      if (command === 'pause' || command === 'end') { await handleCommand(command); return }
      if (phase === 'name') {
        paused.current = false
        if (command === 'question' || command === 'repeat') {
          if (await say(t('我可以怎么称呼你呢？', 'What would you like me to call you?'))) setState('ready')
          return
        }
        const name = nameFromSpeech(text)
        rememberLearnerName(name)
        const welcome = name ? t(`很高兴认识你，${name}！`, `It’s lovely to meet you, ${name}!`) : t('很高兴认识你！', 'It’s lovely to meet you!')
        if (!await say(welcome)) return
        await askReady(); return
      }
      if (readiness(text) === 'yes' && phase === 'ready') { paused.current = false; await playScene(!resume && !startedRef.current); return }
      if (readiness(text) === 'no') {
        setPhase('ready'); const line = handsFreeLines.notYet
        if (await say(t(line.zh,line.en),line.en,cueForLanguage(line.cue,config.language))) setState('ready')
        return
      }
      if (command === 'continue' || command === 'repeat' || command === 'question') { paused.current = false; await askReady(); return }
      await smallTalk(text, current); return
    }
    if (await handleCommand(command)) return
    if (!questionAsked && phase === 'story') { await smallTalk(text, current); return }
    let result = evaluateLocal(text, checkpoint, config.language)
    if (['uncertain', 'offTopic'].includes(result.verdict) && sessionID) {
      try {
        result = await evaluateRemotely({ sessionID, storyID: story.id, checkpointID: checkpoint.id, transcript: text, attempt: attemptCount, hintLevel, detectedLanguage: result.language, targetLanguage: config.language })
        if (!current()) return
        addEvent('llm_evaluation', { beatID, verdict: result.verdict })
      } catch {
        if (!current()) return
        addEvent('llm_evaluation', { beatID, fallback: true })
        result = { ...result, verdict: 'uncertain' }
      }
    }
    addEvent('answer_evaluated', { beatID, verdict: result.verdict, matchedConcepts: result.matchedConcepts, transcriptLength: text.length })
    if (result.verdict === 'correct') { pendingRepair.current = false; setUnusableCount(0); await celebrate(result.matchedConcepts); return }
    if (result.verdict === 'meaningUnderstood') {
      markStruggled()
      const englishModel = checkpoint.concepts.map((concept) => concept.en[0]).filter(Boolean).join(' and ')
      const recast = t(`我明白你的意思啦！中文可以这样说：${checkpoint.recast} 我们继续！`, `I understood you! A natural answer is: ${englishModel}. Let’s keep going!`)
      await completeKindly(recast, result.matchedConcepts, true)
      return
    }
    if (result.verdict === 'unusable' || result.verdict === 'uncertain') { await handleUnusable(); return }
    if (result.verdict === 'offTopic') { await handleTangent(text, current); return }
    pendingRepair.current = false
    await handleStruggle()
  }

  async function finishAfterFavorite(text: string, current: () => boolean) {
    let line = boundaryLines[config.language].retry
    let action = 'retry'
    try {
      const storyOutline = (config.language === 'english' ? story.englishSummary : story.summary)
        || readingPath(story, beatPathRef.current).map((item)=>languageText(item.narration,item.englishNarration,config.language).slice(0,240)).join('\n')
      const generated = await generateLine({language:config.language,kind:'storyWrapup',previousLine:headline.slice(0,180),currentQuestion:t('你最喜欢故事里的谁呀？','Who was your favorite in our story?'),learnerSpeech:text,storyID:story.id,storyTitle:languageText(story.title,story.englishTitle,config.language),storyContext:storyOutline.slice(0,1800)})
      line = generated.line; action = generated.action
    } catch { /* Do not close a story when the answer could not be understood. */ }
    if (!current()) return
    pendingRepair.current = action !== 'continue'
    if (!current() || !await say(line)) return
    if (action !== 'continue') { setState('ready'); return }
    finishStory('completed')
  }

  async function handleUnusable() {
    pendingRepair.current = true
    const count = unusableCount + 1
    setUnusableCount(count); addEvent('unusable_audio', { beatID, consecutive: count })
    if (!await say(boundaryLines[config.language].retry)) return
    setState('ready')
  }

  async function recoverAudio() {
    if (!await recorder.enable()) return
    setUnusableCount(0); setPhase('story')
    if (await say(question, checkpoint.englishQuestion, cueForLanguage(checkpoint.audioCue, config.language))) { setQuestionAsked(true); setState('ready') }
  }

  async function handleCommand(command: VoiceCommand) {
    if (command === 'pause') { pauseStory(); return true }
    if (command === 'continue') { const target = storyResumeTarget(questionAsked,resumeAt.current); paused.current = false; if (target === 'question') await repeatQuestion(); else await playScene(false); return true }
    if (command === 'question') { paused.current = false; await repeatQuestion(); return true }
    if (command === 'repeat') { paused.current = false; await playScene(false); return true }
    if (command === 'hint') { await giveHint(); return true }
    if (command === 'end') { finishStory('voice_end'); return true }
    return false
  }

  function finishStory(reason = 'completed') {
    recorder.disable(false)
    interrupt()
    finishedRef.current = true
    const earnedPieces = earnedPuzzlePieceCount(completedRef.current, story.typicalPathLength)
    const puzzleCompleted = storyComplete.current && earnedPieces === story.typicalPathLength
    if (puzzleCompleted) markPuzzleLayoutCompleted(story.id, config.language, puzzleLayoutID)
    const vocabulary = uniqueVocabulary(story.beats.flatMap((item) => item.checkpoint.vocabulary).filter((item) => struggledRef.current.includes(item.id)))
    const finalEvents = [...eventsRef.current, { sequence: nextEventSequence(visitScope), type: 'session_ended', occurredAt: new Date().toISOString(), payload: { reason, beatPath: beatPathRef.current } }]
    const progress = startedRef.current ? snapshot(reason === 'completed' || storyComplete.current) : undefined
    if (progress) cacheProgress(story.id, config.language, progress)
    if (sessionID) void uploadEvents(sessionID, finalEvents, progress).catch(() => undefined)
    completeActiveSession(visitScope)
    onComplete({
      mode: 'story', title: languageText(story.title, story.englishTitle, config.language), story, config,
      rewards: rewardsRef.current, vocabulary, events: finalEvents, sessionID,
      puzzle: { storyID: story.id, ...story.puzzle, coverEmoji: story.coverEmoji, earnedPieces, totalPieces: story.typicalPathLength, layoutID: puzzleLayoutID, completed: puzzleCompleted },
    })
  }

  const recorder = useHandsFree({
    language: config.language, storyID: story.id, beatID: ['story','recast'].includes(phase) ? beatID : 'conversation',
    // Do not let speaker echo from ChooChoo's own voice begin a learner turn.
    // Detection resumes as soon as narration ends.
    allowed: Boolean(sessionID) && !paused.current && state !== 'paused' && state !== 'speaking' && state !== 'thinking' && !['unsafe','audioProblem'].includes(phase),
    onStart: () => { reminderUsed.current = false; interrupt(); setState('listening') }, onProcessing: () => setState('thinking'),
    onTranscript: handleSpeech, onError: () => { if (paused.current) setState('paused'); else if (sessionID) void handleUnusable(); else setState('join') }, onFalseStart: () => setState('ready'), onMuted: pauseStory, onMetric: (metric) => addEvent('transcription_completed', { beatID, ...metric }),
  })
  const status = state === 'listening' ? t('我在听', 'I’m listening') : state === 'thinking' ? t('想一想', 'Thinking') : state === 'paused' ? t('已暂停', 'Paused') : state === 'speaking' ? t('ChooChoo 在说话', 'ChooChoo is speaking') : phase === 'story' || phase === 'recast' ? t('轮到你啦', 'Your turn') : ''

  return <ConversationRoom
    title={languageText(story.title, story.englishTitle, config.language)} language={config.language} state={state} status={status} headline={headline} subtitle={subtitle}
    story={story} visited={beatPath} onClose={onClose} onPause={pauseStory} onResume={!['unsafe','audioProblem'].includes(phase) ? () => void resumeStory() : undefined} error={connectionError || recorder.error}
    question={questionAsked && headline !== question ? question : ''}
    visualCondition={config.visualCondition} scene={{ emoji: beat.emoji, title: beat.title, asset: beat.illustrationAsset }}
    progress={{ current: Math.min(beatPath.length, story.typicalPathLength), total: story.typicalPathLength }} rewards={rewards}
    puzzleProgress={{ earned: earnedPuzzlePieces, total: story.typicalPathLength }}
    storyPuzzle={{ storyID: story.id, ...story.puzzle, coverEmoji: story.coverEmoji, earnedPieces: earnedPuzzlePieces, totalPieces: story.typicalPathLength, layoutID: puzzleLayoutID, completed: earnedPuzzlePieces === story.typicalPathLength }}
    showJoin={phase === 'lobby'} joinLabel={t('打开麦克风，开始聊天', 'Turn on mic & begin')} onJoin={beginWarmup}
    showMic={(Boolean(sessionID) && !['unsafe','audioProblem'].includes(phase)) || recorder.starting} recording={recorder.recording} micEnabled={recorder.enabled} micStarting={recorder.starting} onToggleMic={recorder.toggle}
    onRepeat={() => void repeatQuestion()} onHint={() => void giveHint()} onAdvance={() => void mercyAdvance()} onEnd={() => finishStory('researcher_end')}
    onRecover={phase === 'audioProblem' ? () => void recoverAudio() : undefined}
    onClear={() => { clearLocalResearchData(); onClose() }}
  />
}

function ImaginativePlaySession({ config, onClose, onComplete }: { config: SessionConfig; onClose: () => void; onComplete: (data: CompletionData) => void }) {
  const visitScope: VisitScope = { mode: 'play', language: config.language }
  const [connectionError, setConnectionError] = useState('')
  const [state, setState] = useState<ConversationState>('join')
  const [headline, setHeadline] = useState(languageText(playIntro.lobby.zh, playIntro.lobby.en, config.language))
  const [destination, setDestination] = useState<PlayDestination>()
  const [turn, setTurn] = useState(0)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [sessionID, setSessionID] = useState<string>()
  const [awaitingName, setAwaitingName] = useState(() => !learnerProfile().nameAsked)
  const runID = useRef(0)
  const mounted = useRef(true)
  const eventsRef = useRef(events)
  const lastLine = useRef('')
  const playHistory = useRef<Array<{child: string; reply: string}>>([])
  const [safetyPaused, setSafetyPaused] = useState(false)
  const reminderUsed = useRef(false)
  const pendingRepair = useRef(false)
  const t = (zh: string, en: string) => languageText(zh, en, config.language)
  const addEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const next = [...eventsRef.current, { sequence: nextEventSequence(visitScope), type, occurredAt: new Date().toISOString(), payload }]
    eventsRef.current = next; setEvents(next)
  }

  useEffect(() => {
    mounted.current = true
    addEvent('session_started', { mode: 'play', condition: { language: config.language, visual: config.visualCondition } })
    return () => { mounted.current = false; runID.current += 1; stopVoice() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!sessionID || !events.length) return
    void uploadEvents(sessionID, events, undefined, true)
    const timer = window.setTimeout(() => { void flushEventQueue().catch(() => undefined) }, 1200)
    return () => window.clearTimeout(timer)
  }, [events, sessionID])
  useEffect(() => { addEvent('state_transition', { state, turn, destination: destination?.id }) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, turn, destination?.id])
  useEffect(() => {
    if (state !== 'ready' || !recorder.enabled || safetyPaused || pendingRepair.current) return
    const timer = window.setTimeout(async () => {
      if (reminderUsed.current) {
        if (awaitingName) { rememberLearnerName(); setAwaitingName(false); reminderUsed.current=false; await say(t(playIntro.greeting.zh,playIntro.greeting.en)); return }
        if (!destination) { reminderUsed.current=false; await choose(playDestinations[0]); return }
        if (await say(t('我们把这段小冒险留在这里，下次再一起接着编！', 'Let’s leave our little adventure here. We can dream up more next time!'))) finish('silence_end')
        return
      }
      reminderUsed.current=true
      const line = awaitingName ? t('晚点告诉我也可以。我们先想一个小冒险吧。', 'You can tell me later. Let’s dream up a little adventure.')
        : destination ? playText(destination,'idea',config.language,turn)
        : t('我想坐上云朵小船去探险，你也可以带上一个朋友。', 'I’d love a trip in our cloud boat. You could bring a friend along.')
      await say(line,undefined,false)
    }, 18_000)
    return () => window.clearTimeout(timer)
  })

  const interrupt = () => { runID.current += 1; stopVoice() }
  async function say(text: string, cueID?: string, remember = true) {
    if (!mounted.current) return false
    const current = ++runID.current; if (remember) lastLine.current = text; setState('speaking'); setHeadline(text)
    const played=await speak(text, config.language, cueID)
    if(!played && current===runID.current) {setConnectionError(t('语音播放失败，请重试。','Voice playback failed. Please try again.'));setState('paused');return false}
    if (current === runID.current) { setState('ready'); return true }
    return false
  }
  async function join() {
    setState('thinking'); setConnectionError('')
    if (!await recorder.enable()) { setState('join'); return }
    try { const result = await startResearchSession({ sessionID: activeSessionID(visitScope), mode: 'play', language: config.language, visualCondition: config.visualCondition, label: config.sessionLabel || undefined }); if (!mounted.current || !recorder.isEnabled()) { setState('join'); return }; setSessionID(result.sessionID) }
    catch { recorder.disable(false); setConnectionError(t('无法连接语音服务。请检查网络，然后重试。', 'Could not connect. Check your connection, then try again.')); setState('join'); return }
    const profile = learnerProfile()
    if (!profile.nameAsked) {
      setAwaitingName(true)
      if (await say(t('嗨！我是 ChooChoo。我可以怎么称呼你呢？', 'Hi! I’m ChooChoo. What would you like me to call you?'))) setState('ready')
      return
    }
    setAwaitingName(false)
    if (!await say(t(playIntro.greeting.zh, playIntro.greeting.en), cueForLanguage(playIntro.greeting.cue, config.language))) return
    setHeadline(t(playIntro.choose.zh, playIntro.choose.en))
  }
  async function choose(place: PlayDestination) {
    pendingRepair.current = false
    setDestination(place); addEvent('play_destination', { destination: place.id })
    await say(playText(place, 'opening', config.language), cueForLanguage(place.cue, config.language))
  }
  async function requestRepair() {
    pendingRepair.current = true
    await say(boundaryLines[config.language].retry, undefined, false)
  }
  async function handleSpeech(text: string, current: () => boolean) {
    if (!text.trim()) { await requestRepair(); return }
    if (sessionID) {
      try { const result=await safetyCheck(sessionID, text); if (!current()) return; if (!result.safe) { setSafetyPaused(true); recorder.disable(false); setState('paused'); setHeadline(t('我们先停一下，请叫身边的大人来。', 'Let’s pause and ask the grown-up nearby for help.')); return } }
      catch { if (current()) await requestRepair(); return }
    }
    const command = detectVoiceCommand(text)
    if (command === 'pause') { const line=handsFreeLines.pause; if (await say(t(line.zh,line.en),cueForLanguage(line.cue,config.language),false)) setState('paused'); return }
    if ((command === 'continue' || command === 'repeat') && !awaitingName) { await say(lastLine.current); return }
    if (command === 'end') { finish('voice_end'); return }
    if (awaitingName) {
      const name = nameFromSpeech(text)
      rememberLearnerName(name); setAwaitingName(false)
      const line = name
        ? t(`很高兴认识你，${name}！我们可以坐云朵小船、去会唱歌的农场，或者到魔法餐厅。你想先去哪里？`, `It’s lovely to meet you, ${name}! We can sail a cloud boat, visit a singing farm, or cook in a magic restaurant. Where shall we go?`)
        : t('很高兴认识你！我们可以坐云朵小船、去会唱歌的农场，或者到魔法餐厅。你想先去哪里？', 'It’s lovely to meet you! We can sail a cloud boat, visit a singing farm, or cook in a magic restaurant. Where shall we go?')
      await say(line); return
    }
    if (!destination) {
      const destinationID = destinationFromSpeech(text)
      const selected = playDestinations.find((place) => place.id === destinationID)
      if (selected) { await choose(selected); return }
      await requestRepair(); return
    }
    if (command === 'hint') { await say(playText(destination,'idea',config.language,turn)); return }
    const nextTurn = turn + 1
    setState('thinking')
    let line = boundaryLines[config.language].retry
    let action = 'retry'
    const generatedAt = performance.now()
    try {
      const opening = playText(destination,'opening',config.language)
      const first = playHistory.current[0]
      const recent = [first, ...playHistory.current.slice(1).slice(-3)].filter(Boolean).map(item => JSON.stringify(item)).join('\n').slice(0,1500)
      const generated = await generateLine({ role: 'ChooChoo', language: config.language, visualCondition: config.visualCondition, kind: 'imaginativePlay', previousLine: lastLine.current.slice(0,180), currentQuestion:lastLine.current.slice(0,180), learnerSpeech: text, storyID: destination.id, storyTitle: config.language === 'chinese' ? destination.zh : destination.en, storyContext: `${opening}\n${recent}`.slice(0,1800) })
      line = generated.line; action = generated.action
      if (!current()) return
      addEvent('dynamic_line', { turn: nextTurn, fallback: false, latencyMs: Math.round(performance.now() - generatedAt) })
    } catch { if (!current()) return; addEvent('dynamic_line', { turn: nextTurn, fallback: true, latencyMs: Math.round(performance.now() - generatedAt) }) }
    pendingRepair.current = action !== 'continue'
    if (action !== 'continue') { await say(line,undefined,false); return }
    setTurn(nextTurn); addEvent('play_turn', { turn: nextTurn, transcriptLength: text.length })
    playHistory.current = [...playHistory.current, {child:text.slice(0,300),reply:line}].slice(-12)
    if (!await say(line)) return
    if (nextTurn >= 12) finish('turn_limit', nextTurn)
  }
  function finish(reason = 'completed', completedTurns = turn) {
    recorder.disable(false)
    interrupt()
    playEarcon('complete')
    const finalEvents = [...eventsRef.current, { sequence: nextEventSequence(visitScope), type: 'session_ended', occurredAt: new Date().toISOString(), payload: { reason, turns: completedTurns } }]
    if (sessionID) void uploadEvents(sessionID, finalEvents).catch(() => undefined)
    completeActiveSession(visitScope)
    onComplete({ mode: 'play', title: t('假装游戏', 'Imaginative Play'), config, rewards: [], vocabulary: [], events: finalEvents, sessionID })
  }
  const recorder = useHandsFree({ language: config.language, storyID: 'imaginative-play', beatID: destination?.id ?? 'choose', allowed:Boolean(sessionID) && state !== 'speaking' && state !== 'thinking' && !safetyPaused, onStart: () => { reminderUsed.current=false; interrupt(); setState('listening') }, onProcessing: () => setState('thinking'), onTranscript: handleSpeech, onError: () => { if(sessionID) void requestRepair(); else setState('join') }, onFalseStart: () => setState('ready'), onMuted: () => { interrupt(); setState('paused') }, onMetric: (metric) => addEvent('transcription_completed', { turn, ...metric }) })
  const status = state === 'listening' ? t('我在听', 'I’m listening') : state === 'thinking' ? t('想一想', 'Thinking') : state === 'paused' ? t('已暂停', 'Paused') : ''
  return <ConversationRoom onClose={onClose} onPause={() => { recorder.disable(false); interrupt(); setState('paused') }} error={connectionError || recorder.error} title={t(playIntro.title.zh, playIntro.title.en)} language={config.language} state={state} status={status} headline={headline} subtitle="" visualCondition="voice" showJoin={!sessionID} joinLabel={t('打开麦克风，开始聊天', 'Turn on mic & begin')} onJoin={join} showMic={(Boolean(sessionID) && !safetyPaused) || recorder.starting} recording={recorder.recording} micEnabled={recorder.enabled} micStarting={recorder.starting} onToggleMic={recorder.toggle} onRepeat={() => void say(lastLine.current)} onHint={destination ? () => void say(playText(destination, 'idea', config.language, turn)) : undefined} onAdvance={() => finish('researcher_advance')} onEnd={() => finish('researcher_end')} onClear={() => { clearLocalResearchData(); onClose() }} />
}

interface RoomAction { label: string; onClick: () => void }
interface SceneInfo { emoji: string; title: string; asset: string }

function ConversationRoom({ title, language, state, status, headline, subtitle, question = '', visualCondition, scene, progress, puzzleProgress, storyPuzzle, actions = [], showJoin, joinLabel, onJoin, showMic, recording, micEnabled, micStarting, onToggleMic, ideaLabel, onIdea, onRepeat, onHint, onAdvance, onEnd, onClear, onRecover, onClose, onPause, onResume, story, error, visited }: {
  onResume?: () => void
  storyPuzzle?: PuzzleFinaleData
  onClose: () => void; onPause: () => void; story?: Story; error?: string; visited?: string[]
  title: string; language: LessonLanguage; state: ConversationState; status: string; headline: string; subtitle: string; question?: string; visualCondition: SessionConfig['visualCondition']; scene?: SceneInfo; progress?: { current: number; total: number }; puzzleProgress?: { earned: number; total: number }; rewards?: Reward[]; actions?: RoomAction[]; showJoin: boolean; joinLabel: string; onJoin: () => void; showMic: boolean; recording: boolean; micEnabled: boolean; micStarting: boolean; onToggleMic: () => void; ideaLabel?: string; onIdea?: () => void; onRepeat: () => void; onHint?: () => void; onAdvance: () => void; onEnd: () => void; onClear: () => void; onRecover?: () => void
}) {
  const [drawer, setDrawer] = useState(false)
  const [panel, setPanel] = useState<'story' | 'leave' | null>(null)
  const [textLanguage, setTextLanguage] = useState(language)
  const t = (zh: string, en: string) => languageText(zh, en, language)
  const leave = () => { if (showJoin) onClose(); else { onPause(); setPanel('leave') } }
  const longPress = useRef<number | undefined>(undefined)
  const orbState: OrbState = state === 'speaking' ? 'speaking' : state === 'listening' ? 'listening' : state === 'thinking' ? 'thinking' : state === 'paused' ? 'paused' : 'idle'
  const beginLongPress = () => { longPress.current = window.setTimeout(() => setDrawer(true), 700) }
  const cancelLongPress = () => { if (longPress.current) window.clearTimeout(longPress.current) }
  return <main className={`room room-${visualCondition}`}>
    <header className="room-header">
      <button className="room-back secondary-action" onClick={leave} aria-label={t('返回首页', 'Back to home')}>← <span>{t('首页', 'Home')}</span></button>
      <button className="room-brand" onPointerDown={beginLongPress} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress}><span>CHOOCHOO</span><small>{title}</small></button>
      {progress && <div className="session-progress" aria-label={`${progress.current} / ${progress.total}`}><div className="progress-dots">{Array.from({ length: progress.total }, (_, index) => <i key={index} className={index < progress.current ? 'filled' : ''} />)}</div>{puzzleProgress && <PuzzleTray earned={puzzleProgress.earned} total={puzzleProgress.total} language={language} />}</div>}
    </header>
    <section className="room-stage">
      {storyPuzzle && <div className="story-puzzle-stage" hidden={storyPuzzle.earnedPieces === 0}><StoryPuzzlePicture puzzle={storyPuzzle} language={language} animateNewPieces /></div>}
      {!storyPuzzle?.earnedPieces && (visualCondition === 'pictures' && scene ? <SceneVisual key={scene.asset} scene={scene} /> : <ConversationOrb state={orbState} />)}
      <div className="room-copy" aria-live="polite">{status && <p className="room-state">{status}</p>}<h1>{headline}</h1>{subtitle && <p className="subtitle">{subtitle}</p>}{question && <p className="question-reminder">{language === 'chinese' ? '问题' : 'Question'}：{question}</p>}</div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {onRecover && <button className="secondary-action" onClick={onRecover}>{t('重新连接麦克风', 'Try microphone again')}</button>}
      {state === 'paused' && onResume && <div className="resume-story"><p className="setting-note">{t('麦克风已关闭。准备好后，点击按钮继续。', 'Microphone is off. Press Resume when you’re ready.')}</p><button className="primary-action" disabled={micStarting} onClick={onResume}>{micStarting ? t('正在连接…', 'Connecting…') : t('继续故事', 'Resume story')}</button></div>}
      {state === 'paused' && !onResume && !onRecover && showMic && micEnabled && <p className="setting-note">{t('想继续时，说“继续”就好。', 'Say “continue” when you’re ready.')}</p>}
      {actions.length > 0 && <div className="choice-row">{actions.map((action) => <button disabled={state === 'speaking' || state === 'thinking' || recording} key={action.label} onClick={action.onClick}>{action.label}</button>)}</div>}
      {showJoin && state === 'join' && <button className="join-button" onClick={onJoin}>{joinLabel}</button>}
    </section>
    <footer className="room-footer">
      {story && <button className="idea-button" disabled={recording || state === 'thinking'} onClick={() => { if (!showJoin) onPause(); setPanel('story') }}>{t('读故事', 'Read story')}</button>}
      {showMic && micStarting && <div className="mic-setup-status" role="status"><i aria-hidden="true" /><span>{t('正在准备麦克风…', 'Preparing microphone…')}</span></div>}
      {showMic && !micStarting && !(state === 'paused' && onResume) && <button className={recording ? 'mic-button active' : 'mic-button'} onClick={onToggleMic} aria-pressed={micEnabled} aria-label={micEnabled ? t('关闭麦克风', 'Turn microphone off') : t('打开麦克风', 'Turn microphone on')}><MicIcon muted={!micEnabled} /><span>{micEnabled ? t('麦克风已打开', 'Mic on') : t('麦克风已关闭', 'Mic off')}</span></button>}
      {ideaLabel && onIdea && <button disabled={recording || state === 'thinking'} className="idea-button" onClick={onIdea}>{ideaLabel}</button>}
      {!showJoin && <button className="idea-button end-call" onClick={leave}>{t('结束', 'End')}</button>}
    </footer>
    {panel === 'leave' && <Modal title={t('结束这次对话？', 'Leave this conversation?')} closeLabel={t('留在这里', 'Stay here')} onClose={() => setPanel(null)}><p>{story ? t('进度会保留，下次可以接着听。', 'Your progress will be kept. Continue next time.') : t('下次再一起编一个新故事。', 'Let’s make another story next time.')}</p><button className="primary-action" onClick={onEnd}>{t('结束对话', 'End conversation')}</button></Modal>}
    {panel === 'story' && story && <Modal title={title} closeLabel={t('关闭', 'Close')} onClose={() => setPanel(null)}><Segmented value={textLanguage} options={ [['chinese', '中文'], ['english', 'English']] } onChange={(value) => setTextLanguage(value as LessonLanguage)} /><div className="story-reader">{readingPath(story, visited).map((item, index) => <section key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><p>{languageText(item.narration, item.englishNarration, textLanguage)}</p></section>)}</div></Modal>}
    {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)}><aside className="research-drawer" onClick={(event) => event.stopPropagation()}><header><h2>测试控制</h2><button onClick={() => setDrawer(false)}>关闭</button></header>{onRecover && <button onClick={onRecover}>重新测试麦克风</button>}<button onClick={onRepeat}>重复问题 R</button>{onHint && <button onClick={onHint}>下一个提示 H</button>}<button onClick={onAdvance}>继续下一步 0</button><button onClick={onEnd}>结束本次测试</button><button className="danger-text" onClick={onClear}>清除本机测试数据</button><p>选择题可按 1、2、3 强制选择对应分支。</p></aside></div>}
  </main>
}

function SceneVisual({ scene }: { scene: SceneInfo }) {
  const [imageFailed, setImageFailed] = useState(false)
  return <div className="scene-visual">
    {!imageFailed && <img src={`/illustrations/${encodeURIComponent(scene.asset)}.png`} alt={scene.title} onError={() => setImageFailed(true)} />}
    {imageFailed && <><span>{scene.emoji}</span><small>{scene.title}</small></>}
  </div>
}

function CompletionScreen({ data, onHome, onReplay }: { data: CompletionData; onHome: () => void; onReplay: () => void }) {
  const [answered, setAnswered] = useState(false)
  const completionEvents = useRef(data.events)
  const nextCompletionSequence = useRef(Math.max(0, ...data.events.map((item) => item.sequence)))
  const puzzleLogged = useRef(false)
  const t = (zh: string, en: string) => languageText(zh, en, data.config.language)
  const appendCompletionEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const event = { sequence: ++nextCompletionSequence.current, type, occurredAt: new Date().toISOString(), payload }
    completionEvents.current = [...completionEvents.current, event]
    if (data.sessionID) void uploadEvents(data.sessionID, completionEvents.current).catch(() => undefined)
  }
  const download = () => downloadJSON(`choochoo-${data.sessionID ?? 'local-session'}.json`, { sessionID: data.sessionID, mode: data.mode, title: data.title, condition: data.config, events: completionEvents.current })
  const puzzleAssembled = () => {
    if (puzzleLogged.current) return
    puzzleLogged.current = true
    if (data.puzzle?.completed) collectPuzzle(data.puzzle.storyID, data.config.language)
    appendCompletionEvent('puzzle_assembled')
    playEarcon('complete')
  }
  const answerAgain = (answer: boolean) => {
    appendCompletionEvent('play_again_answered', { answer })
    setAnswered(true)
    if (answer) onReplay(); else onHome()
  }
  const completedPuzzle = data.puzzle?.completed ? data.puzzle : undefined
  const celebration = completedPuzzle ? languageText(completedPuzzle.celebrationText, completedPuzzle.englishCelebrationText, data.config.language) : ''
  return <main className={`completion-screen ${completedPuzzle ? 'puzzle-completion' : ''}`}>
    {completedPuzzle ? <PuzzleFinale puzzle={completedPuzzle} language={data.config.language} onAssembled={puzzleAssembled} /> : <ConversationOrb state="idle" />}
    <section className="completion-card"><span className="wordmark">CHOOCHOO</span><h1>{completedPuzzle ? celebration : t('下次再一起玩。', 'See you next time.')}</h1>
      {!completedPuzzle && data.puzzle && <div className="saved-puzzle"><PuzzleTray earned={data.puzzle.earnedPieces} total={data.puzzle.totalPieces} language={data.config.language} /><p>{t('拼图碎片已经保存，下次可以继续收集。', 'Your puzzle pieces are saved. You can keep collecting next time.')}</p></div>}
      <>
        {data.vocabulary.length > 0 && <div className="vocabulary-review"><h2>{t('下次可以再练', 'Words to practice next time')}</h2><ul>{data.vocabulary.map((word) => <li key={word.id}>{data.config.language === 'chinese' ? <><strong>{word.zh}</strong><span>{word.pinyin}</span><span>{word.en}</span></> : <strong>{word.en}</strong>}</li>)}</ul></div>}
        <ProgressSaveStatus language={data.config.language} />
        {!answered ? <div className="play-again"><p>{t('还想再玩一次吗？', 'Would you like to play again?')}</p><div><button className="primary-action" onClick={() => answerAgain(true)}>{t('再玩一次', 'Play again')}</button><button className="secondary-action" onClick={() => answerAgain(false)}>{t('今天到这里', 'All done')}</button></div></div> : null}
        <details className="research-export"><summary>{t('研究工具', 'Research tools')}</summary><button className="download-link" onClick={download}>{t('下载互动记录', 'Download interaction log')}</button></details>
      </>
    </section>
  </main>
}

function uniqueVocabulary(items: VocabularyItem[]) {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.id === item.id) === index)
}

function englishHintFor(checkpoint: Checkpoint, level: number) {
  const model = checkpoint.concepts.map((concept) => concept.en[0]).filter(Boolean).join(' and ')
  if (level === 1) return checkpoint.englishHint
  if (level === 2) return `Try saying one important word: ${model}.`
  if (level === 3) return `Here is a sentence starter: “I think ${model}…”`
  return `Let’s say the complete answer together: ${model}.`
}

function MicIcon({muted = false}: {muted?: boolean}) { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />{muted && <path d="M3 3l18 18" />}</svg> }

export default App
