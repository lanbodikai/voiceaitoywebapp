export type VoiceCommand = 'pause' | 'continue' | 'repeat' | 'question' | 'hint' | 'end' | null

/** Match requests, not words embedded in a child's story answer. */
export function detectVoiceCommand(source: string): VoiceCommand {
  const english = source.toLowerCase().replace(/[,.!?]/g, '').trim().replace(/\s+/g, ' ')
  const chinese = source.replace(/[，。！？\s]/g, '')
  const request = english.replace(/^(?:can you|could you|would you|please) /, '').replace(/ please$/, '')
  if (/^(?:pause|stop|wait)(?: a (?:moment|second))?$/.test(request) || /^(?:请|可以)?(?:暂停|停一下|等等|等一下|别说了)(?:吗)?$/.test(chinese)) return 'pause'
  if (/^(?:goodbye|bye|all done|all finished|end the (?:call|story))$/.test(request) || /^(?:结束|再见|不玩了|拜拜)$/.test(chinese)) return 'end'
  if (/^(?:continue|resume|keep going)$/.test(request) || /^(?:请)?(?:继续|接着说|继续讲)$/.test(chinese)) return 'continue'
  if (/^(?:(?:repeat|say|ask)(?: the)? question(?: again)?|what(?: is| was|'s) the question)$/.test(request) || /(?:重复|再问|再说|重新).*(?:问题)|问题.*(?:一遍|是什么)/.test(chinese)) return 'question'
  if (/^(?:repeat(?: (?:that|the story|the section))?|say (?:that|it) again|start (?:over|again)|redo)$/.test(request) || /^(?:你)?(?:可以|请)?(?:再说一遍|重新讲(?:一下|一遍)?(?:故事)?|重讲|重复(?:一下|一遍)?(?:故事)?|再来)(?:吗)?$/.test(chinese)) return 'repeat'
  if (/^(?:give me (?:a|an english) hint|help(?: me)?|hint)$/.test(request) || /^(?:你)?(?:可以|请)?(?:用英文)?(?:提示|给我.*提示|帮帮我)(?:我)?(?:一下)?(?:吗)?$/.test(chinese)) return 'hint'
  return null
}
