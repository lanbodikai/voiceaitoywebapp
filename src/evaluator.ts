import type { Checkpoint, Evaluation, LessonLanguage } from './types'

const replacements: Record<string, string> = {
  種: '种', 籽: '子', 發: '发', 現: '现', 顆: '颗', 會: '会', 裡: '里', 裏: '里',
  葉: '叶', 讓: '让', 螢: '萤', 蟲: '虫', 幫: '帮', 這: '这', 個: '个', 麼: '么',
  開: '开', 來: '来', 還: '还', 點: '点', 帶: '带', 麗: '丽', 攪: '搅', 麵: '面',
  樂: '乐', 們: '们', 為: '为', 慶: '庆', 紅: '红', 進: '进', 門: '门', 燭: '烛',
  寫: '写', 滿: '满', 張: '张', 然後: '然后', 嗯: '', 呃: '', 那个: '', 就是: '',
}

export function normalize(source: string) {
  let value = source.toLocaleLowerCase('zh-CN').normalize('NFKD')
  for (const [from, to] of Object.entries(replacements)) value = value.replaceAll(from, to)
  return Array.from(value).filter((character) => /[\p{L}\p{N}]/u.test(character)).join('')
}

export function detectLanguage(normalized: string): Evaluation['language'] {
  const hasHan = /\p{Script=Han}/u.test(normalized)
  const hasLatin = /[a-z]/i.test(normalized)
  if (hasHan && hasLatin) return 'mixed'
  if (hasHan) return 'chinese'
  if (hasLatin) return 'english'
  return 'unknown'
}

export function evaluateLocal(transcript: string, checkpoint: Checkpoint, targetLanguage: LessonLanguage): Evaluation {
  const value = normalize(transcript)
  const language = detectLanguage(value)
  if (!value) return { verdict: 'unusable', language, matchedConcepts: [], confidence: 0.1 }

  const matches = checkpoint.concepts.map((concept) => {
    const chinese = [...concept.zh, ...concept.homophones].map(normalize).some((term) => value.includes(term))
    const english = concept.en.map(normalize).some((term) => value.includes(term))
    return { id: concept.id, chinese, english, matched: chinese || english }
  })
  const matchedConcepts = matches.filter((match) => match.matched).map((match) => match.id)
  const allMatched = matches.every((match) => match.matched)
  const targetMatched = matches.every((match) => targetLanguage === 'chinese' ? match.chinese : match.english)
  const related = checkpoint.relatedTerms.map(normalize).some((term) => value.includes(term))
  const knownWrong = checkpoint.knownWrongTerms.map(normalize).some((term) => value.includes(term))

  if (checkpoint.kind === 'open') return { verdict: 'correct', language, matchedConcepts, confidence: 0.95 }
  if (checkpoint.kind === 'choice') {
    const targetChoice = matches.some((match) => targetLanguage === 'chinese' ? match.chinese : match.english)
    if (targetChoice) return { verdict: 'correct', language, matchedConcepts, confidence: 0.99 }
    if (matches.some((match) => match.matched)) return { verdict: 'meaningUnderstood', language, matchedConcepts, confidence: 0.96 }
    if (knownWrong) return { verdict: 'incorrect', language, matchedConcepts, confidence: 0.98 }
    if (related) return { verdict: 'uncertain', language, matchedConcepts, confidence: 0.55 }
    return { verdict: value.length <= 3 && !/[a-z]/i.test(value) ? 'unusable' : 'offTopic', language, matchedConcepts, confidence: 0.9 }
  }
  if (allMatched && targetMatched) return { verdict: 'correct', language, matchedConcepts, confidence: 0.99 }
  if (allMatched) return { verdict: 'meaningUnderstood', language, matchedConcepts, confidence: 0.96 }
  if (knownWrong && matchedConcepts.length === 0) return { verdict: 'incorrect', language, matchedConcepts, confidence: 0.98 }
  if (matchedConcepts.length > 0 || related) return { verdict: 'uncertain', language, matchedConcepts, confidence: 0.55 }
  if (value.length <= 3 && !/[a-z]/i.test(value)) return { verdict: 'unusable', language, matchedConcepts, confidence: 0.1 }
  return { verdict: 'offTopic', language, matchedConcepts, confidence: 0.92 }
}
