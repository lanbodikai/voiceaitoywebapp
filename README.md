# ChooChoo child research web app

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

1. Run `../supabase/migrations/202609070001_choochoo_web_mvp.sql` in the Supabase SQL editor.
2. In Supabase Auth, enable **Anonymous sign-ins**. No visible account or child login is used.
3. Add local and Vercel URLs to the allowed site URLs.
4. Put the service-role key only in the backend environment, along with the OpenAI key.

## Vercel handoff

Import the `web/` directory as a Vite project. Add the three `VITE_*` variables above in Vercel. Deploy the backend separately, then change `VITE_API_BASE_URL` to its HTTPS URL and add the Vercel origin to backend `ALLOWED_ORIGIN`.

The browser uses Supabase only for authentication; application records pass through the API, where the Supabase service key remains server-side.

## Content and test controls

Story content lives in `src/data/stories.json`. `pnpm build` validates all story graph paths, checkpoint hints, branch targets, and sound identifiers before compiling. Illustration files can be added to `public/illustrations` using each beat's `illustrationAsset` filename.

During a child session, press and hold the `CHOOCHOO` wordmark for the researcher drawer. Keyboard overrides are `R` for repeat, `H` for the next hint, `0` to advance, and `1`–`3` to force a choice branch.
