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

## Vercel handoff

This GitHub repository has the Vite app at its root. Import it in Vercel with root directory `.`. In the original iOS monorepo, the same app lives in `web/`.

Production requests use the included `api/index.mjs` through `/api`. Add `OPENAI_API_KEY` as a server-only Vercel environment variable, plus the public Supabase values above. `VITE_API_BASE_URL` is only used during local development. Never prefix a secret with `VITE_`.

Research events are queued on the device; the research upload endpoint reports unavailable until durable storage is implemented. Do not treat a session-start response as proof of durable consent or research storage. Zero Data Retention verification and real-device voice testing remain required before the child pilot.

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

During a child session, press and hold the `CHOOCHOO` wordmark for the researcher drawer. Keyboard overrides are `R` for repeat, `H` for the next hint, `0` to advance, and `1`–`3` to force a choice branch.

Home settings and language selection are visible. Research setup and exports live under expandable Research sections. In a conversation, hold the microphone button (or Space/Enter while it is focused), then release to send. Recording is limited to 30 seconds per turn. Opening the reader or exit dialog pauses narration; Continue resumes the current section or question.
