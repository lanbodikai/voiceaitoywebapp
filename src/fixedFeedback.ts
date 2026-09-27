import type { Checkpoint } from './types.ts'

export function englishHintFor(checkpoint:Checkpoint,level:number) {
  const model=checkpoint.concepts.map(concept=>concept.en[0]).filter(Boolean).join(' and ')
  if(level===1)return checkpoint.englishHint
  if(level===2)return `Try saying one important word: ${model}.`
  if(level===3)return `Here is a sentence starter: “I think ${model}…”`
  return `Let’s say the complete answer together: ${model}.`
}
