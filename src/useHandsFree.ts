import { useEffect, useRef, useState } from 'react'
import type { MicVAD } from '@ricky0123/vad-web'
import { accessToken } from './supabase'
import { StreamingSpeech } from './StreamingSpeech'
import { rememberSafety, clearSpeechMemory } from './preparedSpeech'
import { setVoiceRPC } from './voiceTransport'
import { SpeechTurn } from './speechTurn'
import type { LessonLanguage } from './types'
import { audioContextClass } from './browserCompat'

interface Options {
  language: LessonLanguage
  storyID: string
  beatID: string
  allowed: boolean
  onStart: () => void
  onProcessing: () => void
  onTranscript: (text: string, isCurrent: () => boolean) => Promise<void>
  onError: () => void
  onFalseStart: () => void
  onMuted: () => void
  onMetric?: (metric: {audioDurationMs: number; transcriptionLatencyMs: number}) => void
}

export function useHandsFree(options: Options) {
  const [enabled, setEnabled] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(options)
  useEffect(() => { latest.current = options }, [options])
  const active = useRef(false)
  const opening = useRef(false)
  const lifecycle = useRef(0)
  const alive = useRef(true)
  const vad = useRef<MicVAD | undefined>(undefined)
  const stream = useRef<MediaStream | undefined>(undefined)
  const context = useRef<AudioContext | undefined>(undefined)
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const segment = useRef<number | null>(null)
  const turn = useRef(new SpeechTurn())
  const speech = useRef<StreamingSpeech | undefined>(undefined)
  const leading = useRef<Float32Array[]>([])
  const finalize = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const capturedSamples = useRef(0)

  useEffect(() => {
    const detector = vad.current
    if (!detector || !active.current) return
    // Pausing resets Silero's internal speech state. Merely ignoring callbacks
    // lets speaker echo leak into the next child turn and delays detection.
    void (options.allowed ? detector.start() : detector.pause()).catch(() => {
      if (alive.current && active.current) { disable(); latest.current.onError() }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.allowed])

  function disable(notify = true) {
    lifecycle.current++; active.current = false; opening.current = false
    turn.current.cancel(); segment.current = null; clearTimeout(limit.current); clearTimeout(finalize.current); finalize.current=undefined
    capturedSamples.current=0
    speech.current?.close(); speech.current=undefined; clearSpeechMemory()
    setVoiceRPC(undefined)
    leading.current.forEach(frame=>frame.fill(0));leading.current=[]
    // Stop the tracks synchronously, even if model disposal is still pending.
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = undefined
    const previous = vad.current; vad.current = undefined
    void previous?.destroy().catch(() => undefined)
    void context.current?.close().catch(() => undefined); context.current = undefined
    if (alive.current) { setEnabled(false); setStarting(false); setRecording(false) }
    if (notify) latest.current.onMuted()
  }

  useEffect(() => {
    alive.current = true
    const hidden = () => { if (document.hidden && (active.current || opening.current)) disable() }
    document.addEventListener('visibilitychange', hidden)
    return () => { alive.current = false; disable(false); document.removeEventListener('visibilitychange', hidden) }
    // The cleanup works from refs, never from a captured conversation turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function enable() {
    if (active.current) return true
    if (opening.current) return false
    const id = ++lifecycle.current
    opening.current = true; setStarting(true); setError('')
    let ownedStream: MediaStream | undefined
    let ownedContext: AudioContext | undefined
    let detector: MicVAD | undefined
    const valid = () => alive.current && id === lifecycle.current
    try {
      const AudioContextConstructor = audioContextClass()
      if (!navigator.mediaDevices?.getUserMedia || !AudioContextConstructor) throw new Error('unsupported')
      // Both permission and AudioContext activation originate in the adult's click.
      ownedContext = new AudioContextConstructor(); context.current = ownedContext
      await ownedContext.resume()
      ownedStream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
      if (!valid()) { ownedStream.getTracks().forEach((track) => track.stop()); return false }
      stream.current = ownedStream
      ownedStream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
        if (!valid()) return
        disable(); setError(latest.current.language === 'chinese' ? '麦克风已断开。请重新连接后打开麦克风。' : 'Microphone disconnected. Reconnect it and turn the mic on again.')
      }, {once:true}))
      const { MicVAD } = await import('@ricky0123/vad-web')
      if (!valid()) return false
      const token = await accessToken()
      if (!token) throw new Error('Guest session is not ready')
      const voice = new StreamingSpeech(() => {
        if(!valid()) return
        disable();setError(latest.current.language==='chinese'?'语音连接中断，请重新打开麦克风。':'Speech disconnected. Turn the microphone on again.')
      })
      speech.current=voice
      await voice.connect(token,latest.current.language)
      if(!valid()) {voice.close();return false}
      setVoiceRPC((type,body,signal)=>voice.request(type,body,signal))
      detector = await MicVAD.new({
        model:'v5', startOnLoad:false, audioContext:ownedContext,
        baseAssetPath:'/vad/', onnxWASMBasePath:'/vad/',
        ortConfig: (ort) => { ort.env.wasm.numThreads = 1 },
        positiveSpeechThreshold:0.30, negativeSpeechThreshold:0.16,
        minSpeechMs:192, preSpeechPadMs:640, redemptionMs:1050,
        submitUserSpeechOnPause:true,
        getStream:async () => ownedStream!,
        // A short pause cuts a long utterance without requesting mic permission again.
        pauseStream:async () => {}, resumeStream:async () => ownedStream!,
        onFrameProcessed: (_probability, frame) => {
          if(!valid() || !active.current || !latest.current.allowed) return
          try {
            if(segment.current!==null) voice.append(frame)
            else {leading.current.push(frame.slice());if(leading.current.length>20)leading.current.shift()?.fill(0)}
          } catch {disable();latest.current.onError()}
        },
        // Start on the first confident frame. Silero still requires minSpeechMs
        // before onSpeechEnd, so clicks become misfires rather than answers.
        onSpeechStart: () => {
          if (!valid() || !active.current || !latest.current.allowed) return
          if(finalize.current && segment.current!==null) {
            clearTimeout(finalize.current);finalize.current=undefined
            setRecording(true)
            clearTimeout(limit.current)
            limit.current=setTimeout(() => {
              void (async()=>{await detector?.pause();if(valid()&&active.current)await detector?.start()})()
                .catch(()=>{if(valid()){disable();latest.current.onError()}})
            },28_000)
            return
          }
          segment.current = turn.current.next()
          capturedSamples.current=0
          clearSpeechMemory()
          try {
            const current=latest.current
            voice.begin({language:current.language,storyID:current.storyID,beatID:current.beatID})
            for(const frame of leading.current) {voice.append(frame);frame.fill(0)}
            leading.current=[]
          } catch {disable();latest.current.onError();return}
          setError(''); setRecording(true); latest.current.onStart()
          clearTimeout(limit.current)
          limit.current = setTimeout(() => {
            void (async () => {
              await detector?.pause()
              if (valid() && active.current) await detector?.start()
            })().catch(() => { if (valid()) { disable(); latest.current.onError() } })
          }, 28_000)
        },
        onVADMisfire: () => {
          if (!valid() || segment.current === null) return
          turn.current.cancel(); segment.current=null; capturedSamples.current=0
          clearTimeout(limit.current); clearTimeout(finalize.current); finalize.current=undefined
          leading.current.forEach((frame)=>frame.fill(0));leading.current=[]
          setRecording(false); latest.current.onFalseStart()
        },
        onSpeechEnd: (samples) => {
          const generation = segment.current; clearTimeout(limit.current)
          const current = () => valid() && active.current && generation !== null && turn.current.current(generation)
          if (!current() || !latest.current.allowed) { samples.fill(0); return }
          capturedSamples.current += samples.length
          samples.fill(0)
          clearTimeout(finalize.current)
          // A resumed phrase during this short window stays in the same streamed turn.
          finalize.current=setTimeout(() => {
            finalize.current=undefined
            if(!current())return
            segment.current=null;setRecording(false)
            const captured=latest.current
            const audioDurationMs=Math.min(30_000,Math.round(capturedSamples.current/16))
            capturedSamples.current=0;captured.onProcessing()
            const started=performance.now()
            void voice.commit().then(async(result)=>{
              if(!current())return
              rememberSafety(result.transcript,result.safety)
              captured.onMetric?.({audioDurationMs,transcriptionLatencyMs:Math.round(performance.now()-started)})
              // Read the live handler: narration may have changed phase during capture.
              await latest.current.onTranscript(result.transcript,current)
            }).catch(()=>{
              if(!current())return
              setError(captured.language==='chinese'?'语音连接暂时中断。可以直接再说一次。':'The speech connection dropped. You can say that again.')
              latest.current.onError()
            })
          },150)
        },
      })
      if (!valid()) return false
      vad.current = detector
      await detector.start()
      if (!valid()) return false
      // Warm-up begins before the cloud session exists, so narration is not yet
      // allowed to open a turn. Pause once here to clear any setup/greeting echo.
      if (!latest.current.allowed) await detector.pause()
      if (detector.errored || (latest.current.allowed && !detector.listening)) throw new Error('microphone-start-failed')
      active.current = true; setEnabled(true)
      return true
    } catch (failure) {
      if (valid()) {
        disable(false)
        const denied = failure instanceof DOMException && failure.name === 'NotAllowedError'
        setError(latest.current.language === 'chinese'
          ? denied ? '请让家长允许麦克风权限，再打开麦克风。' : '麦克风未能启动，请检查设备和网络后重试。'
          : denied ? 'Ask a grown-up to allow microphone access, then turn the mic on.' : 'Microphone could not start. Check the device and connection, then try again.')
        latest.current.onError()
      }
      return false
    } finally {
      if (!active.current || !valid()) {
        ownedStream?.getTracks().forEach((track) => track.stop())
        void detector?.destroy().catch(() => undefined)
        void ownedContext?.close().catch(() => undefined)
      }
      if (valid()) { opening.current = false; setStarting(false) }
    }
  }

  function toggle() {
    if (active.current || opening.current) disable()
    else void enable()
  }
  return {enabled,starting,recording,error,enable,disable,toggle,isEnabled: () => active.current}
}
