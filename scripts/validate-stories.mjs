import { access, readFile } from 'node:fs/promises'

const catalog = JSON.parse(await readFile(new URL('../src/data/stories.json', import.meta.url), 'utf8'))
const errors = []
const storyIDs = new Set()
const sfxIDs = new Set()
const menuDirections = /选一个|请选择|从(?:下面|以下)|以下选项|\b(?:pick|choose|select) (?:any|one)\b|\bwhich one\b|\boptions below\b/iu

for (const item of catalog.sfxManifest || []) {
  if (!item.id || sfxIDs.has(item.id)) errors.push(`duplicate or empty SFX id: ${item.id || '(empty)'}`)
  sfxIDs.add(item.id)
}

for (const story of catalog.stories || []) {
  if (!story.id || storyIDs.has(story.id)) errors.push(`duplicate or empty story id: ${story.id || '(empty)'}`)
  storyIDs.add(story.id)
  const beats = new Map()
  if (!story.startBeatId || !Array.isArray(story.beats) || story.beats.length < 3) errors.push(`${story.id}: needs a start beat and at least three beats`)
  const puzzle = story.puzzle
  if (!puzzle || !/^[a-z0-9_-]+$/i.test(puzzle.imageAsset || '') || !puzzle.altText || !puzzle.englishAltText || !puzzle.celebrationText || !puzzle.englishCelebrationText) {
    errors.push(`${story.id}: missing complete bilingual puzzle metadata`)
  } else {
    try { await access(new URL(`../public/illustrations/${puzzle.imageAsset}.png`, import.meta.url)) }
    catch { errors.push(`${story.id}: missing puzzle image ${puzzle.imageAsset}.png`) }
  }
  for (const beat of story.beats || []) {
    if (!beat.id || beats.has(beat.id)) errors.push(`${story.id}: duplicate or empty beat ${beat.id || '(empty)'}`)
    beats.set(beat.id, beat)
  }
  if (!beats.has(story.startBeatId)) errors.push(`${story.id}: start beat does not exist`)

  for (const beat of story.beats || []) {
    const checkpoint = beat.checkpoint
    const location = `${story.id}/${beat.id}`
    if (!beat.narration || !beat.englishNarration || !beat.audioCue) errors.push(`${location}: missing bilingual narration or audio cue`)
    if (!checkpoint?.id || !checkpoint.question || !checkpoint.englishQuestion || !checkpoint.recast) errors.push(`${location}: missing checkpoint copy`)
    const spokenCopy = [beat.narration, beat.englishNarration, checkpoint?.question, checkpoint?.englishQuestion, checkpoint?.recast, checkpoint?.successLine,
      ...(checkpoint?.hints || []).map((hint) => hint.text), ...(checkpoint?.branches || []).map((branch) => branch.transitionLine)]
    if (spokenCopy.some((line) => menuDirections.test(String(line)))) errors.push(`${location}: spoken copy contains a menu-style direction`)
    if (!['comprehension', 'choice', 'open'].includes(checkpoint?.kind)) errors.push(`${location}: invalid checkpoint kind`)
    if (!Array.isArray(checkpoint?.hints) || checkpoint.hints.length !== 4 || checkpoint.hints.some((hint, index) => hint.level !== index + 1 || !hint.text)) errors.push(`${location}: must have exactly four ordered hints`)
    if (!Array.isArray(checkpoint?.concepts) || checkpoint.concepts.length < 1) errors.push(`${location}: missing answer concepts`)
    if (checkpoint?.sufficientConceptIDs && (!Array.isArray(checkpoint.sufficientConceptIDs) || checkpoint.sufficientConceptIDs.length === 0 || checkpoint.sufficientConceptIDs.some(id => !checkpoint.concepts.some(concept => concept.id === id)))) errors.push(`${location}: invalid sufficient concept IDs`)
    if (checkpoint?.knownAnswerPhrases && (!Array.isArray(checkpoint.knownAnswerPhrases) || checkpoint.knownAnswerPhrases.length === 0 || checkpoint.knownAnswerPhrases.some(phrase => typeof phrase !== 'string' || !phrase.trim()))) errors.push(`${location}: invalid known answer phrases`)
    if (!checkpoint?.reward?.id || !checkpoint.reward.emoji) errors.push(`${location}: missing reward`)
    if (beat.nextBeatId && !beats.has(beat.nextBeatId)) errors.push(`${location}: unknown next beat ${beat.nextBeatId}`)
    for (const branch of checkpoint?.branches || []) {
      if (!beats.has(branch.nextBeatId)) errors.push(`${location}: unknown branch target ${branch.nextBeatId}`)
      if (!checkpoint.concepts.some((concept) => concept.id === branch.conceptId)) errors.push(`${location}: branch ${branch.id} references an unknown concept`)
    }
    if (checkpoint?.kind === 'choice') {
      if (!Array.isArray(checkpoint.branches) || checkpoint.branches.length < 2) errors.push(`${location}: choice needs at least two branches`)
      if (!checkpoint.branches.some((branch) => branch.id === checkpoint.defaultBranchId)) errors.push(`${location}: choice default branch does not resolve`)
    }
    const referencedSFX = [...(beat.soundEffects || []), ...(checkpoint?.successSfx || []), checkpoint?.reward].filter(Boolean).map((item) => item.sfxId).filter(Boolean)
    for (const sfxID of referencedSFX) if (!sfxIDs.has(sfxID)) errors.push(`${location}: unknown SFX ${sfxID}`)
  }

  if (beats.has(story.startBeatId)) {
    const pathLengths = []
    const walk = (beatID, visited = []) => {
      if (visited.includes(beatID)) { errors.push(`${story.id}: cycle detected at ${beatID}`); return }
      if (visited.length >= 10) { errors.push(`${story.id}: path exceeds 10 beats`); return }
      const beat = beats.get(beatID)
      if (!beat) return
      const targets = beat.checkpoint?.branches?.length ? beat.checkpoint.branches.map((branch) => branch.nextBeatId) : beat.nextBeatId ? [beat.nextBeatId] : []
      if (!targets.length) { pathLengths.push(visited.length + 1); return }
      for (const target of new Set(targets)) walk(target, [...visited, beatID])
    }
    walk(story.startBeatId)
    if (pathLengths.some((length) => length !== story.typicalPathLength)) errors.push(`${story.id}: path lengths ${[...new Set(pathLengths)].join(', ')} do not match typicalPathLength ${story.typicalPathLength}`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`Validated ${catalog.stories.length} ChooChoo stories, every branch path, and ${sfxIDs.size} sound identifiers.`)
