# Voice AI Toy only: AWS migration

Status: web voice cutover active. The production Vercel project uses the AWS
regional endpoint for web voice HTTP and WebSocket traffic. The old Oracle Voice
AI Toy runtime remains online for rollback and iOS; Mousefit is unchanged.

## Isolation boundary

- Do not stop or modify the shared Oracle VM, Mousefit containers/database, shared
  Caddy, or **any DNS record under mousefit.pro**.
- Keep the existing Oracle Voice AI Toy runtime for rollback and legacy iOS.
- Deploy only this repository's `api`, `server`, and `src/data` runtime inputs.
- Progress, consent, collections, and recovery stay on Vercel/Supabase. No database
  migration or database copy is required.
- Copy only Voice AI Toy's explicitly required environment values. Never copy the
  shared host's complete environment, containers, volumes, or credentials.

## Small-server runtime

The standalone entry point is `server/voice-entry.mjs`. It binds to loopback port
8787, serves voice HTTP routes under `/web/`, and upgrades `/web/voice-stream`.
It imports no legacy Oracle application. `/health` returns 503 when configuration
or the existing child-pilot privacy gate is not ready; it is not an upstream
OpenAI/Supabase availability test and incurs no model usage.

On dedicated Ubuntu servers, install Node LTS and Python from verified official
sources. Install runtime dependencies `busboy@1.6.0` and `ws@8.21.3`; create a
Python venv with `edge-tts==7.2.8`. Keep application files root-owned and run as
the unprivileged `voice-ai-toy` service account using `voice-ai-toy.service`.
Store configuration in `/etc/voice-ai-toy/runtime.env`, root-owned mode 0600.
`DEEPGRAM_API_KEY` enables progressive English Aura-2 speech. Set
`DEEPGRAM_STT=true` to use Nova-3 streaming recognition. Both new services
require a recorded `web-handsfree-1.3` consent version; older sessions stay on
OpenAI transcription and Edge-TTS. Apply
`supabase/20260927_deepgram_consent.sql` and
`supabase/20260927_consent_version_response.sql` before enabling the flag or
deploying the updated disclosure. Do not put the key in the repository,
Vercel browser variables, or logs.
Copy the *active* privacy flags exactly; never change them just to make health pass.

The service caps Node heap at 128 MB, simultaneous TTS workers at 2, and sockets
at 8 per region. These are conservative demo limits, not a load-test capacity
claim. HTTP/per-profile limits remain per process, not globally shared between
regions. Verify actual peak RSS under representative synthetic voice traffic.
Application output is suppressed; do not add request-body or child-speech logs.

Put Caddy in front of loopback port 8787. Expose only HTTP/HTTPS publicly; restrict
SSH to approved management access. Do not expose 8787 or install a database.
Attach a Lightsail static IPv4 to each instance before creating DNS records.

## Domain, regional routing, and TLS

The user purchased `260926731.xyz` at Porkbun. The planned backend hostname is
`api.260926731.xyz`; the Vercel-provided website hostname stays on Vercel.
Route 53 public hosted zone `Z03136631Y6HZQZ7QSFMF` has been created in the
approved AWS account. Porkbun now lists its four Route 53 nameservers, and the
`api` A records have US East/US West latency routing with region-specific HTTP
health checks. The `.xyz` registry and public resolvers published the new
delegation, and both health checks are healthy. Never use or change
`mousefit.pro`.

Issue one certificate on East with Certbot `webroot` at
`/var/lib/voice-ai-toy/acme`, using `--register-unsafely-without-email` so no
additional personal details are transmitted. Both port-80 Caddy configurations
serve East's challenge, regardless of which IP Route 53 returns. East's Certbot
deploy hook installs a validated fullchain/private-key pair atomically on East
and sends the same bundle to West over SSH. West accepts only a forced command
under the dedicated `voice-cert-sync` account; sudo permits only the validating
certificate installer. The dedicated key is root-only on East and pinned to the
verified West host key. Each certificate installer checks the hostname, expiry,
and matching private key before swapping `tls/current` and reloading Caddy.
Certbot's timer renews it. Monitor renewal, because the two servers share one
TLS identity and West depends on the East deploy hook. A separate daily
`voice-cert-sync.timer` reconciles a missed West copy after an outage; the
installer skips unchanged certs so it does not reload Caddy every day.

Both servers now use `Caddyfile-east`/`Caddyfile-west`, expose the standalone
voice API on HTTPS only, and keep HTTP for health/ACME only. The first real
certificate expires 2026-12-26; Certbot renewal dry-run with deploy hooks
succeeded. Direct-IP HTTPS and the published Vercel path were tested with the
synthetic canary in `scripts/smoke-aws-voice.mjs`. The canary uses anonymous
test guests and fixed synthetic text; it sends no child recording.

## Verification and rollback

1. Re-run `SMOKE_SITE=https://web-chi-one-ojsrqj7r9h.vercel.app node
   scripts/smoke-aws-voice.mjs` after infrastructure or frontend changes. It
   checks each region's health, authenticated grading, TTS, and streaming
   handshake, then confirms the published browser and Vercel proxy use AWS.
2. Verify real-device interruption/reconnect and end-of-speech-to-audio latency
   separately. DNS failover depends on caches/60-second TTL and cannot move an
   existing WebSocket. Route 53 health checks monitor the local runtime, not
   OpenAI/Supabase availability.
3. The Vercel production variables are
   `VOICE_API_ORIGIN=https://api.260926731.xyz/web` and
   `VITE_VOICE_STREAM_URL=wss://api.260926731.xyz/web/voice-stream`.
4. Rollback: remove those two Vercel production overrides and redeploy the
   prior frontend. Existing legacy defaults still route to Oracle. Do not
   delete Oracle Voice AI Toy as part of rollback.
