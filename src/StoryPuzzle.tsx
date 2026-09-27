import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { puzzleLayout, type PuzzleLayoutID, type PuzzlePieceLayout } from './puzzle'
import { puzzleViewBox } from './jigsawGeometry'
import type { LessonLanguage } from './types'

export interface PuzzleFinaleData {
  storyID: string
  imageAsset: string
  altText: string
  englishAltText: string
  celebrationText: string
  englishCelebrationText: string
  coverEmoji: string
  earnedPieces: number
  totalPieces: number
  layoutID: PuzzleLayoutID
  completed: boolean
}

/** Non-scaling seams keep the individual jigsaw shapes visible at gallery size. */
export function PuzzleSeams({ pieces }: { pieces: PuzzlePieceLayout[] }) {
  return <svg className="puzzle-seams" viewBox={puzzleViewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {pieces.map((piece, index) => <path key={index} d={piece.path} vectorEffect="non-scaling-stroke" />)}
  </svg>
}

export function PuzzleTray({ earned, total, language }: { earned: number; total: number; language: LessonLanguage }) {
  const status = language === 'chinese' ? `拼图 ${earned}/${total}` : `Puzzle ${earned}/${total}`
  return <div className="puzzle-tray" aria-label={status}>
    <div className="puzzle-tray-pieces" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => <i key={index} className={index < earned ? index === earned - 1 ? 'earned newest' : 'earned' : ''} />)}
    </div>
    <span aria-hidden="true">{earned}/{total}</span>
    <span className="sr-only" aria-live="polite">{status}</span>
  </div>
}

/** Existing pieces stay put; newly earned pieces animate once as they mount. */
export function StoryPuzzlePicture({ puzzle, language, animateNewPieces = false }: { puzzle: PuzzleFinaleData; language: LessonLanguage; animateNewPieces?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false)
  const [initialPieces] = useState(puzzle.earnedPieces)
  const pieces = puzzleLayout(puzzle.layoutID, puzzle.totalPieces)
  const alt = language === 'chinese' ? puzzle.altText : puzzle.englishAltText
  const progress = language === 'chinese' ? `已拼好 ${puzzle.earnedPieces}/${puzzle.totalPieces} 块` : `${puzzle.earnedPieces} of ${puzzle.totalPieces} pieces placed`
  return <figure className={animateNewPieces ? 'story-puzzle-picture' : 'puzzle-finale assembled'}>
    <img className="puzzle-image-probe" src={`/illustrations/${encodeURIComponent(puzzle.imageAsset)}.png`} alt="" onError={() => setImageFailed(true)} />
    <div className="puzzle-board" role="img" aria-label={`${progress}. ${alt}`}>
      {pieces.map((piece, index) => <i key={index} className="puzzle-slot" style={{ clipPath: piece.clipPath }} />)}
      <PuzzleSeams pieces={pieces} />
      {pieces.slice(0, puzzle.earnedPieces).map((piece, index) => {
        const style = {
          '--puzzle-image': `url("/illustrations/${encodeURIComponent(puzzle.imageAsset)}.png")`,
          '--piece-clip': piece.clipPath,
          '--piece-x': `${piece.startX}%`,
          '--piece-y': `${piece.startY}%`,
          '--piece-rotation': `${piece.startRotation}deg`,
          '--piece-delay': '0ms',
          transformOrigin: `${piece.originX}% ${piece.originY}%`,
        } as CSSProperties
        const animated = animateNewPieces && index >= initialPieces && index === puzzle.earnedPieces - 1
        return <i className={`puzzle-piece ${animated ? 'piece-entering' : 'piece-placed'}`} style={style} key={index}>
          {imageFailed && <span className="puzzle-fallback"><span>{puzzle.coverEmoji}</span></span>}
          <PuzzleSeams pieces={[piece]} />
        </i>
      })}
    </div>
    {animateNewPieces && <figcaption>{progress}</figcaption>}
  </figure>
}

export function PuzzleFinale({ puzzle, language, onAssembled }: { puzzle: PuzzleFinaleData; language: LessonLanguage; onAssembled: () => void }) {
  const reported = useRef(false)
  useEffect(() => {
    if (reported.current) return
    reported.current = true
    onAssembled()
  }, [onAssembled])
  return <StoryPuzzlePicture puzzle={puzzle} language={language} />
}
