import { useEffect, useState } from 'react'
import { catalog, languageText } from './content'
import { savedCollections, savedProgress } from './progress'
import { earnedPuzzlePieceCount, puzzleLayout, savedPuzzleLayout, storyProgressPercentage } from './puzzle'
import { PuzzleSeams } from './StoryPuzzle'
import { playIntro } from './playContent'
import { VoiceStoryPicker } from './VoiceStoryPicker'
import type { SessionConfig } from './session'
import type { LessonLanguage, Story } from './types'
import './Dashboard.css'

export function PuzzleArtwork({ story, language, decorative = false }: { story: Story; language: LessonLanguage; decorative?: boolean }) {
  const [failed, setFailed] = useState(false)
  const alt = languageText(story.puzzle.altText, story.puzzle.englishAltText, language)
  return failed
    ? <span className="collection-art-fallback" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : alt} aria-hidden={decorative || undefined}>{story.coverEmoji}</span>
    : <img src={`/illustrations/${encodeURIComponent(story.puzzle.imageAsset)}.png`} alt={decorative ? '' : alt} loading="lazy" decoding="async" width="1200" height="750" onError={() => setFailed(true)} />
}

export function Dashboard({ config, onLanguage, onSettings, onStory, onVoiceStory, onPlay, onInspect }: {
  config: SessionConfig; onLanguage: (language: LessonLanguage) => void; onSettings: () => void
  onStory: (story: Story) => void; onVoiceStory: (story: Story) => void; onPlay: () => void; onInspect: (story: Story) => void
}) {
  const [, refresh] = useState(0)
  useEffect(() => {
    const update = () => refresh(value => value + 1)
    window.addEventListener('choochoo-progress', update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener('choochoo-progress', update); window.removeEventListener('storage', update) }
  }, [])
  const { language } = config
  const t = (zh: string, en: string) => languageText(zh, en, language)
  const collection = new Set(savedCollections().filter(item => item.language === language).map(item => item.storyID))
  const unlocked = catalog.stories.filter(story => collection.has(story.id)).length
  const count = catalog.stories.length
  return <>
    <header className="home-header dashboard-header">
      <span className="wordmark">CHOOCHOO</span>
      <div className="dashboard-header-actions">
        <div className="segmented" role="group" aria-label={t('对话语言', 'Conversation language')}>
          {(['chinese', 'english'] as const).map(value => <button key={value} className={value === language ? 'selected' : ''} aria-pressed={value === language} onClick={() => onLanguage(value)}>{value === 'chinese' ? '中文' : 'English'}</button>)}
        </div>
        <button className="secondary-action" onClick={onSettings}>{t('设置', 'Settings')}</button>
      </div>
    </header>
    <div className="dashboard-layout">
      <section className="dashboard-welcome" aria-labelledby="dashboard-title">
        <div><p className="eyebrow">{t('听一听，说一说', 'A little time to wonder')}</p><h1 id="dashboard-title">{t('今天，去哪里冒险？', 'Where shall we go today?')}</h1><p className="dashboard-intro">{t('一个故事，一幅慢慢拼好的小惊喜。', 'A little story. A picture to piece together.')}</p></div>
        <div className="collection-summary">
          <span className="summary-symbol" aria-hidden="true">✧</span>
          <div><p id="collection-progress-label">{t('你的拼图收藏', 'Your puzzle collection')}</p><strong>{t(`已解锁 ${unlocked}/${count} 幅`, `${unlocked} of ${count} unlocked`)}</strong></div>
          <progress aria-labelledby="collection-progress-label" value={unlocked} max={count} />
          <small>{t('每个故事，都有一份惊喜。', 'A keepsake from every adventure.')}</small>
        </div>
      </section>
      <VoiceStoryPicker language={language} onStory={onVoiceStory} />
      <section className="story-shelf" aria-labelledby="story-shelf-title">
        <div className="dashboard-section-heading"><h2 id="story-shelf-title">{t('你的故事', 'Your stories')}</h2><span>{t('选一个喜欢的，开始吧。', 'Pick a story and make it yours.')}</span></div>
        <div className="mode-grid dashboard-story-grid">
          {catalog.stories.map((story, index) => {
            const progress = savedProgress(story.id, language)
            const earned = earnedPuzzlePieceCount(progress?.completedCheckpoints ?? [], story.typicalPathLength)
            const percentage = storyProgressPercentage(progress?.completedCheckpoints ?? [], story.typicalPathLength)
            const collected = collection.has(story.id)
            const action = progress?.completed ? t('再听一次', 'Replay story') : progress ? t('继续故事', 'Continue story') : t('开始故事', 'Start story')
            const title = languageText(story.title, story.englishTitle, language)
            const pieceLabel = t(`${earned}/${story.typicalPathLength} 块拼图`, `${earned} of ${story.typicalPathLength} pieces`)
            const progressLabel = t(`已完成 ${percentage}%`, `${percentage}% complete`)
            return <button className="mode-card dashboard-story-card" key={story.id} data-story-id={story.id} onClick={() => onStory(story)} aria-label={`${title}. ${progressLabel}. ${pieceLabel}. ${collected ? t('已收藏。', 'Puzzle collected. ') : ''}${action}`}>
              <span className="story-card-top"><span className={`story-emoji story-tint-${index}`} aria-hidden="true">{story.coverEmoji}</span><span className="story-duration">{story.estimatedMinutes} {t('分钟', 'min')}</span></span>
              <strong className="story-card-title">{title}</strong>
              <span className="story-piece-label"><span className="story-percentage">{progressLabel}</span>{collected && <span className="collected-badge">{t('已收藏', 'Puzzle collected')}</span>}</span>
              <span className="story-card-track" aria-hidden="true"><span style={{ width: `${percentage}%` }} /></span>
              <span className="story-card-action">{action}<span aria-hidden="true">↗</span></span>
            </button>
          })}
          <button className="mode-card play-card dashboard-play-card" onClick={onPlay}><span className="play-symbol" aria-hidden="true">✧</span><span><strong>{t(playIntro.title.zh, playIntro.title.en)}</strong><span className="play-description">{t('你的点子，让故事更有趣。', 'A new adventure, made from your ideas.')}</span></span><span aria-hidden="true">↗</span></button>
        </div>
      </section>
      <section className="collection-section" aria-labelledby="collection-title">
        <div className="dashboard-section-heading"><h2 id="collection-title">{t('我的拼图收藏', 'My puzzle collection')}</h2><span>{t('故事结束，惊喜留下。', 'Little adventures. Lovely keepsakes.')}</span></div>
        <div className="collection-grid">
          {catalog.stories.map((story, index) => {
            const collected = collection.has(story.id)
            const earned = earnedPuzzlePieceCount(savedProgress(story.id, language)?.completedCheckpoints ?? [], story.typicalPathLength)
            const inProgress = !collected && earned > 0
            const layout = puzzleLayout(savedPuzzleLayout(story.id, language), story.typicalPathLength)
            const pieces = inProgress ? layout.slice(0, earned) : []
            const pieceLabel = t(`${earned}/${story.typicalPathLength} 块拼图`, `${earned} of ${story.typicalPathLength} pieces`)
            const title = languageText(story.title, story.englishTitle, language)
            const unlock = t(`听故事 ${index + 1} 来解锁`, `Play story ${index + 1} to unlock`)
            return <button key={story.id} className={`collection-card ${collected ? 'is-collected' : 'is-locked'}${inProgress ? ' is-in-progress' : ''}`} data-story-id={story.id} onClick={() => collected ? onInspect(story) : onStory(story)} aria-label={`${title}. ${collected ? t('查看已收藏的拼图', 'View collected puzzle') : inProgress ? `${t('继续故事', 'Continue story')}. ${pieceLabel}` : unlock}`}>
              <span className="collection-cover"><PuzzleArtwork story={story} language={language} decorative />{pieces.map((piece, index) => <span className="collection-piece-reveal" key={index} style={{clipPath: piece.clipPath}} aria-hidden="true"><PuzzleArtwork story={story} language={language} decorative /></span>)}<PuzzleSeams pieces={layout} />{!collected && !inProgress && <span className="collection-lock-copy">{unlock}</span>}</span>
              <strong>{title}</strong><span className="collection-state">{collected ? t('✓ 已收藏', '✓ Collected') : inProgress ? `${pieceLabel} · ${t('继续故事', 'Continue story')}` : t('等你来发现', 'Waiting to be discovered')}</span>
            </button>
          })}
        </div>
      </section>
    </div>
  </>
}
