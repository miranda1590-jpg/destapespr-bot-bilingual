# DestapesPR — Unified Bot (Bilingual ES/EN)

![CI](https://github.com/miranda1590-jpg/botwhatsapp/actions/workflows/ci.yml/badge.svg)

Voice (IVR) + SMS + WhatsApp con selector de idioma, respuestas bilingües y helper de fuera de horario (PR).

## Setup rápido
```bash
cp .env.example .env
npm install
npm run dev
npx ngrok http 3000
```
Configura en Twilio:
- SMS webhook → `POST https://TU_NGROK/webhooks/sms`
- Voice webhook → `POST https://TU_NGROK/webhooks/voice`
- WhatsApp webhook → `POST https://TU_NGROK/webhooks/whatsapp`

## Personalización
- Detección simple de idioma: `detectLang()`
- Intenciones: `detectIntent()`
- Mensajes: `buildTextReply()`
- After-hours: ajusta la lógica en `/webhooks/voice`

See `CONTRIBUTING.md` for developer and CI instructions.

## Docker (optional)

Build and run with Docker:

```bash
docker build -t destapespr-bot .
docker run -p 3000:3000 --env-file .env --rm destapespr-bot
```

Note: pass required env vars via `.env` or container envs (TWILIO_ACCOUNT_SID, etc.)

Safety note: outbound Twilio sends are disabled by default. To enable real sends set `ENABLE_TWILIO=true` in your `.env` (local only).

## Start both server and bot locally

If you maintain a separate `bot.js` (Venom or similar), you can start both the server and the bot with the helper script:

```bash
# make sure you have a .env file first
cp .env.example .env
npm install

# start server (nodemon) and bot (node) in background
npm run start:all
```

Notes:
- The repository includes a placeholder `bot.js` by default. Replace it with your real bot implementation (Venom-based) at the project root.
- The helper script will prompt to create `.env` from `.env.example` if missing.

Examples & Docker Compose

- The `examples/venom-bot.js` file contains a minimal Venom example. It's optional and intended as a starting point — install `venom-bot` and copy to `bot.js` to run it.

- You can run both services with Docker Compose (uses the host project files and installs dependencies inside containers):

```bash
docker-compose up --build
```

Notes: the containers install npm modules on startup. For faster iteration, run `npm install` locally and use `npm run dev` + `npm run bot` instead.