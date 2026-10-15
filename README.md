# NOVA — AI Talking Avatar

A voice-first AI companion: talk to a 3D robot, it listens, thinks, and talks
back with an animated, expressive face. Built to be tested free today and to
scale onto Cloudflare's edge when you're ready.

## What's inside

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite + Tailwind | Dark, violet-accent immersive UI |
| Avatar | Three.js + generated GLB robot | Procedural animation: idle float, breathing, cursor tracking, speaking squash-and-stretch. 2D canvas fallback included |
| Voice (browser mode) | Web Speech API | STT + TTS with zero backend; works out of the box |
| Voice (edge mode) | Cloudflare Worker (`cloudflare/`) | Whisper `whisper-large-v3-turbo` STT → Llama 3.1 8B → Deepgram Aura TTS, all on Workers AI |
| Optional gateway | Cloudflare AI Gateway | Server-side keys, caching, rate limiting for external LLMs |

## Run locally

```bash
npm install
npm run dev
```

Open the app, allow the mic, tap the violet button and talk. Without any
backend it uses a small offline demo brain — enough to feel the interaction.

## Connect the edge backend (recommended)

Workers AI gives you **10,000 free Neurons/day — no credit card required**.

```bash
cd cloudflare
npm install -g wrangler
wrangler login
wrangler deploy
```

Then in the app: settings (top right) → paste your worker URL
(`https://nova-avatar-backend.<you>.workers.dev`) → **Connect edge backend**.

The app probes `/api/health`; when green, every turn runs
STT → LLM → TTS at the edge and the avatar speaks with a natural Aura voice
instead of the browser's system voice.

### Optional upgrades (see `cloudflare/wrangler.toml` comments)

- **AI Gateway** — route the LLM through Cloudflare AI Gateway for caching,
  rate limits, and server-side provider keys.
- **KV memory** — persist conversation history across devices.
- **Pages** — host the frontend itself on Cloudflare (`npm run build` → `dist/`).

## The avatar model

`public/robot.glb` is AI-generated from a reference design (round dark robot,
glowing orange face). If the file is missing the app falls back to a
code-drawn 2D canvas avatar automatically.

## shadcn/ui components

The UI uses shadcn/ui (`button`, `input`, `dialog`). If you clone fresh, add
them with:

```bash
npx shadcn@latest add button input dialog
```

## Notes & limitations

- Browser mode speech recognition needs Chrome/Edge; edge mode (Whisper) works everywhere.
- Nothing persists server-side unless you enable KV.
- This is a demo/pilot scaffold — add Turnstile + rate limiting before real users.
