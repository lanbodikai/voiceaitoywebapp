import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { readStored, writeStored } from './storage'
import { detectVoiceCommand, type VoiceCommand } from './voiceCommands'
import { readingPath } from './storyPath'
import './App.css'
import type { OrbState } from './ConversationOrb'
import { catalog, findBeat, languageText } from './content'
import { evaluateLocal } from './evaluator'
import { evaluateRemotely, generateLine, recordConsent, safetyCheck, startResearchSession, transcribeAudio, uploadEvents } from './backend'
import { cueForLanguage, playEarcon, playEffect, speak, stopVoice, storyFeedbackCue } from './audio'
import { signInAnonymously } from './supabase'
import { playDestinations, playText, type PlayDestination } from './playContent'
import { clearLocalResearchData, completedBefore, downloadJSON, markCompleted, saveReward, savedRewards, type CompletionData, type SessionConfig } from './session'
import type { Checkpoint, LessonLanguage, Reward, SessionEvent, Story, VocabularyItem } from './types'

type AppScreen = 'consent' | 'home' | 'story' | 'play' | 'complete'
type ConversationState = 'join' | 'speaking' | 'listening' | 'thinking' | 'ready' | 'paused'
type StoryPhase = 'lobby' | 'warmup' | 'mood' | 'ready' | 'story' | 'recast' | 'audioProblem' | 'unsafe'

const LazyConversationOrb = lazy(() => import('./ConversationOrb').then((module) => ({ default: module.ConversationOrb })))

function ConversationOrb({ state }: { state: OrbState }) {
  return <Suspense fallback={<div className="three-orb"><div className="three-orb-fallback" /></div>}><LazyConversationOrb state={state} /></Suspense>
}

const defaultConfig: SessionConfig = {
  language: 'chinese', visualCondition: 'voice', sessionLabel: '', englishSubtitles: false,
}

function App() {
  const [screen, setScreen] = useState<AppScreen>('consent')
  const [config, setConfig] = useState<SessionConfig>(() => {
    const saved = readStored<Partial<SessionConfig> | null>('choochoo:preferences', null)
    return { ...defaultConfig, language: saved?.language === 'english' ? 'english' : 'chinese', visualCondition: saved?.visualCondition === 'pictures' ? 'pictures' : 'voice', englishSubtitles: saved?.englishSubtitles === true }
  })
  useEffect(() => { writeStored('choochoo:preferences', config); document.documentElement.lang = config.language === 'chinese' ? 'zh-CN' : 'en' }, [config])
  const [activeStory, setActiveStory] = useState<Story | null>(null)
  const [completion, setCompletion] = useState<CompletionData | null>(null)

  async function consent() {
    await signInAnonymously()
    await recordConsent({ shareIdentity: false, consentVersion: 'web-research-1.1' })
    setScreen('home')
  }

  function finish(data: CompletionData) { setCompletion(data); setScreen('complete') }
  function replay() {
    if (completion?.mode === 'story' && completion.story) { setActiveStory(completion.story); setScreen('story') }
    else if (completion?.mode === 'play') setScreen('play')
    else setScreen('home')
  }

  if (screen === 'consent') return <ConsentScreen language={config.language} onLanguage={(language) => setConfig({ ...config, language })} onContinue={consent} />
  if (screen === 'home') return <HomeScreen config={config} onConfig={setConfig} onStory={(story) => { setActiveStory(story); setScreen('story') }} onPlay={() => setScreen('play')} />
  if (screen === 'story' && activeStory) return <StorySession story={activeStory} config={config} onClose={() => setScreen('home')} onComplete={finish} />
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
        <p>{t('按住按钮时才会录音。声音发送到语音服务识别回答，本应用不保存录音或孩子说的话。', 'Audio is sent to our speech service only when you hold the talk button. This app does not save recordings or what your child says.')}</p>
        <p>{t('请在成人陪同下使用。ChooChoo 是 AI，可能听错或说错。', 'Stay with your child while using ChooChoo. It is AI and can misunderstand or make mistakes.')}</p>
      </div>
      <label className="check-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>{t('我已阅读并同意，并会陪同孩子使用。', 'I have read and agree, and will stay with my child.')}</span></label>
      {error && <p className="inline-error" role="alert">{t('暂时无法连接。请检查网络，然后重试。', 'We could not connect. Check your connection and try again.')}</p>}
      <button className="primary-action" disabled={!accepted || saving} onClick={proceed}>{saving ? t('正在连接…', 'Connecting…') : error ? t('重试', 'Try again') : t('同意并继续', 'Agree and continue')}</button>
    </section>
  </main>
}

function HomeScreen({ config, onConfig, onStory, onPlay }: { config: SessionConfig; onConfig: (config: SessionConfig) => void; onStory: (story: Story) => void; onPlay: () => void }) {
  const [settings, setSettings] = useState(false)
  const t = (zh: string, en: string) => languageText(zh, en, config.language)
  return <main className="home-screen">
    <header className="home-header"><span className="wordmark">CHOOCHOO</span><button className="secondary-action" onClick={() => setSettings(true)}>{t('设置', 'Settings')}</button></header>
    <div className="home-layout">
      <section className="mode-panel">
        <p className="eyebrow">{t('听一听，说一说', 'A little time to wonder')}</p>
        <h1>{t('今天，去哪里冒险？', 'Where shall we go today?')}</h1>
        <div className="home-preferences"><Segmented value={config.language} options={ [['chinese', '中文'], ['english', 'English']] } onChange={(value) => onConfig({ ...config, language: value as LessonLanguage })} /><span>{t('选一个故事，或一起创造新的冒险。', 'Choose a story, or make up an adventure together.')}</span></div>
        <div className="mode-grid">
          {catalog.stories.map((story, index) => <button className="mode-card" key={story.id} onClick={() => onStory(story)}><span className="story-number" aria-hidden="true">0{index + 1}</span><span className="mode-kind">{t('故事时间', 'Story time')}{completedBefore(story.id) ? t(' · 再听一次', ' · Listen again') : ''}</span><strong>{languageText(story.title, story.englishTitle, config.language)}</strong><span className="card-meta">{story.estimatedMinutes} {t('分钟', 'min')}<span aria-hidden="true">↗</span></span></button>)}
          <button className="mode-card play-card" onClick={onPlay}><span className="mode-kind">{t('想象时间', 'Make believe')}</span><strong>{t('一起创造新冒险', 'An adventure of your own')}</strong><span className="card-meta">{t('跟着你的想法走', 'Let your imagination lead')}<span aria-hidden="true">↗</span></span></button>
        </div>
      </section>
    </div>
    {settings && <Modal title={t('设置', 'Settings')} closeLabel={t('完成', 'Done')} onClose={() => setSettings(false)}><div className="setup-panel">
      <fieldset><legend>{t('对话语言', 'Conversation language')}</legend><Segmented value={config.language} options={ [['chinese', '中文'], ['english', 'English']] } onChange={(value) => onConfig({ ...config, language: value as LessonLanguage })} /></fieldset>
      <fieldset><legend>{t('故事画面', 'Story display')}</legend><Segmented value={config.visualCondition} options={ [['voice', t('语音圆球', 'Voice orb')], ['pictures', t('故事场景', 'Story scenes')]] } onChange={(value) => onConfig({ ...config, visualCondition: value as SessionConfig['visualCondition'] })} /></fieldset>
      {config.language === 'chinese' && <label className="switch-row"><span>英文字幕</span><input type="checkbox" checked={config.englishSubtitles} onChange={(event) => onConfig({ ...config, englishSubtitles: event.target.checked })} /></label>}
      <p className="setting-note">{t('下次打开时会记住你的设置。', 'Your preferences will be remembered on this device.')}</p>
      <details><summary>{t('研究设置', 'Research settings')}</summary><label><span>{t('测试编号（可选）', 'Session label (optional)')}</span><input value={config.sessionLabel} maxLength={80} onChange={(event) => onConfig({ ...config, sessionLabel: event.target.value })} /></label></details>
    </div></Modal>}
  </main>
}

function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <div className="segmented">{options.map(([key, label]) => <button key={key} aria-pressed={value === key} className={value === key ? 'selected' : ''} onClick={() => onChange(key)}>{label}</button>)}</div>
}

function Modal({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  return <dialog className="app-dialog" ref={dialog} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose() }}><header><h2>{title}</h2><button className="secondary-action" onClick={onClose}>{closeLabel}</button></header>{children}</dialog>
}

function StorySession({ story, config, onClose, onComplete }: { story: Story; config: SessionConfig; onClose: () => void; onComplete: (data: CompletionData) => void }) {
  const [beatID, setBeatID] = useState(story.startBeatId)
  const [phase, setPhase] = useState<StoryPhase>('lobby')
  const [state, setState] = useState<ConversationState>('join')
  const [headline, setHeadline] = useState(languageText(completedBefore(story.id) ? '欢迎回来。准备好再听一次了吗？' : '准备好和 ChooChoo 见面了吗？', completedBefore(story.id) ? 'Welcome back. Ready to listen again?' : 'Ready to meet ChooChoo?', config.language))
  const [connectionError, setConnectionError] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [hintLevel, setHintLevel] = useState(0)
  const [attemptCount, setAttemptCount] = useState(0)
  const [unusableCount, setUnusableCount] = useState(0)
  const [tangentUsed, setTangentUsed] = useState(false)
  const [comfortUsed, setComfortUsed] = useState(false)
  const [questionAsked, setQuestionAsked] = useState(false)
  const [rewards, setRewards] = useState<Reward[]>(() => savedRewards(story))
  const [struggledVocabulary, setStruggledVocabulary] = useState<string[]>([])
  const [beatPath, setBeatPath] = useState<string[]>([story.startBeatId])
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
  const beat = findBeat(story, beatID)
  const checkpoint = beat.checkpoint
  const narration = languageText(beat.narration, beat.englishNarration, config.language)
  const question = languageText(checkpoint.question, checkpoint.englishQuestion, config.language)
  const t = (zh: string, en: string) => languageText(zh, en, config.language)
  const addEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const next = [...eventsRef.current, { sequence: eventsRef.current.length + 1, type, occurredAt: new Date().toISOString(), payload }]
    eventsRef.current = next; setEvents(next)
  }

  useEffect(() => {
    mounted.current = true
    addEvent('session_started', { storyID: story.id, mode: 'story', condition: { language: config.language, visual: config.visualCondition } })
    return () => { mounted.current = false; runID.current += 1; stopVoice() }
    // Session identity is intentionally fixed for one mounted story.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id])
  useEffect(() => { if (sessionID && events.length) uploadEvents(sessionID, events).catch(() => undefined) }, [events, sessionID])
  useEffect(() => { addEvent('state_transition', { state, phase, beatID }) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, phase, beatID])
  useEffect(() => { if (autoplayNext.current) { autoplayNext.current = false; void playScene() } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatID])
  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input,textarea')) return
      if (event.key.toLowerCase() === 'r') void repeatQuestion()
      if (event.key.toLowerCase() === 'h') void giveHint()
      if (event.key === '0') void mercyAdvance()
      if (/^[123]$/.test(event.key)) void forceChoice(Number(event.key) - 1)
    }
    window.addEventListener('keydown', keyHandler)
    return () => window.removeEventListener('keydown', keyHandler)
  })
  useEffect(() => {
    if (state !== 'ready' || !['mood', 'ready', 'story', 'recast'].includes(phase)) return
    const timer = window.setTimeout(async () => {
      const reminder = phase === 'mood' ? t('点一下告诉我，你今天感觉怎么样。', 'Tap one to tell me how you feel today.')
        : phase === 'ready' ? t('准备好时，点一下“准备好了”。', 'Tap “I’m ready” when you are ready.')
          : t('按住说话按钮，把你的想法告诉我。', 'Hold the talk button and tell me your idea.')
      if (await say(reminder)) setState('ready')
    }, 10_000)
    return () => window.clearTimeout(timer)
  })

  const interrupt = () => { runID.current += 1; stopVoice() }
  const displaySubtitle = (english: string) => config.language === 'chinese' && config.englishSubtitles ? english : ''

  async function say(text: string, english = '', cueID?: string) {
    if (!mounted.current) return false
    const currentRun = ++runID.current
    setState('speaking'); setHeadline(text); setSubtitle(displaySubtitle(english))
    await speak(text, config.language, cueID)
    return currentRun === runID.current
  }

  async function beginWarmup() {
    setConnectionError(''); setState('thinking')
    try {
      const result = await startResearchSession({ mode: 'story', storyID: story.id, language: config.language, visualCondition: config.visualCondition, label: config.sessionLabel || undefined })
      if (!mounted.current) return
      setSessionID(result.sessionID)
    } catch { setConnectionError(t('无法连接语音服务。请检查网络，然后重试。', 'Could not connect. Check your connection, then try again.')); setState('join'); return }
    setPhase('warmup')
    if (completedBefore(story.id)) {
      if (!await say(t('欢迎回来！这一次，你可以选择不一样的朋友。', 'Welcome back! You can choose a different friend this time.'), '', cueForLanguage('welcome_returning', config.language))) return
      setPhase('ready'); setState('ready'); setHeadline(t('准备好听故事了吗？', 'Ready for the story?')); return
    }
    if (!await say(t('嗨！我是 ChooChoo，很高兴见到你。', 'Hi! I’m ChooChoo. I’m happy to meet you!'), '', cueForLanguage('welcome_greeting', config.language))) return
    if (!await say(t('你今天感觉怎么样？', 'How are you feeling today?'), '', cueForLanguage('welcome_mood_question', config.language))) return
    setPhase('mood'); setState('ready')
  }

  async function chooseMood(mood: 'happy' | 'calm' | 'sleepy') {
    const copy = mood === 'happy' ? t('太好啦，我也很开心！', 'Wonderful! I feel happy too!') : mood === 'calm' ? t('安安静静也很舒服。', 'Calm and cozy sounds lovely.') : t('那我们慢慢地听故事。', 'Then we’ll take the story nice and slowly.')
    if (!await say(copy, '', cueForLanguage(`welcome_mood_${mood}`, config.language))) return
    setPhase('ready'); setState('ready'); setHeadline(t('准备好听故事了吗？', 'Ready for the story?'))
  }

  async function playScene() {
    setPhase('story'); setHintLevel(0); setAttemptCount(0); setUnusableCount(0); setTangentUsed(false); setComfortUsed(false); setQuestionAsked(false)
    beat.soundEffects.filter((item) => item.timing === 'beforeNarration').forEach((item) => playEffect(item.sfxId))
    lastSpokenKind.current = 'scene'
    if (!await say(narration, beat.englishNarration, cueForLanguage(beat.audioCue, config.language))) return
    beat.soundEffects.filter((item) => item.timing === 'afterNarration').forEach((item) => playEffect(item.sfxId))
    lastSpokenKind.current = 'question'
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

  async function awardReward() {
    const reward = checkpoint.reward
    const nextRewards = rewardsRef.current.some((item) => item.id === reward.id) ? rewardsRef.current : [...rewardsRef.current, reward]
    rewardsRef.current = nextRewards; setRewards(nextRewards)
    saveReward(story.id, reward); addEvent('sticker_earned', { beatID, rewardID: reward.id })
    playEarcon('sticker'); playEffect(reward.sfxId)
    const announcement = config.language === 'chinese' ? reward.announcement : `You earned the ${reward.en} sticker!`
    return say(announcement)
  }

  async function advance(matchedConcepts: string[] = [], forcedBranchIndex?: number) {
    const branch = forcedBranchIndex !== undefined ? checkpoint.branches[forcedBranchIndex]
      : checkpoint.branches.find((item) => matchedConcepts.includes(item.conceptId))
        ?? checkpoint.branches.find((item) => item.id === checkpoint.defaultBranchId)
    if (branch) {
      addEvent('branch_taken', { beatID, branchID: branch.id })
      const transition = config.language === 'chinese' ? branch.transitionLine : 'Great choice! Let’s see what happens next.'
      if (!await say(transition)) return
      checkpoint.successSfx.forEach((item) => playEffect(item.sfxId))
    }
    const next = branch?.nextBeatId ?? beat.nextBeatId
    if (!next) { finishStory(); return }
    addEvent('beat_advanced', { from: beat.id, to: next })
    const nextPath = [...beatPathRef.current, next]
    beatPathRef.current = nextPath; setBeatPath(nextPath); setBeatID(next); autoplayNext.current = true
  }

  async function celebrate(matchedConcepts: string[] = [], forcedBranchIndex?: number) {
    setPhase('story'); playEarcon('success')
    const success = config.language === 'chinese' ? checkpoint.successLine : 'You did it!'
    if (!await say(success, '', storyFeedbackCue(story.id, checkpoint.id, 'success', config.language))) return
    if (!await awardReward()) return
    await advance(matchedConcepts, forcedBranchIndex)
  }

  async function mercyAdvance() {
    markStruggled(); addEvent('mercy_fired', { beatID, mercy: true })
    const branch = checkpoint.branches.find((item) => item.id === checkpoint.defaultBranchId)
    const model = branch?.recast ?? checkpoint.recast
    if (!await say(t(`没关系，我们一起说：${model}`, `That’s okay. Let’s say it together: ${checkpoint.concepts.map((concept) => concept.en[0]).join(' and ')}.`))) return
    await celebrate(branch ? [branch.conceptId] : [])
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
    if (attempts >= 3 && !comfortUsed) {
      setComfortUsed(true); addEvent('comfort_fired', { beatID })
      if (!await say(t('没关系，ChooChoo 很喜欢和你一起玩。我们慢慢来。', 'That’s okay. ChooChoo loves playing with you. We can take our time.'))) return
    }
    await giveHint()
  }

  async function handleTangent(text: string) {
    if (tangentUsed) { await handleStruggle(); return }
    setTangentUsed(true); addEvent('tangent_fired', { beatID })
    let line = t('我听到你的新想法了！我们先把故事里的问题找出来。', 'I heard your new idea! Let’s come back to our story question.')
    try {
      const result = await generateLine({ role: 'ChooChoo', language: config.language, visualCondition: config.visualCondition, kind: 'tangent', previousLine: question, learnerSpeech: text })
      line = result.line
    } catch { /* Scripted fallback guarantees a way forward. */ }
    if (!await say(line)) return
    await repeatQuestion()
  }

  async function checkSafety(text: string) {
    if (!sessionID) { setState('paused'); setConnectionError(t('连接尚未准备好，请返回首页重试。', 'The connection is not ready. Return home and try again.')); return false }
    try {
      const result = await safetyCheck(sessionID, text)
      if (result.safe) return true
      addEvent('safety_pause', { beatID, categories: result.categories })
      setPhase('unsafe'); setState('paused'); setHeadline(t('我们先停一下，请叫身边的大人来。', 'Let’s pause and ask the grown-up nearby for help.')); setSubtitle('')
      return false
    } catch {
      await say(t('网络刚刚打了个小喷嚏，请再说一次。', 'The network had a tiny hiccup. Please say that again.'))
      setState('ready'); return false
    }
  }

  async function handleSpeech(text: string) {
    if (!text.trim()) { await handleUnusable(); return }
    if (!await checkSafety(text)) return
    if (text.trim()) setUnusableCount(0)
    const command = detectVoiceCommand(text)
    if (await handleCommand(command)) return
    let result = evaluateLocal(text, checkpoint, config.language)
    if (result.verdict === 'uncertain' && sessionID) {
      try {
        result = await evaluateRemotely({ sessionID, storyID: story.id, checkpointID: checkpoint.id, transcript: text, attempt: attemptCount, hintLevel, detectedLanguage: result.language, targetLanguage: config.language })
        addEvent('llm_evaluation', { beatID, verdict: result.verdict })
      } catch {
        addEvent('llm_evaluation', { beatID, fallback: true })
        result = { ...result, verdict: 'partial' }
      }
    }
    addEvent('answer_evaluated', { beatID, verdict: result.verdict, matchedConcepts: result.matchedConcepts, transcriptLength: text.length })
    if (phase === 'recast') {
      const repeatedConcepts = result.language !== 'english' && result.language !== 'unknown' && checkpoint.concepts.every((concept) => result.matchedConcepts.includes(concept.id))
      if (result.verdict === 'correct' || repeatedConcepts) { await celebrate(result.matchedConcepts); return }
      await handleStruggle(); return
    }
    if (result.verdict === 'correct') { setUnusableCount(0); await celebrate(result.matchedConcepts); return }
    if (result.verdict === 'meaningUnderstood') {
      if (config.language === 'english') { await celebrate(result.matchedConcepts); return }
      markStruggled(); setPhase('recast')
      const recast = `你理解对了！现在跟着我说：${checkpoint.recast}`
      if (!await say(recast, '', storyFeedbackCue(story.id, checkpoint.id, 'recast', config.language))) return
      setState('ready'); return
    }
    if (result.verdict === 'unusable') { await handleUnusable(); return }
    if (result.verdict === 'offTopic') { await handleTangent(text); return }
    await handleStruggle()
  }

  async function handleUnusable() {
    const count = unusableCount + 1
    setUnusableCount(count); addEvent('unusable_audio', { beatID, consecutive: count })
    if (count >= 3) {
      setPhase('audioProblem'); setState('paused'); setHeadline(t('麦克风好像没有听到声音，请叫身边的大人来。', 'The microphone cannot hear you. Please ask the grown-up nearby for help.')); setSubtitle('')
      return
    }
    if (!await say(t('我没有听到完整的答案，请再说一次。', 'I didn’t hear the whole answer. Please say it again.'))) return
    setState('ready')
  }

  async function recoverAudio() {
    setUnusableCount(0); setPhase('story')
    if (await say(question, checkpoint.englishQuestion, cueForLanguage(checkpoint.audioCue, config.language))) { setQuestionAsked(true); setState('ready') }
  }

  async function handleCommand(command: VoiceCommand) {
    if (command === 'pause') { interrupt(); setState('paused'); setHeadline(t('好的，我停在这里。想继续时对我说“继续”。', 'Okay, I’ll pause here. Say “continue” when you’re ready.')); return true }
    if (command === 'continue') { if (lastSpokenKind.current === 'scene') await playScene(); else await repeatQuestion(); return true }
    if (command === 'question') { await repeatQuestion(); return true }
    if (command === 'repeat') { await playScene(); return true }
    if (command === 'hint') { await giveHint(); return true }
    if (command === 'end') { finishStory('voice_end'); return true }
    return false
  }

  function finishStory(reason = 'completed') {
    interrupt()
    if (reason === 'completed') markCompleted(story.id)
    playEarcon('complete')
    const vocabulary = uniqueVocabulary(story.beats.flatMap((item) => item.checkpoint.vocabulary).filter((item) => struggledRef.current.includes(item.id)))
    const finalEvents = [...eventsRef.current, { sequence: eventsRef.current.length + 1, type: 'session_ended', occurredAt: new Date().toISOString(), payload: { reason, beatPath: beatPathRef.current } }]
    if (sessionID) void uploadEvents(sessionID, finalEvents).catch(() => undefined)
    onComplete({ mode: 'story', title: languageText(story.title, story.englishTitle, config.language), story, config, rewards: rewardsRef.current, vocabulary, events: finalEvents, sessionID })
  }

  const recorder = usePushToTalk({
    language: config.language, storyID: story.id, beatID,
    onStart: () => { interrupt(); setState('listening') }, onProcessing: () => setState('thinking'),
    onTranscript: handleSpeech, onError: () => setState('ready'), onMetric: (metric) => addEvent('transcription_completed', { beatID, ...metric }),
  })
  const moodActions = phase === 'mood' ? [
    { label: t('开心 🙂', 'Happy 🙂'), onClick: () => void chooseMood('happy') }, { label: t('平静 😌', 'Calm 😌'), onClick: () => void chooseMood('calm') }, { label: t('有点困 😴', 'Sleepy 😴'), onClick: () => void chooseMood('sleepy') },
  ] : phase === 'ready' ? [{ label: t('准备好了', 'I’m ready'), onClick: () => void playScene() }] : []
  const status = state === 'listening' ? t('我在听', 'I’m listening') : state === 'thinking' ? t('想一想', 'Thinking') : state === 'paused' ? t('已暂停', 'Paused') : state === 'speaking' ? t('ChooChoo 在说话', 'ChooChoo is speaking') : phase === 'story' || phase === 'recast' ? t('轮到你啦', 'Your turn') : ''

  return <ConversationRoom
    title={languageText(story.title, story.englishTitle, config.language)} language={config.language} state={state} status={status} headline={headline} subtitle={subtitle}
    story={story} visited={beatPath} onResume={() => void handleCommand('continue')} onClose={onClose} onPause={() => { interrupt(); if (phase === 'warmup') { setPhase('ready'); setHeadline(t('准备好听故事了吗？', 'Ready for the story?')) }; setState('paused') }} error={connectionError || recorder.error}
    question={questionAsked && headline !== question ? question : ''}
    visualCondition={config.visualCondition} scene={{ emoji: beat.emoji, title: beat.title, asset: beat.illustrationAsset }}
    progress={{ current: Math.min(beatPath.length, story.typicalPathLength), total: story.typicalPathLength }} rewards={rewards}
    actions={moodActions} showJoin={phase === 'lobby'} joinLabel={t('加入通话', 'Join conversation')} onJoin={beginWarmup}
    showMic={phase === 'story' || phase === 'recast'} recording={recorder.recording} onStart={recorder.start} onStop={recorder.stop}
    onRepeat={() => void repeatQuestion()} onHint={() => void giveHint()} onAdvance={() => void mercyAdvance()} onEnd={() => finishStory('researcher_end')}
    onRecover={phase === 'audioProblem' ? () => void recoverAudio() : undefined}
    onClear={() => { clearLocalResearchData(); onClose() }}
  />
}

function ImaginativePlaySession({ config, onClose, onComplete }: { config: SessionConfig; onClose: () => void; onComplete: (data: CompletionData) => void }) {
  const [connectionError, setConnectionError] = useState('')
  const [state, setState] = useState<ConversationState>('join')
  const [headline, setHeadline] = useState(languageText('准备好创造一个新冒险了吗？', 'Ready to create a new adventure?', config.language))
  const [destination, setDestination] = useState<PlayDestination>()
  const [choosing, setChoosing] = useState(false)
  const [turn, setTurn] = useState(0)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [sessionID, setSessionID] = useState<string>()
  const runID = useRef(0)
  const mounted = useRef(true)
  const eventsRef = useRef(events)
  const lastLine = useRef('')
  const t = (zh: string, en: string) => languageText(zh, en, config.language)
  const addEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const next = [...eventsRef.current, { sequence: eventsRef.current.length + 1, type, occurredAt: new Date().toISOString(), payload }]
    eventsRef.current = next; setEvents(next)
  }

  useEffect(() => {
    mounted.current = true
    addEvent('session_started', { mode: 'play', condition: { language: config.language, visual: config.visualCondition } })
    return () => { mounted.current = false; runID.current += 1; stopVoice() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (sessionID && events.length) uploadEvents(sessionID, events).catch(() => undefined) }, [events, sessionID])
  useEffect(() => { addEvent('state_transition', { state, turn, destination: destination?.id }) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, turn, destination?.id])
  useEffect(() => {
    if (state !== 'ready' || !destination) return
    const timer = window.setTimeout(async () => { await say(t('按住说话按钮，告诉我接下来会发生什么。', 'Hold the talk button and tell me what happens next.')); setState('ready') }, 10_000)
    return () => window.clearTimeout(timer)
  })

  const interrupt = () => { runID.current += 1; stopVoice() }
  async function say(text: string, cueID?: string) {
    if (!mounted.current) return false
    const current = ++runID.current; lastLine.current = text; setState('speaking'); setHeadline(text)
    await speak(text, config.language, cueID)
    if (current === runID.current) { setState('ready'); return true }
    return false
  }
  async function join() {
    setState('thinking'); setConnectionError('')
    try { const result = await startResearchSession({ mode: 'play', language: config.language, visualCondition: config.visualCondition, label: config.sessionLabel || undefined }); setSessionID(result.sessionID) }
    catch { setConnectionError(t('无法连接语音服务。请检查网络，然后重试。', 'Could not connect. Check your connection, then try again.')); setState('join'); return }
    if (!await say(t('嗨！今天我们想去哪里冒险？', 'Hi! Where should we adventure today?'), cueForLanguage('imagine_welcome', config.language))) return
    setChoosing(true); setHeadline(t('选择一个地方', 'Choose a place'))
  }
  async function choose(place: PlayDestination) {
    setDestination(place); setChoosing(false); addEvent('play_destination', { destination: place.id })
    await say(playText(place, 'opening', config.language), cueForLanguage(place.cue, config.language))
  }
  async function handleSpeech(text: string) {
    if (sessionID) {
      try { if (!(await safetyCheck(sessionID, text)).safe) { setState('paused'); setHeadline(t('我们先停一下，请叫身边的大人来。', 'Let’s pause and ask the grown-up nearby for help.')); return } }
      catch { await say(t('网络刚刚打了个小喷嚏，请再说一次。', 'The network had a tiny hiccup. Please try again.')); return }
    }
    const command = detectVoiceCommand(text)
    if (command === 'pause') { interrupt(); setState('paused'); setHeadline(t('好的，我停在这里。', 'Okay, I’ll pause here.')); return }
    if (command === 'continue' || command === 'repeat') { await say(lastLine.current); return }
    if (command === 'end') { finish('voice_end'); return }
    if (!destination) return
    const nextTurn = turn + 1
    setTurn(nextTurn); setState('thinking'); addEvent('play_turn', { turn: nextTurn, transcriptLength: text.length })
    let line = nextTurn % 3 === 0 ? playText(destination, 'challenge', config.language, nextTurn / 3) : t('这个想法真有趣！接下来会发生什么？', 'That is a fun idea! What happens next?')
    const generatedAt = performance.now()
    try {
      const generated = await generateLine({ role: 'ChooChoo', language: config.language, visualCondition: config.visualCondition, kind: 'imaginativePlay', previousLine: lastLine.current, learnerSpeech: text })
      line = generated.line
      addEvent('dynamic_line', { turn: nextTurn, fallback: false, latencyMs: Math.round(performance.now() - generatedAt) })
    } catch { addEvent('dynamic_line', { turn: nextTurn, fallback: true, latencyMs: Math.round(performance.now() - generatedAt) }) }
    if (!await say(line)) return
    if (nextTurn >= 12) finish('turn_limit', nextTurn)
  }
  function finish(reason = 'completed', completedTurns = turn) {
    interrupt()
    playEarcon('complete')
    const finalEvents = [...eventsRef.current, { sequence: eventsRef.current.length + 1, type: 'session_ended', occurredAt: new Date().toISOString(), payload: { reason, turns: completedTurns } }]
    if (sessionID) void uploadEvents(sessionID, finalEvents).catch(() => undefined)
    onComplete({ mode: 'play', title: t('假装游戏', 'Imaginative Play'), config, rewards: [], vocabulary: [], events: finalEvents, sessionID })
  }
  const recorder = usePushToTalk({ language: config.language, storyID: 'imaginative-play', beatID: destination?.id ?? 'choose', onStart: () => { interrupt(); setState('listening') }, onProcessing: () => setState('thinking'), onTranscript: handleSpeech, onError: async () => { await say(t('我没有听清，请再说一次。', 'I didn’t hear you. Please try again.')) }, onMetric: (metric) => addEvent('transcription_completed', { turn, ...metric }) })
  const actions = choosing ? playDestinations.map((place) => ({ label: config.language === 'chinese' ? place.zh : place.en, onClick: () => void choose(place) })) : []
  const status = state === 'listening' ? t('我在听', 'I’m listening') : state === 'thinking' ? t('想一想', 'Thinking') : state === 'paused' ? t('已暂停', 'Paused') : ''
  return <ConversationRoom onClose={onClose} onPause={() => { interrupt(); if (!destination) setChoosing(true); setState('paused') }} error={connectionError || recorder.error} title={t('想象时间', 'Make believe')} language={config.language} state={state} status={status} headline={headline} subtitle="" visualCondition="voice" actions={actions} showJoin={state === 'join'} joinLabel={t('加入通话', 'Join conversation')} onJoin={join} showMic={Boolean(destination)} recording={recorder.recording} onStart={recorder.start} onStop={recorder.stop} ideaLabel={destination ? t('帮我想', 'Give me an idea') : undefined} onIdea={destination ? () => void say(playText(destination, 'idea', config.language, turn)) : undefined} onRepeat={() => void say(lastLine.current)} onHint={destination ? () => void say(playText(destination, 'idea', config.language, turn)) : undefined} onAdvance={() => finish('researcher_advance')} onEnd={() => finish('researcher_end')} onClear={() => { clearLocalResearchData(); onClose() }} />
}

interface RoomAction { label: string; onClick: () => void }
interface SceneInfo { emoji: string; title: string; asset: string }

function ConversationRoom({ title, language, state, status, headline, subtitle, question = '', visualCondition, scene, progress, rewards = [], actions = [], showJoin, joinLabel, onJoin, showMic, recording, onStart, onStop, ideaLabel, onIdea, onRepeat, onHint, onAdvance, onEnd, onClear, onRecover, onClose, onPause, story, error, visited, onResume }: {
  onClose: () => void; onPause: () => void; story?: Story; error?: string; visited?: string[]; onResume?: () => void
  title: string; language: LessonLanguage; state: ConversationState; status: string; headline: string; subtitle: string; question?: string; visualCondition: SessionConfig['visualCondition']; scene?: SceneInfo; progress?: { current: number; total: number }; rewards?: Reward[]; actions?: RoomAction[]; showJoin: boolean; joinLabel: string; onJoin: () => void; showMic: boolean; recording: boolean; onStart: () => void; onStop: () => void; ideaLabel?: string; onIdea?: () => void; onRepeat: () => void; onHint?: () => void; onAdvance: () => void; onEnd: () => void; onClear: () => void; onRecover?: () => void
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
      <button className="room-back secondary-action" onClick={leave} disabled={recording || state === 'thinking'} aria-label={t('返回首页', 'Back to home')}>← <span>{t('首页', 'Home')}</span></button>
      <button className="room-brand" onPointerDown={beginLongPress} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress}><span>CHOOCHOO</span><small>{title}</small></button>
      {progress && <div className="session-progress" aria-label={`${progress.current} / ${progress.total}`}><div className="progress-dots">{Array.from({ length: progress.total }, (_, index) => <i key={index} className={index < progress.current ? 'filled' : ''} />)}</div>{visualCondition === 'pictures' && <div className="sticker-shelf">{rewards.slice(-5).map((reward) => <span key={reward.id} title={reward.zh}>{reward.emoji}</span>)}</div>}</div>}
    </header>
    <section className="room-stage">
      {visualCondition === 'pictures' && scene ? <SceneVisual key={scene.asset} scene={scene} /> : <ConversationOrb state={orbState} />}
      <div className="room-copy" aria-live="polite">{status && <p className="room-state">{status}</p>}<h1>{headline}</h1>{subtitle && <p className="subtitle">{subtitle}</p>}{question && <p className="question-reminder">{language === 'chinese' ? '问题' : 'Question'}：{question}</p>}</div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {onRecover && <button className="secondary-action" onClick={onRecover}>{t('重新连接麦克风', 'Try microphone again')}</button>}
      {state === 'paused' && !onRecover && showMic && <button className="secondary-action" onClick={onResume ?? onRepeat}>{t('继续对话', 'Continue conversation')}</button>}
      {actions.length > 0 && <div className="choice-row">{actions.map((action) => <button disabled={state === 'speaking' || state === 'thinking' || recording} key={action.label} onClick={action.onClick}>{action.label}</button>)}</div>}
      {showJoin && <button className="join-button" disabled={state === 'thinking'} onClick={onJoin}>{state === 'thinking' ? t('正在连接…', 'Connecting…') : joinLabel}</button>}
    </section>
    <footer className="room-footer">
      {story && <button className="idea-button" disabled={recording || state === 'thinking'} onClick={() => { if (!showJoin) onPause(); setPanel('story') }}>{t('读故事', 'Read story')}</button>}
      {showMic && <button disabled={state === 'thinking'} className={recording ? 'mic-button active' : 'mic-button'} onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); onStart() }} onPointerUp={onStop} onPointerCancel={onStop} onKeyDown={(event) => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) onStart() } }} onKeyUp={(event) => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); onStop() } }} onBlur={onStop} aria-label={t('按住说话', 'Hold to talk')}><MicIcon /><span>{recording ? t('松开发送', 'Release to send') : t('按住说话', 'Hold to talk')}</span></button>}
      {ideaLabel && onIdea && <button disabled={recording || state === 'thinking'} className="idea-button" onClick={onIdea}>{ideaLabel}</button>}
      {!showJoin && <button className="idea-button end-call" disabled={recording || state === 'thinking'} onClick={leave}>{t('结束', 'End')}</button>}
    </footer>
    {panel === 'leave' && <Modal title={t('结束这次对话？', 'Leave this conversation?')} closeLabel={t('留在这里', 'Stay here')} onClose={() => setPanel(null)}><p>{t('已经获得的贴纸会保留。下次可以重新开始。', 'Your earned stickers will be kept. You can start again next time.')}</p><button className="primary-action" onClick={onEnd}>{t('结束对话', 'End conversation')}</button></Modal>}
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
  const t = (zh: string, en: string) => languageText(zh, en, data.config.language)
  const download = () => downloadJSON(`choochoo-${data.sessionID ?? 'local-session'}.json`, { sessionID: data.sessionID, mode: data.mode, title: data.title, condition: data.config, events: data.events })
  const answerAgain = (answer: boolean) => {
    const event = { sequence: data.events.length + 1, type: 'play_again_answered', occurredAt: new Date().toISOString(), payload: { answer } }
    if (data.sessionID) uploadEvents(data.sessionID, [...data.events, event]).catch(() => undefined)
    setAnswered(true)
    if (answer) onReplay(); else onHome()
  }
  return <main className="completion-screen">
    <ConversationOrb state="idle" />
    <section className="completion-card"><span className="wordmark">CHOOCHOO</span><h1>{t('下次再一起玩。', 'See you next time.')}</h1>
      {data.rewards.length > 0 && <div className="completion-stickers">{data.rewards.slice(-5).map((reward) => <span key={reward.id}>{reward.emoji}</span>)}</div>}
      {data.vocabulary.length > 0 && <div className="vocabulary-review"><h2>{t('下次可以再练', 'Words to practice next time')}</h2><ul>{data.vocabulary.map((word) => <li key={word.id}>{data.config.language === 'chinese' ? <><strong>{word.zh}</strong><span>{word.pinyin}</span><span>{word.en}</span></> : <strong>{word.en}</strong>}</li>)}</ul></div>}
      {!answered ? <div className="play-again"><p>{t('还想再玩一次吗？', 'Would you like to play again?')}</p><div><button className="primary-action" onClick={() => answerAgain(true)}>{t('再玩一次', 'Play again')}</button><button className="secondary-action" onClick={() => answerAgain(false)}>{t('今天到这里', 'All done')}</button></div></div> : null}
      <details className="research-export"><summary>{t('研究工具', 'Research tools')}</summary><button className="download-link" onClick={download}>{t('下载互动记录', 'Download interaction log')}</button></details>
    </section>
  </main>
}

function usePushToTalk({ language, storyID, beatID, onStart, onProcessing, onTranscript, onError, onMetric }: { language: LessonLanguage; storyID: string; beatID: string; onStart: () => void; onProcessing: () => void; onTranscript: (text: string) => Promise<void>; onError: () => void | Promise<void>; onMetric?: (metric: { audioDurationMs: number; transcriptionLatencyMs: number }) => void }) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const alive = useRef(true)
  const recordingLimit = useRef<number | undefined>(undefined)
  const recorder = useRef<MediaRecorder | undefined>(undefined)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const pressed = useRef(false)
  const activeStream = useRef<MediaStream | undefined>(undefined)
  const latest = useRef({ language, storyID, beatID, onTranscript, onError, onProcessing, onMetric })
  useEffect(() => { latest.current = { language, storyID, beatID, onTranscript, onError, onProcessing, onMetric } }, [language, storyID, beatID, onTranscript, onError, onProcessing, onMetric])
  useEffect(() => { alive.current = true; return () => {
    alive.current = false
    window.clearTimeout(recordingLimit.current)
    pressed.current = false
    if (recorder.current?.state === 'recording') {
      recorder.current.ondataavailable = null
      recorder.current.onstop = null
      recorder.current.stop()
    }
    activeStream.current?.getTracks().forEach((track) => track.stop())
  } }, [])
  async function start() {
    if (busy.current) return
    busy.current = true
    setError('')
    pressed.current = true
    try {
      onStart()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!alive.current || !pressed.current) {
        stream.getTracks().forEach((track) => track.stop()); busy.current = false
        if (alive.current) { setError(language === 'chinese' ? '麦克风已准备好，请再次按住说话。' : 'Microphone ready. Hold the button again to talk.'); await onError() }
        return
      }
      activeStream.current = stream
      const preferred = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const media = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
      recorder.current = media; chunks.current = []; startedAt.current = performance.now()
      media.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      media.onstop = async () => {
        window.clearTimeout(recordingLimit.current)
        stream.getTracks().forEach((track) => track.stop()); activeStream.current = undefined; setRecording(false); playEarcon('stop')
        latest.current.onProcessing()
        const submittedAt = performance.now()
        const audioDurationMs = Math.round(submittedAt - startedAt.current)
        const thinkingTimer = window.setTimeout(() => playEarcon('thinking'), 1_200)
        const audio = new Blob(chunks.current, { type: media.mimeType || 'audio/webm' })
        chunks.current = []
        try {
          if (audioDurationMs < 250 || !audio.size) throw new Error('short-recording')
          const context = latest.current
          const result = await transcribeAudio(audio, { language: context.language, storyID: context.storyID, beatID: context.beatID, durationMs: String(audioDurationMs) })
          window.clearTimeout(thinkingTimer)
          if (!alive.current) return
          context.onMetric?.({ audioDurationMs, transcriptionLatencyMs: Math.round(performance.now() - submittedAt) }); busy.current = false; await context.onTranscript(result.transcript)
        } catch (failure) {
          window.clearTimeout(thinkingTimer)
          if (!alive.current) return
          const short = failure instanceof Error && failure.message === 'short-recording'
          setError(language === 'chinese' ? short ? '请按住按钮说完，再松开发送。' : '没有连接到语音服务。请检查网络，再试一次。' : short ? 'Hold the button while speaking, then release to send.' : 'Could not reach the speech service. Check your connection and try again.')
          await latest.current.onError()
        } finally { busy.current = false }
      }
      media.start(); setRecording(true); playEarcon('listen')
      recordingLimit.current = window.setTimeout(stop, 30_000)
      if (!pressed.current) media.stop()
    } catch (failure) {
      activeStream.current?.getTracks().forEach((track) => track.stop()); activeStream.current = undefined; busy.current = false
      if (!alive.current) return
      setRecording(false)
      const denied = failure instanceof DOMException && failure.name === 'NotAllowedError'
      setError(language === 'chinese' ? denied ? '请在浏览器的网站设置中允许麦克风，然后再次按住说话。' : '无法使用麦克风。请检查设备是否已连接，并关闭其他录音应用。' : denied ? 'Allow microphone access in your browser’s site settings, then hold to talk again.' : 'Microphone unavailable. Check that it is connected and close other recording apps.')
      await onError()
    }
  }
  function stop() { pressed.current = false; if (recorder.current?.state === 'recording') recorder.current.stop() }
  return { recording, start, stop, error }
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

function MicIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></svg> }

export default App
