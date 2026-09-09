import type { LessonLanguage, VocabularyItem } from './types'
import playIntro from './data/play-intro.json'

export { playIntro }

export interface PlayDestination {
  id: string
  emoji: string
  zh: string
  en: string
  openingZh: string
  openingEn: string
  cue: string
  ideasZh: string[]
  ideasEn: string[]
  challengesZh: string[]
  challengesEn: string[]
  vocabulary: VocabularyItem[]
}

export const playDestinations: PlayDestination[] = [
  {
    id: 'boat', emoji: '⛵', zh: '云朵小船', en: 'Cloud Boat', cue: playIntro.openings.boat.cue,
    openingZh: playIntro.openings.boat.zh, openingEn: playIntro.openings.boat.en,
    ideasZh: ['可以带上一只小猫。', '我们可以带一把会唱歌的雨伞。'], ideasEn: ['We could bring a little cat.', 'We could bring a singing umbrella.'],
    challengesZh: ['前面有一朵痒痒云！我们要怎么绕过去？', '小船需要一句魔法中文才能继续。你会说“出发”吗？'],
    challengesEn: ['A tickly cloud is ahead! How should we get around it?', 'The boat needs a magic word. Can you say “出发,” which means “let’s go”?'],
    vocabulary: [{ id: 'boat', zh: '小船', pinyin: 'xiǎo chuán', en: 'boat' }, { id: 'go', zh: '出发', pinyin: 'chū fā', en: 'set off' }],
  },
  {
    id: 'farm', emoji: '🌱', zh: '会唱歌的农场', en: 'Singing Farm', cue: playIntro.openings.farm.cue,
    openingZh: playIntro.openings.farm.zh, openingEn: playIntro.openings.farm.en,
    ideasZh: ['我们可以找一只嘎嘎叫的小鸭子。', '我们可以跟绵羊一起唱歌。'], ideasEn: ['We could find a quacking duck.', 'We could sing with a sheep.'],
    challengesZh: ['小鸭子的胡萝卜不见了。你觉得藏在哪里？', '动物们想听一个声音。你会学哪只动物叫？'],
    challengesEn: ['The duck lost its carrot. Where could it be?', 'The animals want to hear a sound. Which animal can you imitate?'],
    vocabulary: [{ id: 'farm', zh: '农场', pinyin: 'nóng chǎng', en: 'farm' }, { id: 'duck', zh: '小鸭子', pinyin: 'xiǎo yā zi', en: 'duck' }],
  },
  {
    id: 'restaurant', emoji: '🍜', zh: '魔法餐厅', en: 'Magic Restaurant', cue: playIntro.openings.restaurant.cue,
    openingZh: playIntro.openings.restaurant.zh, openingEn: playIntro.openings.restaurant.en,
    ideasZh: ['我们可以做彩虹面条。', '我们可以包星星形状的饺子。'], ideasEn: ['We could make rainbow noodles.', 'We could make star-shaped dumplings.'],
    challengesZh: ['来了一位只会笑的客人。我们怎么知道他想吃什么？', '请用中文邀请客人：“请吃！”'],
    challengesEn: ['A guest who only laughs has arrived. How can we learn what they want?', 'Invite the guest in Mandarin: “请吃,” meaning “please eat”!'],
    vocabulary: [{ id: 'noodles', zh: '面条', pinyin: 'miàn tiáo', en: 'noodles' }, { id: 'please-eat', zh: '请吃', pinyin: 'qǐng chī', en: 'please eat' }],
  },
]

export function playText(destination: PlayDestination, key: 'opening' | 'idea' | 'challenge', language: LessonLanguage, turn = 0) {
  if (key === 'opening') return language === 'chinese' ? destination.openingZh : destination.openingEn
  const choices = key === 'idea'
    ? language === 'chinese' ? destination.ideasZh : destination.ideasEn
    : language === 'chinese' ? destination.challengesZh : destination.challengesEn
  return choices[turn % choices.length]
}
