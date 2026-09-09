import test from 'node:test'
import assert from 'node:assert/strict'
import { detectVoiceCommand } from '../src/voiceCommands.ts'

test('recognizes conversational control requests in both languages', () => {
  for (const [text, expected] of [
    ['可以重复一遍问题吗？', 'question'], ['可以重新讲一下故事吗？', 'repeat'],
    ['你可以用英文提示我一下吗？', 'hint'], ['Can you repeat the question?', 'question'],
    ['Please pause', 'pause'], ['Continue please', 'continue'], ['All done!', 'end'],
  ]) assert.equal(detectVoiceCommand(text), expected, text)
})

test('story answers containing control words remain answers', () => {
  for (const text of ['The helper brought milk', 'I helped the duck', 'The bus stopped', 'The turtle waited', 'He said goodbye to the fox', '小鸭子说再见了', '他停一下再走']) {
    assert.equal(detectVoiceCommand(text), null, text)
  }
})
