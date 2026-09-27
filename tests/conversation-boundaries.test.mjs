import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluateLocal } from '../src/evaluator.ts'
import { conversationalLine, evaluate, generateLine, rememberEvaluation, understandTurn } from '../api/index.mjs'
import { boundaryLines, localizedRubric, evaluationBoundaries, replyBoundaries } from '../server/conversation-boundaries.mjs'
const catalog = JSON.parse(readFileSync(new URL('../src/data/stories.json', import.meta.url)))

test('all server rubrics use exactly the scene and question heard by the web client', () => {
  for(const language of ['english','chinese']) for(const story of catalog.stories) for(const beat of story.beats) {
    const rubric=localizedRubric(story.id,beat.checkpoint.id,language)
    assert.equal(rubric.question,language==='english'?beat.checkpoint.englishQuestion:beat.checkpoint.question)
    assert.equal(rubric.sceneExcerpt,language==='english'?beat.englishNarration:beat.narration)
    assert.equal(rubric.kind,beat.checkpoint.kind)
    assert.deepEqual(rubric.requiredConcepts.map(concept=>concept.id),beat.checkpoint.concepts.map(concept=>concept.id))
  }
})

for (const language of ['english','chinese']) {
  const weather = language === 'english' ? "Today's weather is good" : '今天天气很好'
  test(`${language}: no kind of checkpoint auto-accepts weather, fragments or keyword salad`, () => {
    for (const story of catalog.stories) for (const beat of story.beats) {
      assert.equal(evaluateLocal(weather,beat.checkpoint,language).verdict,'uncertain')
      assert.equal(evaluateLocal('?',beat.checkpoint,language).verdict,'unusable')
      const term = beat.checkpoint.concepts[0]?.[language === 'english' ? 'en' : 'zh'][0]
      if (term) assert.equal(evaluateLocal(`${term} purple because yesterday 啊咕`,beat.checkpoint,language).verdict,'uncertain')
    }
  })
  test(`${language}: redirect ends with the exact authoritative pending question, never a new question`, () => {
    const body = {language,kind:'tangent',storyID:'choochoo-birthday-cake',checkpointID:'call-a-friend',previousLine:'stale question',currentQuestion:'wrong question'}
    const question = localizedRubric(body.storyID,body.checkpointID,language).question
    const acknowledgement = language === 'english' ? 'A lovely day sounds nice!' : '好天气听起来真不错！'
    for (const action of ['redirect','continue']) {
      const result = conversationalLine({action,line:acknowledgement},body)
      assert.equal(result.action,'redirect')
      assert.ok(result.line.startsWith(acknowledgement))
      assert.ok(result.line.endsWith(question))
      assert.ok(!result.line.includes('wrong question'))
    }
    for (const line of ['Pick one below.','天气很好！你想玩什么？','Lovely! What did you do today?']) {
      const result = conversationalLine({action:'redirect',line},body)
      assert.equal(result.line,`${boundaryLines[language].acknowledgement} ${boundaryLines[language].bridge} ${question}`)
    }
  })
  test(`${language}: retries and invalid model responses never repeat the question or close`, () => {
    for (const kind of ['tangent','storyWrapup','openReply','imaginativePlay']) {
      const body = {language,kind,previousLine:'Who is your favorite?',currentQuestion:'Who is your favorite?'}
      for (const generated of [{action:'retry',line:'Let’s skip ahead!'}, {line:'Finished!'}, {action:'other',line:'Finished!'}]) {
        assert.deepEqual(conversationalLine(generated,body),{action:'retry',line:boundaryLines[language].retry})
      }
      assert.deepEqual(conversationalLine({action:'continue',line:boundaryLines[language].retry},body),{action:'retry',line:boundaryLines[language].retry})
    }
  })
  test(`${language}: schema and prompts allow distinct unclear/off-topic outcomes with story context`, async () => {
    const priorFetch = globalThis.fetch, priorKey = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'synthetic-test-key'
    const requests = []
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body); requests.push(request)
      const output = request.text.format.name === 'answer_grade'
        ? {meaningStatus:'unclear',verdict:'uncertain',language,matchedConcepts:[],confidence:0.95}
        : request.text.format.name === 'turn_understanding'
          ? {action:'redirect',confidence:0.95}
          : {line:language==='english'?'A lovely day sounds nice!':'好天气听起来真不错！'}
      return new Response(JSON.stringify({output_text:JSON.stringify(output)}))
    }
    try {
      const rubric = localizedRubric('choochoo-birthday-cake','call-a-friend',language)
      const result = await evaluate({rubric,transcript:weather,attempt:99,hintLevel:99,detectedLanguage:language})
      assert.equal(result.verdict,'uncertain')
      const request = requests[0]
      assert.deepEqual(requests.slice(0,2).map(item=>item.reasoning.effort),['low','medium'])
      assert.ok(request.input[0].content.includes(evaluationBoundaries[language]))
      assert.ok(request.text.format.schema.properties.verdict.enum.includes('offTopic'))
      assert.ok(request.text.format.schema.properties.verdict.enum.includes('unusable'))
      const data = JSON.parse(request.input.at(-1).content)
      assert.equal(data.question,rubric.question); assert.equal(data.sceneExcerpt,rubric.sceneExcerpt)
      assert.equal(data.kind,'choice')
      if (language === 'english') assert.doesNotMatch(data.question,/\p{Script=Han}/u)
      const generated = await generateLine({language,kind:'tangent',previousLine:rubric.question,learnerSpeech:weather,storyID:'choochoo-birthday-cake',checkpointID:'call-a-friend'})
      assert.equal(generated.action,'redirect')
      assert.ok(requests[3].input[0].content.includes(replyBoundaries[language]))
      assert.deepEqual(requests[3].text.format.schema.required,['line'])
      assert.equal(requests[2].text.format.name,'turn_understanding','understanding runs before creative generation')
    } finally {
      globalThis.fetch = priorFetch
      if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey
    }
  })
}

test('short valid Mandarin and imaginative new ideas receive semantic evaluation, not rejection', () => {
  const checkpoint = catalog.stories[0].beats.find(beat => beat.checkpoint.kind === 'open').checkpoint
  for (const text of ['龙','星星','a rainbow made of jelly','一条会飞的龙']) assert.equal(evaluateLocal(text,checkpoint,'chinese').verdict,'uncertain')
  assert.equal(evaluateLocal('草莓',checkpoint,'chinese').verdict,'correct')
  assert.equal(evaluateLocal('chocolate',checkpoint,'chinese').verdict,'meaningUnderstood')
})

test('low-confidence, contradictory, or invented-concept grades cannot advance a turn', async () => {
  const priorFetch=globalThis.fetch, priorKey=process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY='synthetic-test-key'
  try {
    for (const language of ['english','chinese']) {
      const rubric=localizedRubric('choochoo-birthday-cake','call-a-friend',language)
      for (const override of [{confidence:0.28},{responseKey:'retry'},{matchedConcepts:['made-up-ID']},{meaningStatus:'unclear'},{meaningStatus:undefined}]) {
        globalThis.fetch=async()=>new Response(JSON.stringify({output_text:JSON.stringify({meaningStatus:'clear',verdict:'correct',language,matchedConcepts:[],confidence:0.99,responseKey:'success',...override})}))
        const result=await evaluate({rubric,transcript:'synthetic',attempt:5,hintLevel:4})
        assert.equal(result.verdict,'uncertain'); assert.deepEqual(result.matchedConcepts,[])
      }
    }
  } finally {
    globalThis.fetch=priorFetch
    if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey
  }
})

test('clear low-effort grades return immediately; ambiguous grades get one deeper check', async () => {
  const priorFetch=globalThis.fetch,priorKey=process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY='synthetic-test-key'
  try {
    const rubric=localizedRubric('choochoo-birthday-cake','call-a-friend','chinese')
    const efforts=[]
    globalThis.fetch=async(_url,init)=>{
      const request=JSON.parse(init.body)
      efforts.push(request.reasoning.effort)
      const uncertain={meaningStatus:'unclear',verdict:'uncertain',language:'chinese',matchedConcepts:[],confidence:0.95}
      const clear={meaningStatus:'clear',verdict:'offTopic',language:'chinese',matchedConcepts:[],confidence:0.99}
      return Response.json({output_text:JSON.stringify(efforts.length===1?clear:efforts.length===2?uncertain:clear)})
    }
    assert.equal((await evaluate({rubric,transcript:'今天天气很好'})).verdict,'offTopic')
    assert.deepEqual(efforts,['low'])
    assert.equal((await evaluate({rubric,transcript:'姐姐买了一辆新自行车'})).verdict,'offTopic')
    assert.deepEqual(efforts,['low','low','medium'])
    globalThis.fetch=async(_url,init)=>{
      const request=JSON.parse(init.body)
      efforts.push(request.reasoning.effort)
      if(request.reasoning.effort==='low')return Response.json({output_text:''})
      return Response.json({output_text:JSON.stringify({meaningStatus:'clear',verdict:'offTopic',language:'chinese',matchedConcepts:[],confidence:0.99})})
    }
    assert.equal((await evaluate({rubric,transcript:'今天天气很好'})).verdict,'offTopic')
    assert.deepEqual(efforts,['low','low','medium','low','medium'])
  } finally {
    globalThis.fetch=priorFetch
    if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey
  }
})

test('unclear speech is held before the creative model runs, in both languages and every reply kind', async () => {
  const priorFetch=globalThis.fetch, priorKey=process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY='synthetic-test-key'
  try {
    for(const language of ['english','chinese']) for(const kind of ['tangent','storyWrapup','imaginativePlay','openReply']) {
      let calls=0
      globalThis.fetch=async(_url,init)=>{
        calls++
        assert.equal(JSON.parse(init.body).text.format.name,'turn_understanding')
        return new Response(JSON.stringify({output_text:JSON.stringify({action:'retry',confidence:0.95})}))
      }
      assert.deepEqual(await generateLine({language,kind,previousLine:'A pending question',learnerSpeech:'synthetic garbled input'}),{action:'retry',line:boundaryLines[language].retry})
      assert.equal(calls,1)
    }
  } finally {
    globalThis.fetch=priorFetch
    if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey
  }
})

test('a recent server evaluation avoids a duplicate check without leaking across question or language', async () => {
  const priorFetch=globalThis.fetch, priorKey=process.env.OPENAI_API_KEY, priorNow=Date.now
  process.env.OPENAI_API_KEY='synthetic-test-key'
  try {
    let calls=0
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({output_text:'{"action":"retry","confidence":0.99}'}))}
    const body={storyID:'cache-story',checkpointID:'cache-question',targetLanguage:'english',transcript:'Synthetic weather comment'}
    const reply={storyID:body.storyID,checkpointID:body.checkpointID,kind:'tangent',language:'english',learnerSpeech:body.transcript,previousLine:'Who can help?'}
    rememberEvaluation(body,{verdict:'offTopic'})
    assert.equal(await understandTurn(reply),'redirect');assert.equal(calls,0)
    assert.equal(await understandTurn({...reply,language:'chinese'}),'retry');assert.equal(calls,1)
    assert.equal(await understandTurn({...reply,checkpointID:'different'}),'retry');assert.equal(calls,2)
    Date.now=()=>priorNow()+21000
    assert.equal(await understandTurn(reply),'retry');assert.equal(calls,3)
  } finally {
    Date.now=priorNow;globalThis.fetch=priorFetch
    if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey
  }
})
