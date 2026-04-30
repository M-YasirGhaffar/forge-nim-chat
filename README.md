# Polyglot — Multi-Model AI Chat Platform

A production-grade chat web app where authenticated users pick one of several frontier AI models, hold streaming conversations with thinking traces, attach images / PDFs / video, and watch HTML / React / SVG / code outputs render live in an artifact panel beside the chat.

Stack: **Next.js 15 (App Router)** · **Firebase** (Auth + Firestore + Storage + App Check) · **NVIDIA NIM hosted trial** as inference backend (OpenAI-compatible) · **Vercel** for hosting.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure Firebase
#    - Create a project at console.firebase.google.com
#    - Enable: Authentication (Email link + Google), Firestore (Native mode),
#      Storage, App Check (reCAPTCHA Enterprise)
#    - Create a Web app, copy config into .env.local (NEXT_PUBLIC_FIREBASE_*)
#    - Generate a service account key (Project Settings → Service accounts →
#      Generate new private key) and copy three fields into .env.local:
#        FIREBASE_ADMIN_PROJECT_ID
#        FIREBASE_ADMIN_CLIENT_EMAIL
#        FIREBASE_ADMIN_PRIVATE_KEY  (full PEM, \n-escaped or raw)

# 3. Configure NVIDIA NIM trial
#    - Sign up at build.nvidia.com (free, no card)
#    - Generate an nvapi-... key
#    - Set NVIDIA_API_KEY in .env.local

# 4. (Optional) Configure Upstash for rate limiting
#    - Sign up at upstash.com (free 10K cmds/day)
#    - Create a Redis database
#    - Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
#    - Without these, rate limiting silently no-ops.

# 5. Deploy Firestore rules + indexes
npx firebase deploy --only firestore,storage

# 6. Run dev server
npm run dev
```

The app is at <http://localhost:3000>. Sign in via email link or Google, then start a chat.

---

## Environment variables

See `.env.example`. Required:
- `NVIDIA_API_KEY` — server-only.
- `NEXT_PUBLIC_FIREBASE_*` — client (safe to expose; restricted by App Check + Firestore rules).
- `FIREBASE_ADMIN_*` — server-only.

Optional:
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — rate limiting.
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` — App Check site key. Without it, App Check is skipped in dev.
- `REQUIRE_APP_CHECK=1` — enforce App Check tokens on API routes.
- `NEXT_PUBLIC_APPCHECK_DEBUG=true` — generate App Check debug tokens (dev only).

---

## Architecture

```
Browser                                      ┌─────────────────────┐
 ┌────────┐  Firebase ID token              │ Firestore           │
 │ React  │ ──────────────────┐             │  users/{uid}        │
 │  +     │                   │             │  chats/{id}         │
 │ Auth   │                   ▼             │  chats/{id}/...     │
 └────────┘                ┌─────────────┐  └─────────────────────┘
                            │ Next.js     │             ▲
                            │ Route       │             │
                            │ Handlers    │  Admin SDK  │
                            │ (Node)      │ ────────────┘
                            └──────┬──────┘
                                   │ Bearer nvapi-...
                                   ▼
                            ┌─────────────┐
                            │ NIM trial   │
                            │ /v1/chat/...│
                            │ /v1/infer   │
                            └─────────────┘
```

- **`/api/chat`** (Node runtime) — verifies Firebase ID token, applies app rate limits, builds the NIM request (with thinking-mode normalization across models), streams the response through the **artifact parser**, and emits NDJSON to the client.
- **`/api/image`** — synchronous FLUX image generation, persists PNG to Firebase Storage.
- **`/api/files`** — short-lived signed PUT URL for attachment uploads.
- **`/api/auth/session`** — exchanges Firebase ID token for an httpOnly session cookie so SSR pages know who you are.
- **`/api/chats`**, **`/api/chats/[chatId]`**, **`/api/settings`** — chat CRUD + user prefs.

The **artifact parser** (`lib/parsers/artifact.ts`) intercepts a portable directive `::artifact{...}::` in the model's output and re-emits the body as separate NDJSON events so the client can render artifacts in a sandboxed iframe alongside chat.

The **model registry** (`lib/models/registry.ts`) is the only place model IDs live. Switch the inference backend by changing `NIM_BASE_URL` and the per-model thinking-mode normalization in `lib/nim/adapter.ts`.

---

## Models

| Model | Type | Context | Vision | Thinking | License |
|---|---|---|---|---|---|
| `deepseek-ai/deepseek-v4-pro` | LLM | 1M | – | 3 modes | MIT |
| `deepseek-ai/deepseek-v4-flash` | LLM | 1M | – | 3 modes | MIT |
| `deepseek-ai/deepseek-v3.2` | LLM | 128K | – | toggle | MIT |
| `moonshotai/kimi-k2-thinking` | LLM | 256K | – | always | Modified MIT |
| `moonshotai/kimi-k2-5` | VLM | 262K | image | toggle | Modified MIT |
| `z-ai/glm5.1` | LLM | 200K | – | toggle | NVIDIA Open |
| `qwen/qwen3.5-397b-a17b` | VLM | 262K | image+video | toggle | Apache 2.0 |
| `black-forest-labs/flux.1-schnell` | T2I | – | – | – | Apache 2.0 |
| `black-forest-labs/flux.1-dev` | T2I | – | – | – | non-commercial |
| `black-forest-labs/flux.1-kontext-dev` | T+I→I | – | – | – | non-commercial |
| `black-forest-labs/flux.2-klein-4b` | T2I | – | – | – | verify |

All endpoints share the NIM hosted base `https://integrate.api.nvidia.com/v1`. The trial is **40 RPM per model per account**.

---

## Deploying to Vercel

1. Push to GitHub.
2. Import the repo at vercel.com.
3. Set every variable from `.env.example` in **Project Settings → Environment Variables**. Mark `NVIDIA_API_KEY`, `FIREBASE_ADMIN_PRIVATE_KEY`, and Upstash creds as **Sensitive**.
4. Set the build command to `npm run build` (default).
5. Pin region to `iad1` (closest to NIM DGX Cloud).
6. Deploy.

---

## License

Polyglot itself is MIT. Outputs from FLUX.1-dev and FLUX.1 Kontext are non-commercial — these models are flagged in the picker and a banner is shown under generated images.

---

## SRS

This codebase implements the v1.0 SRS (April 30, 2026). The SRS is the contract — when something differs from the spec, that's a deliberate update; please flag it in a PR rather than silently working around it.

---

## Security

- Never commit `*-firebase-adminsdk-*.json` (already in `.gitignore`).
- The repo currently contains `nims-ai-f07c8-firebase-adminsdk-fbsvc-7c0b8d556f.json` at the project root — **delete it from disk** once env vars (`FIREBASE_ADMIN_*`) are set in `.env.local`. Gitignored ≠ safe (cloud sync, screen-share, file-picker can leak it).
- App Check debug must be `false` in production (`NEXT_PUBLIC_APPCHECK_DEBUG=false`).
