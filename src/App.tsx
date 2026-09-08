import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
type VoiceCommand = 'pause' | 'continue' | 'repeat' | 'question' | 'hint' | 'end' | null
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
  const [config, setConfig] = useState(defaultConfig)
  const [activeStory, setActiveStory] = useState<Story | null>(null)
  const [completion, setCompletion] = useState<CompletionData | null>(null)

  async function consent() {
    try {
      await signInAnonymously()
      await recordConsent({ shareIdentity: false, consentVersion: 'web-research-1.1' })
    } catch { /* The adult can still review the prototype when the research service is offline. */ }
    setScreen('home')
  }

  function finish(data: CompletionData) { setCompletion(data); setScreen('complete') }
  function replay() {
    if (completion?.mode === 'story' && completion.story) { setActiveStory(completion.story); setScreen('story') }
    else if (completion?.mode === 'play') setScreen('play')
    else setScreen('home')
  }

  if (screen === 'consent') return <ConsentScreen onContinue={consent} />
  if (screen === 'home') return <HomeScreen config={config} onConfig={setConfig} onStory={(story) => { setActiveStory(story); setScreen('story') }} onPlay={() => setScreen('play')} />
  if (screen === 'story' && activeStory) return <StorySession story={activeStory} config={config} onClose={() => setScreen('home')} onComplete={finish} />
  if (screen === 'play') return <ImaginativePlaySession config={config} onClose={() => setScreen('home')} onComplete={finish} />
  if (screen === 'complete' && completion) return <CompletionScreen data={completion} onHome={() => setScreen('home')} onReplay={replay} />
  return null
}

function ConsentScreen({ onContinue }: { onContinue: () => Promise<void> }) {
  const [accepted, setAccepted] = useState(false)
  const [saving, setSaving] = useState(false)
  async function proceed() { if (!accepted) return; setSaving(true); await onContinue() }
  return <main className="consent-screen">
    <section className="consent-card">
      <span className="wordmark">CHOOCHOO</span>
      <h1>开始前，请由成人确认</h1>
      <div className="consent-copy">
        <p>只有按住说话按钮时，麦克风才会录音。</p>
        <p>声音会发送到我们的服务来识别回答，原始录音不会保存。当前版本只保存不含孩子原话的互动数据。</p>
        <p>请在成人陪同下使用。ChooChoo 是 AI，偶尔可能听错或说错。</p>
      </div>
      <label className="check-row"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>我已阅读并同意让孩子在成人陪同下参加测试。</span></label>
      <button className="primary-action" disabled={!accepted || saving} onClick={proceed}>{saving ? '正在准备…' : '同意并继续'}</button>
    </section>
  </main>
}

function HomeScreen({ config, onConfig, onStory, onPlay }: { config: SessionConfig; onConfig: (config: SessionConfig) => void; onStory: (story: Story) => void; onPlay: () => void }) {
  return <main className="home-screen">
    <header className="home-header"><span className="wordmark">CHOOCHOO</span><span>儿童语言互动测试</span></header>
    <div className="home-layout">
      <aside className="setup-panel">
        <h2>本次测试</h2>
        <label><span>编号</span><input value={config.sessionLabel} maxLength={80} placeholder="例如 family03-visit1" onChange={(event) => onConfig({ ...config, sessionLabel: event.target.value })} /></label>
        <fieldset><legend>语言</legend><Segmented value={config.language} options={[['chinese', '中文优先'], ['english', 'English first']]} onChange={(value) => onConfig({ ...config, language: value as LessonLanguage })} /></fieldset>
        <fieldset><legend>画面</legend><Segmented value={config.visualCondition} options={[['pictures', '故事画面'], ['voice', '语音圆球']]} onChange={(value) => onConfig({ ...config, visualCondition: value as SessionConfig['visualCondition'] })} /></fieldset>
        <label className="switch-row"><span>英文字幕</span><input type="checkbox" checked={config.englishSubtitles} onChange={(event) => onConfig({ ...config, englishSubtitles: event.target.checked })} /></label>
      </aside>
      <section className="mode-panel">
        <h1>选择今天的活动</h1>
        <div className="mode-grid">
          <button className="mode-card play-card" onClick={onPlay}><span className="mode-kind">假装游戏</span><strong>{config.language === 'chinese' ? '一起创造新冒险' : 'Create an adventure together'}</strong><span>开始</span></button>
          {catalog.stories.map((story) => <button className="mode-card" key={story.id} onClick={() => onStory(story)}><span className="mode-kind">故事时间</span><strong>{languageText(story.title, story.englishTitle, config.language)}</strong><span>{story.estimatedMinutes} 分钟</span></button>)}
        </div>
      </section>
    </div>
  </main>
}

function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <div className="segmented">{options.map(([key, label]) => <button key={key} className={value === key ? 'selected' : ''} onClick={() => onChange(key)}>{label}</button>)}</div>
}

function StorySession({ story, config, onClose, onComplete }: { story: Story; config: SessionConfig; onClose: () => void; onComplete: (data: CompletionData) => void }) {
  const [beatID, setBeatID] = useState(story.startBeatId)
  const [phase, setPhase] = useState<StoryPhase>('lobby')
  const [state, setState] = useState<ConversationState>('join')
  const [headline, setHeadline] = useState(completedBefore(story.id) ? '欢迎回来。准备好选择不一样的朋友了吗？' : '准备好和 ChooChoo 见面了吗？')
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
    startResearchSession({ mode: 'story', storyID: story.id, language: config.language, visualCondition: config.visualCondition, label: config.sessionLabel || undefined }).then((result) => setSessionID(result.sessionID)).catch(() => undefined)
    addEvent('session_started', { storyID: story.id, mode: 'story', condition: { language: config.language, visual: config.visualCondition } })
    return () => { runID.current += 1; stopVoice() }
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
      await say(reminder); setState('ready')
    }, 10_000)
    return () => window.clearTimeout(timer)
  })

  const interrupt = () => { runID.current += 1; stopVoice() }
  const displaySubtitle = (english: string) => config.language === 'chinese' && config.englishSubtitles ? english : ''

  async function say(text: string, english = '', cueID?: string) {
    const currentRun = ++runID.current
    setState('speaking'); setHeadline(text); setSubtitle(displaySubtitle(english))
    await speak(text, config.language, cueID)
    return currentRun === runID.current
  }

  async function beginWarmup() {
    setPhase('warmup')
    if (completedBefore(story.id)) {
      await say(t('欢迎回来！这一次，你可以选择不一样的朋友。', 'Welcome back! You can choose a different friend this time.'), '', cueForLanguage('welcome_returning', config.language))
      setPhase('ready'); setState('ready'); setHeadline(t('准备好听故事了吗？', 'Ready for the story?')); return
    }
    if (!await say(t('嗨！我是 ChooChoo，很高兴见到你。', 'Hi! I’m ChooChoo. I’m happy to meet you!'), '', cueForLanguage('welcome_greeting', config.language))) return
    await say(t('你今天感觉怎么样？', 'How are you feeling today?'), '', cueForLanguage('welcome_mood_question', config.language))
    setPhase('mood'); setState('ready')
  }

  async function chooseMood(mood: 'happy' | 'calm' | 'sleepy') {
    const copy = mood === 'happy' ? t('太好啦，我也很开心！', 'Wonderful! I feel happy too!') : mood === 'calm' ? t('安安静静也很舒服。', 'Calm and cozy sounds lovely.') : t('那我们慢慢地听故事。', 'Then we’ll take the story nice and slowly.')
    await say(copy, '', cueForLanguage(`welcome_mood_${mood}`, config.language))
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
    await say(announcement)
  }

  async function advance(matchedConcepts: string[] = [], forcedBranchIndex?: number) {
    const branch = forcedBranchIndex !== undefined ? checkpoint.branches[forcedBranchIndex]
      : checkpoint.branches.find((item) => matchedConcepts.includes(item.conceptId))
        ?? checkpoint.branches.find((item) => item.id === checkpoint.defaultBranchId)
    if (branch) {
      addEvent('branch_taken', { beatID, branchID: branch.id })
      const transition = config.language === 'chinese' ? branch.transitionLine : 'Great choice! Let’s see what happens next.'
      await say(transition)
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
    await say(success, '', storyFeedbackCue(story.id, checkpoint.id, 'success', config.language))
    await awardReward()
    await advance(matchedConcepts, forcedBranchIndex)
  }

  async function mercyAdvance() {
    markStruggled(); addEvent('mercy_fired', { beatID, mercy: true })
    const branch = checkpoint.branches.find((item) => item.id === checkpoint.defaultBranchId)
    const model = branch?.recast ?? checkpoint.recast
    await say(t(`没关系，我们一起说：${model}`, `That’s okay. Let’s say it together: ${checkpoint.englishQuestion}`))
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
      await say(t('没关系，ChooChoo 很喜欢和你一起玩。我们慢慢来。', 'That’s okay. ChooChoo loves playing with you. We can take our time.'))
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
    await say(line)
    await repeatQuestion()
  }

  async function checkSafety(text: string) {
    if (!sessionID) return true
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
    if (!await checkSafety(text)) return
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
      const repeatedConcepts = checkpoint.concepts.every((concept) => result.matchedConcepts.includes(concept.id))
      if (result.verdict === 'correct' || repeatedConcepts) { await celebrate(result.matchedConcepts); return }
      await handleStruggle(); return
    }
    if (result.verdict === 'correct') { setUnusableCount(0); await celebrate(result.matchedConcepts); return }
    if (result.verdict === 'meaningUnderstood') {
      if (config.language === 'english') { await celebrate(result.matchedConcepts); return }
      markStruggled(); setPhase('recast')
      const recast = `你理解对了！现在跟着我说：${checkpoint.recast}`
      await say(recast, '', storyFeedbackCue(story.id, checkpoint.id, 'recast', config.language))
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
    await say(t('我没有听到完整的答案，请再说一次。', 'I didn’t hear the whole answer. Please say it again.'))
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
    if (reason === 'completed') markCompleted(story.id)
    playEarcon('complete')
    const vocabulary = uniqueVocabulary(story.beats.flatMap((item) => item.checkpoint.vocabulary).filter((item) => struggledRef.current.includes(item.id)))
    const finalEvents = [...eventsRef.current, { sequence: eventsRef.current.length + 1, type: 'session_ended', occurredAt: new Date().toISOString(), payload: { reason, beatPath: beatPathRef.current } }]
    onComplete({ mode: 'story', title: languageText(story.title, story.englishTitle, config.language), story, config, rewards: rewardsRef.current, vocabulary, events: finalEvents, sessionID })
  }

  const recorder = usePushToTalk({
    language: config.language, storyID: story.id, beatID,
    onStart: () => { interrupt(); setState('listening') }, onProcessing: () => setState('thinking'),
    onTranscript: handleSpeech, onError: handleUnusable, onMetric: (metric) => addEvent('transcription_completed', { beatID, ...metric }),
  })
  const moodActions = phase === 'mood' ? [
    { label: t('开心 🙂', 'Happy 🙂'), onClick: () => void chooseMood('happy') }, { label: t('平静 😌', 'Calm 😌'), onClick: () => void chooseMood('calm') }, { label: t('有点困 😴', 'Sleepy 😴'), onClick: () => void chooseMood('sleepy') },
  ] : phase === 'ready' ? [{ label: t('准备好了', 'I’m ready'), onClick: () => void playScene() }] : []
  const status = state === 'listening' ? t('我在听', 'I’m listening') : state === 'thinking' ? t('想一想', 'Thinking') : state === 'paused' ? t('已暂停', 'Paused') : state === 'speaking' ? t('ChooChoo 在说话', 'ChooChoo is speaking') : phase === 'story' || phase === 'recast' ? t('轮到你啦', 'Your turn') : ''

  return <ConversationRoom
    title={languageText(story.title, story.englishTitle, config.language)} language={config.language} state={state} status={status} headline={headline} subtitle={subtitle}
    question={questionAsked && headline !== question ? question : ''}
    visualCondition={config.visualCondition} scene={{ emoji: beat.emoji, title: beat.title, asset: beat.illustrationAsset }}
    progress={{ current: Math.min(beatPath.length, story.typicalPathLength), total: story.typicalPathLength }} rewards={rewards}
    actions={moodActions} showJoin={phase === 'lobby'} joinLabel={t('开始', 'Start')} onJoin={beginWarmup}
    showMic={phase === 'story' || phase === 'recast'} recording={recorder.recording} onStart={recorder.start} onStop={recorder.stop}
    onRepeat={() => void repeatQuestion()} onHint={() => void giveHint()} onAdvance={() => void mercyAdvance()} onEnd={() => finishStory('researcher_end')}
    onRecover={phase === 'audioProblem' ? () => void recoverAudio() : undefined}
    onClear={() => { clearLocalResearchData(); onClose() }}
  />
}

function ImaginativePlaySession({ config, onClose, onComplete }: { config: SessionConfig; onClose: () => void; onComplete: (data: CompletionData) => void }) {
  const [state, setState] = useState<ConversationState>('join')
  const [headline, setHeadline] = useState(languageText('准备好创造一个新冒险了吗？', 'Ready to create a new adventure?', config.language))
  const [destination, setDestination] = useState<PlayDestination>()
  const [choosing, setChoosing] = useState(false)
  const [turn, setTurn] = useState(0)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [sessionID, setSessionID] = useState<string>()
  const runID = useRef(0)
  const eventsRef = useRef(events)
  const lastLine = useRef('')
  const t = (zh: string, en: string) => languageText(zh, en, config.language)
  const addEvent = (type: string, payload: Record<string, unknown> = {}) => {
    const next = [...eventsRef.current, { sequence: eventsRef.current.length + 1, type, occurredAt: new Date().toISOString(), payload }]
    eventsRef.current = next; setEvents(next)
  }

  useEffect(() => {
    startResearchSession({ mode: 'play', language: config.language, visualCondition: config.visualCondition, label: config.sessionLabel || undefined }).then((result) => setSessionID(result.sessionID)).catch(() => undefined)
    addEvent('session_started', { mode: 'play', condition: { language: config.language, visual: config.visualCondition } })
    return () => { runID.current += 1; stopVoice() }
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
    const current = ++runID.current; lastLine.current = text; setState('speaking'); setHeadline(text)
    await speak(text, config.language, cueID)
    if (current === runID.current) setState('ready')
  }
  async function join() {
    await say(t('嗨！今天我们想去哪里冒险？', 'Hi! Where should we adventure today?'), cueForLanguage('imagine_welcome', config.language))
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
    await say(line)
    if (nextTurn >= 12) finish('turn_limit', nextTurn)
  }
  function finish(reason = 'completed', completedTurns = turn) {
    playEarcon('complete')
    const finalEvents = [...eventsRef.current, { sequence: eventsRef.current.length + 1, type: 'session_ended', occurredAt: new Date().toISOString(), payload: { reason, turns: completedTurns } }]
    onComplete({ mode: 'play', title: t('假装游戏', 'Imaginative Play'), config, rewards: [], vocabulary: destination?.vocabulary ?? [], events: finalEvents, sessionID })
  }
  const recorder = usePushToTalk({ language: config.language, storyID: 'imaginative-play', beatID: destination?.id ?? 'choose', onStart: () => { interrupt(); setState('listening') }, onProcessing: () => setState('thinking'), onTranscript: handleSpeech, onError: async () => { await say(t('我没有听清，请再说一次。', 'I didn’t hear you. Please try again.')) }, onMetric: (metric) => addEvent('transcription_completed', { turn, ...metric }) })
  const actions = choosing ? playDestinations.map((place) => ({ label: config.language === 'chinese' ? place.zh : place.en, onClick: () => void choose(place) })) : []
  const status = state === 'listening' ? t('我在听', 'I’m listening') : state === 'thinking' ? t('想一想', 'Thinking') : state === 'paused' ? t('已暂停', 'Paused') : ''
  return <ConversationRoom title={t('假装游戏', 'Imaginative Play')} language={config.language} state={state} status={status} headline={headline} subtitle="" visualCondition="voice" actions={actions} showJoin={state === 'join'} joinLabel={t('开始', 'Start')} onJoin={join} showMic={Boolean(destination)} recording={recorder.recording} onStart={recorder.start} onStop={recorder.stop} ideaLabel={destination ? t('帮我想', 'Give me an idea') : undefined} onIdea={destination ? () => void say(playText(destination, 'idea', config.language, turn)) : undefined} onRepeat={() => void say(lastLine.current)} onHint={destination ? () => void say(playText(destination, 'idea', config.language, turn)) : undefined} onAdvance={() => finish('researcher_advance')} onEnd={() => finish('researcher_end')} onClear={() => { clearLocalResearchData(); onClose() }} />
}

interface RoomAction { label: string; onClick: () => void }
interface SceneInfo { emoji: string; title: string; asset: string }

function ConversationRoom({ title, language, state, status, headline, subtitle, question = '', visualCondition, scene, progress, rewards = [], actions = [], showJoin, joinLabel, onJoin, showMic, recording, onStart, onStop, ideaLabel, onIdea, onRepeat, onHint, onAdvance, onEnd, onClear, onRecover }: {
  title: string; language: LessonLanguage; state: ConversationState; status: string; headline: string; subtitle: string; question?: string; visualCondition: SessionConfig['visualCondition']; scene?: SceneInfo; progress?: { current: number; total: number }; rewards?: Reward[]; actions?: RoomAction[]; showJoin: boolean; joinLabel: string; onJoin: () => void; showMic: boolean; recording: boolean; onStart: () => void; onStop: () => void; ideaLabel?: string; onIdea?: () => void; onRepeat: () => void; onHint?: () => void; onAdvance: () => void; onEnd: () => void; onClear: () => void; onRecover?: () => void
}) {
  const [drawer, setDrawer] = useState(false)
  const longPress = useRef<number | undefined>(undefined)
  const orbState: OrbState = state === 'speaking' ? 'speaking' : state === 'listening' ? 'listening' : state === 'thinking' ? 'thinking' : state === 'paused' ? 'paused' : 'idle'
  const beginLongPress = () => { longPress.current = window.setTimeout(() => setDrawer(true), 700) }
  const cancelLongPress = () => { if (longPress.current) window.clearTimeout(longPress.current) }
  return <main className={`room room-${visualCondition}`}>
    <header className="room-header">
      <button className="room-brand" onPointerDown={beginLongPress} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress}><span>CHOOCHOO</span><small>{title}</small></button>
      {progress && <div className="session-progress" aria-label={`${progress.current} / ${progress.total}`}><div className="progress-dots">{Array.from({ length: progress.total }, (_, index) => <i key={index} className={index < progress.current ? 'filled' : ''} />)}</div>{visualCondition === 'pictures' && <div className="sticker-shelf">{rewards.slice(-5).map((reward) => <span key={reward.id} title={reward.zh}>{reward.emoji}</span>)}</div>}</div>}
    </header>
    <section className="room-stage">
      {visualCondition === 'pictures' && scene ? <SceneVisual scene={scene} /> : <ConversationOrb state={orbState} />}
      <div className="room-copy" aria-live="polite">{status && <p className="room-state">{status}</p>}<h1>{headline}</h1>{subtitle && <p className="subtitle">{subtitle}</p>}{question && <p className="question-reminder">{language === 'chinese' ? '问题' : 'Question'}：{question}</p>}</div>
      {actions.length > 0 && <div className="choice-row">{actions.map((action) => <button key={action.label} onClick={action.onClick}>{action.label}</button>)}</div>}
      {showJoin && <button className="join-button" onClick={onJoin}>{joinLabel}</button>}
    </section>
    <footer className="room-footer">
      {showMic && <button className={recording ? 'mic-button active' : 'mic-button'} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onStart() }} onPointerUp={onStop} onPointerCancel={onStop} aria-label={language === 'chinese' ? '按住说话' : 'Hold to talk'}><MicIcon /><span>{recording ? language === 'chinese' ? '松开' : 'Release' : language === 'chinese' ? '按住说话' : 'Hold to talk'}</span></button>}
      {ideaLabel && onIdea && <button className="idea-button" onClick={onIdea}>{ideaLabel}</button>}
    </footer>
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
    <section className="completion-card"><span className="wordmark">CHOOCHOO</span><h1>{t('今天玩得真棒。', 'You did a wonderful job today.')}</h1>
      {data.rewards.length > 0 && <div className="completion-stickers">{data.rewards.slice(-5).map((reward) => <span key={reward.id}>{reward.emoji}</span>)}</div>}
      <div className="vocabulary-review"><h2>{t('下次可以再练', 'Words to practice next time')}</h2>{data.vocabulary.length ? <ul>{data.vocabulary.map((word) => <li key={word.id}><strong>{word.zh}</strong><span>{word.pinyin}</span><span>{word.en}</span></li>)}</ul> : <p>{t('今天没有需要特别复习的词。', 'No words need extra practice today.')}</p>}</div>
      {!answered ? <div className="play-again"><p>{t('还想再玩一次吗？', 'Would you like to play again?')}</p><div><button className="primary-action" onClick={() => answerAgain(true)}>{t('再玩一次', 'Play again')}</button><button className="secondary-action" onClick={() => answerAgain(false)}>{t('今天到这里', 'All done')}</button></div></div> : null}
      <button className="download-link" onClick={download}>下载测试记录</button>
    </section>
  </main>
}

function usePushToTalk({ language, storyID, beatID, onStart, onProcessing, onTranscript, onError, onMetric }: { language: LessonLanguage; storyID: string; beatID: string; onStart: () => void; onProcessing: () => void; onTranscript: (text: string) => Promise<void>; onError: () => void | Promise<void>; onMetric?: (metric: { audioDurationMs: number; transcriptionLatencyMs: number }) => void }) {
  const [recording, setRecording] = useState(false)
  const recorder = useRef<MediaRecorder | undefined>(undefined)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const pressed = useRef(false)
  const activeStream = useRef<MediaStream | undefined>(undefined)
  const latest = useRef({ language, storyID, beatID, onTranscript, onError, onProcessing, onMetric })
  useEffect(() => { latest.current = { language, storyID, beatID, onTranscript, onError, onProcessing, onMetric } }, [language, storyID, beatID, onTranscript, onError, onProcessing, onMetric])
  useEffect(() => () => {
    pressed.current = false
    if (recorder.current?.state === 'recording') {
      recorder.current.ondataavailable = null
      recorder.current.onstop = null
      recorder.current.stop()
    }
    activeStream.current?.getTracks().forEach((track) => track.stop())
  }, [])
  async function start() {
    if (recording) return
    pressed.current = true
    try {
      onStart()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      activeStream.current = stream
      const preferred = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const media = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
      recorder.current = media; chunks.current = []; startedAt.current = performance.now()
      media.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop()); activeStream.current = undefined; setRecording(false); playEarcon('stop')
        latest.current.onProcessing()
        const submittedAt = performance.now()
        const audioDurationMs = Math.round(submittedAt - startedAt.current)
        const thinkingTimer = window.setTimeout(() => playEarcon('thinking'), 1_200)
        const audio = new Blob(chunks.current, { type: media.mimeType || 'audio/webm' })
        try {
          const context = latest.current
          const result = await transcribeAudio(audio, { language: context.language, storyID: context.storyID, beatID: context.beatID, durationMs: String(audioDurationMs) })
          window.clearTimeout(thinkingTimer); context.onMetric?.({ audioDurationMs, transcriptionLatencyMs: Math.round(performance.now() - submittedAt) }); await context.onTranscript(result.transcript)
        } catch { window.clearTimeout(thinkingTimer); await latest.current.onError() }
      }
      media.start(); setRecording(true); playEarcon('listen')
      if (!pressed.current) media.stop()
    } catch { activeStream.current?.getTracks().forEach((track) => track.stop()); activeStream.current = undefined; setRecording(false); await onError() }
  }
  function stop() { pressed.current = false; if (recorder.current?.state === 'recording') recorder.current.stop() }
  return { recording, start, stop }
}

function detectVoiceCommand(source: string): VoiceCommand {
  const value = source.toLowerCase().replace(/[，。！？,.!?\s]/g, '')
  if (/暂停|停一下|等等|等一下|别说了|pause|stop|wait/.test(value)) return 'pause'
  if (/结束|再见|不玩了|拜拜|goodbye|bye|all(done|finished)/.test(value)) return 'end'
  if (/继续|接着说|继续讲|continue|resume/.test(value)) return 'continue'
  if (/重复问题|再问一遍|问题是什么|questionagain/.test(value)) return 'question'
  if (/再说一遍|重新讲|重讲|重复|再来|repeat|again|redo/.test(value)) return 'repeat'
  if (/提示|帮帮我|英文提示|hint|help/.test(value)) return 'hint'
  return null
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
