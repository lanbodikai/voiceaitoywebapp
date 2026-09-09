# ChooChoo

Mandarin and English story conversations with saved preferences, a bilingual story reader, and imaginative play. Fixed narration uses the bundled Edge-TTS audio. Dynamic replies use browser speech synthesis.

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
4. Run `supabase/20260909_guest_progress.sql` once in the SQL Editor. It creates new `cc_*` tables without altering the legacy research tables.

## Vercel handoff

This GitHub repository has the Vite app at its root. Import it in Vercel with root directory `.`. In the original iOS monorepo, the same app lives in `web/`.

Production requests use the included `api/index.mjs` through `/api`. Add `OPENAI_API_KEY` as a server-only Vercel environment variable, plus the public Supabase values above. `VITE_API_BASE_URL` is only used during local development. Never prefix a secret with `VITE_`.

Progress is stored in Supabase under a random guest profile, with a local retry queue. The app does not collect names or emails or store recordings/transcripts. This is pseudonymous data, not a claim of full anonymity: hosting/auth providers may still process technical connection information. Zero Data Retention verification and real-device voice testing remain required before the child pilot.

## Guest progress

- `cc_story_progress`: current scene, language, guidance attempt count, hint level, branch path, completed checkpoints, sticker IDs, and vocabulary IDs to revisit. Chinese and English progress are separate. Replays start a fresh visit; interrupted stories resume their current scene.
- `cc_checkpoint_summary`: administrator-only view with total evaluated attempts, hints, wrong/partial answers, completion, and assisted completion per checkpoint per visit. Unusable audio is recorded separately and is not counted as a wrong answer. Vocabulary indicates comprehension/repetition difficulty, not a pronunciation diagnosis.
- `cc_sessions` / `cc_checkpoint_events`: bounded, structured session facts. Duplicate event sequences are ignored, stale revisions cannot rewind progress, and late saves from older visits cannot replace newer visits.
- `cc_guest_profiles` / `cc_guest_members`: consent version and anonymous auth-to-profile mapping. All new tables have RLS and no direct guest table grants; the restricted `cc_guest_action` function derives ownership from `auth.uid()`.
- Settings → Progress & recovery generates a 160-bit recovery code. Only its hash is saved server-side. Anyone holding it can link a device to that profile; generating another replaces the previous code. Recovery switches profiles rather than merging their history. A lost browser session with no recovery code cannot be recovered without identity information.

Save retries run after interaction settles, on reconnect, and every 30 seconds. The exit screen shows pending cloud sync. Keep the browser open until synced when moving devices. Clearing browser data before a pending save succeeds may lose those unsynced changes. Each browser profile currently represents one learner; separate children should use separate browser profiles/devices. Define retention/deletion procedures and add anti-abuse CAPTCHA before a public launch.

To inspect progress in Supabase, open the Table Editor for `cc_story_progress`, or run `select * from public.cc_checkpoint_summary order by last_activity desc;` as an administrator. Do not expose that view publicly.

`PROGRESS_TEST_SITE=https://your-deployment.example node scripts/verify-guest-progress.mjs` explicitly creates two synthetic guest accounts and checks persistence, recovery, isolation and retries. It prints only test results and test-user IDs, never credentials. Clean up only those synthetic records if needed.

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

The story-creation introduction and destination openings share one text source, `src/data/play-intro.json`, used by both the UI and Edge-TTS generator. After editing it, regenerate the recordings with `python scripts/generate_edge_tts_assets.py --play-intro-only --force` in an environment with `edge-tts` installed. Change cue IDs when replacing deployed recordings so returning visitors receive the new audio.

During a child session, press and hold the `CHOOCHOO` wordmark for the researcher drawer. Keyboard overrides are `R` for repeat, `H` for the next hint, `0` to advance, and `1`–`3` to force a choice branch.

Home settings and language selection are visible. Research setup and exports live under expandable Research sections. In a conversation, hold the microphone button (or Space/Enter while it is focused), then release to send. Recording is limited to 30 seconds per turn. Opening the reader or exit dialog pauses narration; Continue resumes the current section or question.
