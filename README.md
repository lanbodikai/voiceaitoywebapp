# ChooChoo

Mandarin and English story conversations with saved preferences, a bilingual story reader, and imaginative play. Fixed narration uses certified Edge-TTS cues. Dynamic replies use progressive Deepgram Aura-2 for English when configured, and Edge-TTS for Mandarin.

## Run locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Set only these browser-safe values in `.env.local`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_API_BASE_URL=http://localhost:8787
```

Do not put an OpenAI API key or Supabase service-role key in the web folder.

## Supabase setup

1. In Supabase Auth, enable **Anonymous sign-ins**. No child account form is shown.
2. Add local and Vercel URLs to the allowed site URLs.
3. Configure the two public `VITE_SUPABASE_*` values in the deployment.
4. Run `supabase/20260909_guest_progress.sql` once in the SQL Editor, followed by `supabase/20260910_handsfree_consent.sql`, `supabase/20260911_classic_stories.sql`, and `supabase/20260922_puzzle_events.sql`. They create protected `cc_*` tables, record the hands-free disclosure version, register Little Red Hen and Henny Penny, and allow the structured picture-puzzle events without altering existing progress.

## Vercel handoff

This GitHub repository has the Vite app at its root. Import it in Vercel with root directory `.`. In the original iOS monorepo, the same app lives in `web/`.

Progress and HTTP requests use `api/index.mjs` through `/api`. Voice HTTP routes proxy to `https://api.mousefit.pro/ai-toy/web` (server-only override: `ORACLE_VOICE_ORIGIN`). The active call uses `wss://api.mousefit.pro/ai-toy/web/voice-stream` directly, avoiding per-turn Vercel hops. Vercel needs the public Supabase values, but no longer uses its OpenAI key. `VITE_API_BASE_URL` is only used during local development. Never prefix a secret with `VITE_`.

The voice server validates the Supabase bearer token and recorded consent version. With `DEEPGRAM_STT=true` and the updated `web-handsfree-1.3` consent, it uses Deepgram Nova-3 streaming recognition; older consent and unconfigured servers continue using OpenAI `gpt-live-transcribe`. OpenAI `gpt-5-nano` remains the conversation and grading model. WebSocket authorization is in the first message, never the URL. Connections have origin checks, authentication timeouts, per-profile concurrency caps, payload/utterance limits, request limits, and a 30-minute lifetime. Progress, consent and recovery remain on Vercel/Supabase.

During a call, the browser converts detector frames into 24 kHz PCM and sends ~96 ms chunks while speaking over one reusable voice socket. It commits after the local end-of-speech decision. Deepgram processes the PCM during speech and receives a Finalize message on commit; the OpenAI fallback commits its audio buffer then. Stream finalization includes moderation, and the browser consumes that result once rather than making a second safety request for local grading. The server retains only short-lived hashes of safe moderated text for deduplicating adjacent checks; it stores no transcripts. Turn IDs isolate interruptions, and OpenAI provider conversation items are deleted after transcription. Muting closes the connection. The former WAV endpoint remains for compatibility, not the live UI path.

Frequently used fixed lines are regenerated Edge cues; their text, voice settings, and audio hashes are recorded in `src/data/edge-cues.json`, and the production build verifies every file. Only IDs in the generated runtime allowlist may use bundled playback. Dynamic English replies use Deepgram Aura-2 MP3 streaming after the updated consent when the server has `DEEPGRAM_API_KEY`; Mandarin uses Edge-TTS because Aura-2 does not provide a Mandarin voice. The authenticated voice socket starts output moderation and synthesis together, then sends the reply line and MP3 chunks only after safety passes. Browsers with MP3 MediaSource support start playback before synthesis finishes; other browsers use the existing buffered Edge path. New speech cancels an unfinished stream. Fixed cues and uncached synthesis still use Edge-TTS. Server credentials stay in the runtime environment, never in browser variables or WebSocket messages. `speech/synthesize` remains an authenticated HTTP alternative.

Conversation boundaries live in `server/conversation-boundaries.mjs`, with matching fixed English/Chinese repair lines in `src/data/conversation-boundaries.json`. A coherent off-topic reply gets a short acknowledgement followed by the same pending story question, appended by the server before Edge synthesis. Unclear speech, failed evaluation, or an inconsistent/low-confidence grade asks the child to say it again. Repair turns themselves never consume a checkpoint or play turn or replace shared-story context. If the child then stays quiet, the story gives one spoken invitation after 12 seconds and continues gently after another 12 seconds. Open questions accept understandable relevant imaginative answers; their concept lists are examples, not mandatory vocabulary. Only exact known answers bypass semantic evaluation. The noodle-shop thanks checkpoint accepts either "thanks" or "yummy" as a complete response.

Understanding is checked separately before writing dynamic replies; the creative writer cannot override its decision. Non-exact story answers use Nano with medium reasoning, because lower settings failed live bilingual grading cases. Dynamic turns use a shorter, dedicated low-reasoning understanding check, while reply writing still uses minimal reasoning. The authenticated voice socket reuses its own moderation result only when the grading transcript has the same hash; changed text and HTTP calls are moderated afresh. A recent server-verified off-topic evaluation is reused for 20 seconds to avoid evaluating the same reply twice; only a bounded hash and decision are cached, never the transcript. An unclear turn returns the fixed repair directly without running the creative writer. Do not remove this gate or restore skip-on-retry behavior as a latency shortcut.

Boundary checks: `pnpm test`, then `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/support/conversation-boundaries-flow.mjs` with Vite running on port 5180. The browser suite covers both languages, repeated tangents/repairs, service errors, silence, pause/resume, open questions, wrapup, and shared-story continuity. `node scripts/verify-conversation-model.mjs` checks synthetic text against the real model in a staged server environment; it requires the existing server-only OpenAI credentials and never logs them.

Settings includes a persisted 0.70×–1.10× speaking-speed control. The child-friendly default is 0.85×. Playback preserves pitch and applies the selected speed uniformly to bundled narration and dynamic Edge-TTS replies.

Story conversations send only the relevant scene, question, title, and bounded story context to generated-reply requests. After the final “favorite” response, ChooChoo acknowledges the child’s choice, references a concrete event from that story, thanks the child, and ends the story automatically without asking another question.

`Dockerfile.oracle` extends the existing Oracle iOS image without replacing its source. `server/oracle-entry.mjs` dispatches only `/web/*` to the adapter; all legacy iOS paths use the original handler. To rebuild the adapter on Oracle after copying these files:

```sh
docker compose -f /home/ubuntu/ai-toy-backend/compose.yaml \
  -f /home/ubuntu/ai-toy-web-adapter/deploy/oracle.override.yaml up -d --build ai-toy-backend
```

The original image is retained as `ai-toy-legacy:pre-web-20260909`. To restore the pre-adapter iOS service, run the original compose file alone with `up -d --no-build --force-recreate ai-toy-backend`; the original image and `.env` are unchanged. This rollback removes the new web routes, so voice on the website will be unavailable until the adapter is restored. Neither child-pilot mode nor the ZDR-verification flag is enabled by this deployment.

`VOICE_TEST_SITE=https://your-deployment.example VOICE_TEST_SYNTHETIC_WAV=/absolute/path/to/synthetic.wav node scripts/verify-oracle-voice.mjs` explicitly creates a synthetic guest and checks consent enforcement, real Oracle transcription, moderation, Nano replies/grades, and progress access without logging speech or credentials. Optional `VOICE_TEST_ORIGIN` targets a canary before deployment. Use generated audio only until child-pilot prerequisites are met.

Progress is stored in Supabase under a random guest profile, with a local retry queue. ChooChoo asks once for a preferred nickname; it remains in that browser under the random guest profile and is never included in progress uploads. Audio and transcripts are processed for the live turn but are not stored by the app. This is pseudonymous data, not a claim of full anonymity: hosting/auth providers may still process technical connection information. Zero Data Retention verification and real-device voice testing remain required before the child pilot.

## Guest progress

- `cc_story_progress`: current scene, language, guidance attempt count, hint level, branch path, completed checkpoints, sticker IDs, and vocabulary IDs to revisit. Chinese and English progress are separate. Replays start a fresh visit; interrupted stories resume their current scene.
- `cc_checkpoint_summary`: administrator-only view with total evaluated attempts, hints, wrong/partial answers, completion, and assisted completion per checkpoint per visit. Unusable audio is recorded separately and is not counted as a wrong answer. Vocabulary indicates comprehension/repetition difficulty, not a pronunciation diagnosis.
- `cc_sessions` / `cc_checkpoint_events`: bounded, structured session facts. A visit keeps the same client-generated session ID across reloads and request retries. Duplicate event sequences are ignored, sequence numbers continue across reloads, stale revisions cannot rewind progress, and late saves from older visits cannot replace newer visits.
- Puzzle collections are distinct story/language pairs derived from historical `puzzle_assembled` events. They remain unlocked when a replay replaces the current progress snapshot. The guest-scoped `choochoo:collections:<profileID>` cache merges cloud unlocks with locally earned ones; collections are separate for English and Chinese and follow recovery to another device after synchronization.
- `cc_guest_profiles` / `cc_guest_members`: consent version and anonymous auth-to-profile mapping. All new tables have RLS and no direct guest table grants; the restricted `cc_guest_action` function derives ownership from `auth.uid()`.
- Settings → Progress & recovery generates a 160-bit recovery code. Only its hash is saved server-side. Anyone holding it can link a device to that profile; generating another replaces the previous code. Recovery switches profiles rather than merging their history. A lost browser session with no recovery code cannot be recovered without identity information.

Save retries run after interaction settles, on reconnect, and every 30 seconds. The exit screen shows pending cloud sync. Keep the browser open until synced when moving devices. Clearing browser data before a pending save succeeds may lose those unsynced changes. Each browser profile currently represents one learner; separate children should use separate browser profiles/devices. Define retention/deletion procedures and add anti-abuse CAPTCHA before a public launch.

To inspect progress in Supabase, open the Table Editor for `cc_story_progress`, or run `select * from public.cc_checkpoint_summary order by last_activity desc;` as an administrator. Do not expose that view publicly.

`PROGRESS_TEST_SITE=https://your-deployment.example node scripts/verify-guest-progress.mjs` explicitly creates two synthetic guest accounts and checks persistence, collection retention across replay, recovery, isolation and retries. It prints only test results and test-user IDs, never credentials. Clean up only those synthetic records if needed.

Dashboard rollout: apply `supabase/20260922_puzzle_events.sql`, then `supabase/20260923_puzzle_collections.sql` before the server/web release. The latter extends the existing authenticated progress loader and indexes assembly events; it does not create a collection table or change checkpoint snapshots. Run the opt-in integration check against a migrated staging environment before release. Older load responses without `collections` remain readable, but cross-device collection recovery requires the migration. Unlocks can only be recovered where an assembly event was saved; an old completed snapshot alone is not treated as a collected puzzle.

## Verification

Use Node 24 or newer for the TypeScript source tests:

```bash
pnpm test
pnpm lint
pnpm build
```

For local navigation and offline-error tests without sending audio, run `node tests/support/preview-api.mjs` in one terminal and `VITE_API_BASE_URL=http://127.0.0.1:8788 pnpm dev --host localhost` in another. Leave Supabase variables unset for this isolated fixture. The fixture never processes voice.

## Content and test controls

Story content lives in `src/data/stories.json`. `pnpm build` validates all story graph paths, checkpoint hints, branch targets, and sound identifiers before compiling. Illustration files can be added to `public/illustrations` using each beat's `illustrationAsset` filename.

Each dialogic-story checkpoint also awards one picture-puzzle piece, including assisted completions. The picture appears in the conversation as soon as the first piece is earned, and each new piece animates into place immediately alongside answer feedback. Previously placed pieces remain visible while the story continues. Puzzle progress is derived from completed checkpoint IDs, while the presentation-only layout rotates locally after each completed replay. The completion screen shows the already assembled picture and its controls immediately; interrupted stories keep their collected pieces without showing a false completion.

The dashboard shows all five stories with current-visit percentage bars (unique completed checkpoints divided by the route total, rounded to a whole percent) and a separate permanent-collection summary. The gallery retains piece counts. Unstarted gallery frames use dimmed, lazy-loaded artwork. In-progress pictures reveal each earned piece in full color while unearned sections stay darkened, using the active story's five- or six-piece layout without rotating it. Every layout has interlocking rounded jigsaw tabs and sockets; shared boundary geometry supplies both responsive clipping and visible SVG seams during stories, in the gallery, and in completed-picture viewers. Tapping an unfinished picture opens the story lobby without starting the microphone; collected pictures open a silent viewer. The summary counts only fully collected pictures. Replay from the viewer explicitly starts a new visit while retaining the full collected picture. Imaginative play remains outside the collection totals.

With Vite on port 5180, run `PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/support/dashboard-flow.mjs` for synthetic dashboard, responsive, keyboard, replay, recovery, and missing-image checks. Set `DASHBOARD_SCREENSHOT_DIR` to an existing output directory to capture desktop and phone previews using sample progress. These browser checks use no real microphone or cloud account.

The story-creation introduction and destination openings share one text source, `src/data/play-intro.json`, used by both the UI and Edge-TTS generator. After editing it, regenerate the recordings with `python scripts/generate_edge_tts_assets.py --play-intro-only --force` in an environment with `edge-tts` installed. Change cue IDs when replacing deployed recordings so returning visitors receive the new audio.

During a child session, press and hold the `CHOOCHOO` wordmark for the researcher drawer. Keyboard overrides are `R` for repeat, `H` for the next hint, `0` to advance, and `1`–`3` to force a choice branch.

Home settings and language selection are visible. A grown-up can tap **Turn on mic and choose** once, then the child names a story or says "surprise me"; the selected story starts its microphone and introduction automatically. A story card remains available as another way to start. The microphone control toggles listening; it is never push-to-talk. Opening the reader or exit dialog, hiding the tab, muting, or saying “pause” turns the story microphone off. Press **Resume story** to reconnect the microphone and repeat the pending narration or question; returning to the tab does not resume automatically, and no spoken “continue” is required. “Repeat the question” and its Mandarin equivalent remain available during active conversation. Story completion saves progress and opens a follow-up conversation; “goodbye” or the adult End control finishes the visit.

## Hands-free speech

Local Silero V5 voice activity detection (`@ricky0123/vad-web`) identifies utterances. Listening reacts on the first confident 32 ms speech frame instead of waiting for the minimum-speech confirmation window. It preserves 640 ms of leading audio, accepts speech as short as 192 ms, uses a low start threshold for quiet child speech, and waits through about 1.05 seconds of confident silence before stopping. A 150 ms continuation window rejoins a phrase that resumes just after an endpoint. Detection is paused and reset while ChooChoo speaks so speaker echo cannot interrupt or delay the next child turn, then resumes immediately after playback. A long utterance is split before 30 seconds. Speech streams from its first detected frame; clicks and other short false starts are discarded, and idle-room silence is not transmitted. Browser echo cancellation, noise suppression and automatic gain control are requested. This detects speech, not a particular child's identity, age or pronunciation accuracy.

New speech interrupts playback and invalidates pending transcription/reply results. Muting immediately stops the microphone tracks and cancels pending client transcription; hiding the page, leaving, or a safety pause also turns capture off. Already submitted provider requests may still incur costs. Initialization loads approximately 14 MB of model/runtime assets from this site's origin, then uses the browser cache. `scripts/prepare-vad.mjs` copies pinned package assets during dev/build; no third-party CDN is contacted.

The intro asks once for a preferred nickname, then accepts explicit readiness; “not ready” never starts the story. Pretend-play destinations are expressed naturally by voice, without option buttons or menu instructions. No intro response is counted as an incorrect checkpoint answer. New bilingual fixed prompts come from `src/data/handsfree-lines.json`; generate them with `python scripts/generate_edge_tts_assets.py --handsfree-only` in the Edge-TTS environment.

For a browser detector/transport smoke test, run Vite and open `/tests/support/streaming.html`. It uses a synthetic media stream and a mocked WebSocket; watch chunks arrive before the commit count increases. It is outside `public/` and the production build. It does not exercise the full app or real speaker echo cancellation. `scripts/verify-streaming-voice.mjs` uses generated audio to check two real cloud speech turns over the same connection, bilingual Edge audio, and a nano reply with prepared Edge audio. Set the same `VOICE_TEST_SITE` and `VOICE_TEST_SYNTHETIC_WAV` variables as the HTTP test; optional `VOICE_TEST_SOCKET` and `VOICE_TEST_ORIGIN` select a canary. Measurements are individual synthetic runs, not child-speech p95 results. Test hesitant 3–5-year-old speech on actual target devices only after the consent, supervision and ZDR prerequisites are met.
