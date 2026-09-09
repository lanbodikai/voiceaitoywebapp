/** New speech, mute, or exit invalidates unfinished transcription/reply work. */
export class SpeechTurn {
  generation = 0
  controller = new AbortController()
  next() { this.controller.abort(); this.controller = new AbortController(); return ++this.generation }
  current(generation: number) { return generation === this.generation && !this.controller.signal.aborted }
  cancel() { this.controller.abort(); this.generation++ }
}
