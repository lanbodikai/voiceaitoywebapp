import { useEffect, useRef, useState } from 'react'
import { catalog, languageText } from './content'
import { storyFromSpeech } from './storySelection'
import { savedProgress } from './progress'
import pickerLines from './data/voice-picker-lines.json'
import { useHandsFree } from './useHandsFree'
import { preloadFixedSpeech, speak, stopVoice } from './audio'
import type { LessonLanguage, Story } from './types'

type Stage = 'off' | 'starting' | 'speaking' | 'ready' | 'listening' | 'thinking'

export function VoiceStoryPicker({ language, onStory }: { language: LessonLanguage; onStory: (story: Story) => void }) {
  const [stage, setStage] = useState<Stage>('off')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const prompts = useRef(0)
  const connectedLanguage = useRef(language)
  const t = (zh: string, en: string) => languageText(zh, en, language)
  const prompt = t(pickerLines.prompt.zh, pickerLines.prompt.en)
  const choices = t(pickerLines.choices.zh, pickerLines.choices.en)
  useEffect(() => preloadFixedSpeech(prompt, language), [prompt, language])
  useEffect(() => preloadFixedSpeech(choices, language), [choices, language])

  async function ask(line = prompt) {
    const turn = ++generation.current
    setStage('speaking')
    if (!await speak(line, language) || generation.current !== turn) return
    setStage('ready')
  }

  function choose(story: Story) {
    generation.current += 1
    recorder.disable(false)
    stopVoice()
    onStory(story)
  }

  const suggestedStory = () => catalog.stories.find(story => !savedProgress(story.id, language)?.completed) ?? catalog.stories[0]

  const recorder = useHandsFree({
    language, storyID: 'story-picker', beatID: 'choose', allowed: stage === 'ready' || stage === 'listening',
    onStart: () => { prompts.current = 0; setStage('listening') },
    onProcessing: () => setStage('thinking'),
    onTranscript: async (speech, current) => {
      if (!current()) return
      const match = storyFromSpeech(speech, catalog.stories)
      if (match === 'surprise') { choose(suggestedStory()); return }
      if (match) { choose(match); return }
      prompts.current = 1
      await ask(choices)
    },
    onError: () => { setError(t('麦克风连接中断。请再试一次。', 'The microphone disconnected. Please try again.')); setStage('off') },
    onFalseStart: () => setStage('ready'),
    onMuted: () => setStage('off'),
  })

  useEffect(() => () => { generation.current += 1; recorder.disable(false); stopVoice() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (connectedLanguage.current === language) return
    connectedLanguage.current = language
    generation.current += 1; recorder.disable(false); stopVoice(); setStage('off'); prompts.current = 0
  }, [language, recorder])

  useEffect(() => {
    if (stage !== 'ready' || !recorder.enabled) return
    const timer = window.setTimeout(() => {
      if (prompts.current++ === 0) void ask(choices)
      else choose(suggestedStory())
    }, prompts.current === 0 ? 6_000 : 12_000)
    return () => window.clearTimeout(timer)
  })

  async function toggle() {
    if (recorder.enabled) { generation.current += 1; recorder.disable(false); stopVoice(); setStage('off'); return }
    const opening = ++generation.current
    setError(''); setStage('starting')
    if (!await recorder.enable()) { if (generation.current === opening) setStage('off'); return }
    if (generation.current !== opening) { recorder.disable(false); return }
    prompts.current = 0
    await ask()
  }

  const status = stage === 'ready' ? t('我在听，直接说故事名字。', 'I’m listening. Say a story name.')
    : stage === 'starting' ? t('正在打开麦克风…', 'Opening the microphone…')
      : stage === 'speaking' ? t('ChooChoo 在介绍故事…', 'ChooChoo is naming the stories…')
        : stage === 'listening' ? t('我在听…', 'I’m listening…')
          : stage === 'thinking' ? t('正在寻找故事…', 'Finding your story…')
            : t('按一下，之后就能用声音选故事。', 'Tap once, then choose a story by voice.')
  return <section className="voice-story-picker" aria-label={t('用声音选故事', 'Choose a story by voice')}>
    <div><strong>{t('用声音选故事', 'Choose by voice')}</strong><p role="status">{status}</p>{error && <p className="inline-error" role="alert">{error}</p>}</div>
    <button className="primary-action" onClick={() => void toggle()} disabled={stage === 'starting'} aria-pressed={recorder.enabled}>{recorder.enabled ? t('关闭麦克风', 'Turn mic off') : t('打开麦克风，开始选故事', 'Turn on mic and choose')}</button>
  </section>
}
