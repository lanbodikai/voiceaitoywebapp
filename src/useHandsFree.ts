import { useEffect, useRef, useState } from 'react'
import type { MicVAD } from '@ricky0123/vad-web'
import { transcribeAudio } from './backend'
import { speechWav } from './conversationIntents'
import { SpeechTurn } from './speechTurn'
import type { LessonLanguage } from './types'

interface Options {
  language: LessonLanguage
  storyID: string
  beatID: string
  allowed: boolean
  onStart: () => void
  onProcessing: () => void
  onTranscript: (text: string, isCurrent: () => boolean) => Promise<void>
  onError: () => void
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

  function disable(notify = true) {
    lifecycle.current++; active.current = false; opening.current = false
    turn.current.cancel(); segment.current = null; clearTimeout(limit.current)
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
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error('unsupported')
      // Both permission and AudioContext activation originate in the adult's click.
      ownedContext = new AudioContext(); context.current = ownedContext
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
      detector = await MicVAD.new({
        model:'v5', startOnLoad:false, audioContext:ownedContext,
        baseAssetPath:'/vad/', onnxWASMBasePath:'/vad/',
        ortConfig: (ort) => { ort.env.wasm.numThreads = 1 },
        positiveSpeechThreshold:0.6, negativeSpeechThreshold:0.35,
        minSpeechMs:160, preSpeechPadMs:320, redemptionMs:1200,
        submitUserSpeechOnPause:true,
        getStream:async () => ownedStream!,
        // A short pause cuts a long utterance without requesting mic permission again.
        pauseStream:async () => {}, resumeStream:async () => ownedStream!,
        onSpeechRealStart: () => {
          if (!valid() || !active.current || !latest.current.allowed) return
          segment.current = turn.current.next()
          setError(''); setRecording(true); latest.current.onStart()
          clearTimeout(limit.current)
          limit.current = setTimeout(() => {
            void (async () => {
              await detector?.pause()
              if (valid() && active.current) await detector?.start()
            })().catch(() => { if (valid()) { disable(); latest.current.onError() } })
          }, 28_000)
        },
        onSpeechEnd: async (samples) => {
          const generation = segment.current; segment.current = null; clearTimeout(limit.current)
          const current = () => valid() && active.current && generation !== null && turn.current.current(generation)
          if (!current() || !latest.current.allowed) { samples.fill(0); return }
          setRecording(false)
          const captured = latest.current
          const audioDurationMs = Math.min(30_000,Math.round(samples.length / 16))
          const audio = speechWav(samples); samples.fill(0)
          captured.onProcessing()
          const started = performance.now()
          try {
            const result = await transcribeAudio(audio, {language:captured.language,storyID:captured.storyID,beatID:captured.beatID,durationMs:String(audioDurationMs)}, turn.current.controller.signal)
            if (!current()) return
            captured.onMetric?.({audioDurationMs,transcriptionLatencyMs:Math.round(performance.now()-started)})
            // Read the live handler: narration may have changed phase during capture.
            await latest.current.onTranscript(result.transcript, current)
          } catch {
            if (!current()) return
            setError(captured.language === 'chinese' ? '语音连接暂时中断。可以直接再说一次。' : 'The speech connection dropped. You can say that again.')
            latest.current.onError()
          }
        },
      })
      if (!valid()) return false
      vad.current = detector
      await detector.start()
      if (!valid()) return false
      if (detector.errored || !detector.listening) throw new Error('microphone-start-failed')
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
