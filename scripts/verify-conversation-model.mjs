// Uses synthetic text only. Run against a staged adapter with its existing server credentials.
import assert from 'node:assert/strict'
import { evaluate, generateLine } from '../api/index.mjs'
import { boundaryLines, localizedRubric } from '../server/conversation-boundaries.mjs'

// A bounded retry for the synthetic verification run, not a change to child turns.
const nativeFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  for (let attempt=0; ; attempt++) {
    const response=await nativeFetch(...args)
    if(response.status!==429 || attempt>=2) return response
    const error=(await response.clone().json()).error
    console.log(`Verification rate limit: ${error?.code || error?.type || 'unknown'}`)
    if(error?.code==='insufficient_quota') return response
    const delay=Math.min(30000,Math.max(1000,Number(response.headers.get('retry-after') || 20)*1000))
    await new Promise(resolve=>setTimeout(resolve,delay))
  }
}

for (const language of ['english','chinese']) {
  const weather = language === 'english' ? "Today's weather is good" : '今天天气很好'
  const garbled = language === 'english' ? 'yellow because purple the yesterday' : '黄色因为紫色昨天那个'
  const cases = [
    ['choochoo-birthday-cake','call-a-friend',weather,['offTopic']],
    ['choochoo-birthday-cake','call-a-friend',garbled,['uncertain','unusable']],
    ['choochoo-birthday-cake','call-a-friend',language==='english'?'My sister has a new bicycle':'姐姐买了一辆新自行车',['offTopic']],
    ['choochoo-birthday-cake','call-a-friend',language==='english'?'banana the yesterday because seven':'香蕉因为那个昨天七',['uncertain','unusable']],
    ['choochoo-noodle-shop','your-favorite-food',weather,['offTopic']],
    ['choochoo-noodle-shop','your-favorite-food',garbled,['uncertain','unusable']],
    ['choochoo-farm-duckling','your-animal',language==='english'?'a flying dragon':'一条会飞的龙',['correct']],
    ['choochoo-noodle-shop','long-noodles',language==='english'?'They stretched like a jump rope':'拉得像跳绳一样',['correct']],
    ['choochoo-birthday-cake','call-a-friend',language==='english'?'The fox can help. The weather is good too.':'让小狐狸帮忙吧，今天天气也很好。',['correct']],
  ]
  for (const [storyID,checkpointID,transcript,allowed] of (process.env.CONVERSATION_TEST_REPLIES_ONLY ? [] : cases)) {
    const result = await evaluate({rubric:localizedRubric(storyID,checkpointID,language),transcript,attempt:5,hintLevel:4,detectedLanguage:language})
    assert.ok(allowed.includes(result.verdict),`${language}/${checkpointID}: expected ${allowed}, received ${JSON.stringify(result)}`)
    if(result.verdict==='offTopic') assert.deepEqual(result.matchedConcepts,[])
    console.log(`PASS model ${language}/${checkpointID}: ${result.verdict}`)
  }
  for (const kind of ['tangent','storyWrapup','imaginativePlay','openReply']) {
    const rubric=localizedRubric('choochoo-birthday-cake','call-a-friend',language)
    const body={language,kind,storyID:'choochoo-birthday-cake',checkpointID:'call-a-friend',previousLine:rubric.question,currentQuestion:rubric.question,storyContext:rubric.sceneExcerpt}
    if(kind==='storyWrapup') body.currentQuestion=body.previousLine=language==='english'?'Who was your favorite in our story?':'你最喜欢故事里的谁呀？'
    if(kind==='imaginativePlay') {
      body.currentQuestion=body.previousLine=language==='english'?'Who can help the rabbit carry the basket?':'谁能帮小兔子提篮子呢？'
      body.storyContext=language==='english'?'A rabbit needs help carrying a heavy basket onto our cloud boat. Nobody has helped yet.':'小兔子想把一个沉重的篮子搬上我们的云朵小船，还没有人帮忙。'
    }
    const redirect=await generateLine({...body,learnerSpeech:weather})
    assert.equal(redirect.action,'redirect',`${language}/${kind}: ${JSON.stringify(redirect)}`)
    assert.ok(redirect.line.endsWith(body.currentQuestion))
    const retry=await generateLine({...body,learnerSpeech:garbled})
    assert.deepEqual(retry,{action:'retry',line:boundaryLines[language].retry})
    console.log(`PASS model ${language}/${kind}: weather redirects, unclear asks again`)
    if(kind==='imaginativePlay') {
      const answer=await generateLine({...body,learnerSpeech:language==='english'?'A flying dragon can help carry it':'一条会飞的龙可以帮忙提篮子'})
      assert.equal(answer.action,'continue')
      assert.match(answer.line,language==='english'?/dragon|basket|rabbit|carry/i:/龙|篮子|兔|提/)
      console.log(`PASS model ${language}/imaginativePlay: coherent surprising idea accepted`)
    }
  }
}
console.log(process.env.CONVERSATION_TEST_REPLIES_ONLY ? 'PASS: live bilingual reply boundaries' : 'PASS: live bilingual semantic evaluation and conversational boundaries')
