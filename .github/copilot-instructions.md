<!-- Short, bilingual instructions for AI coding agents. Keep edits conservative and discoverable. -->

## Quick architecture
- Two runtime modes: `server.js` (Express + Twilio webhooks) and `bot.js` (Venom multidevice WhatsApp client).
- Shared config: `SCHEDULING_URL`, `DESTAPESPR_MAIN_PHONE`, Twilio env vars.

## Run & debug
- Copy `.env.example` → `.env`, then:

  cp .env.example .env
  npm install
  npm run dev      # nodemon server.js
  npx ngrok http 3000

- Run Venom client separately: `node bot.js`.

## Conventions (follow these exactly)
- NLP: conservative regexes in `lib/helpers.js` (exported: `detectIntent`, `detectLang`, `isBusinessHoursPR`).
- Responses: message bodies live in `buildTextReply()` inside `server.js`.
- Voice menus: endpoints `/webhooks/voice`, `/webhooks/voice/lang`, `/webhooks/voice/menu` — keep DTMF ordering stable.
- Twilio contracts: SMS uses TwiML MessagingResponse (XML); WhatsApp outbound uses `client.messages.create` with `TWILIO_WHATSAPP_NUMBER`.

## Concrete examples
- Add intent "order":
  - Edit `lib/helpers.js` detectIntent to include: `/\b(order|pedido)\b/i` → return `'AGENDAR'` or custom key.
  - Add corresponding body in `server.js` `buildTextReply()` under that key (both ES/EN).

- Voice menu option (add digit 5):
  - Update spoken menu in `/webhooks/voice/lang` (the `gather.say()` text).
  - Add a `case '5':` branch in `/webhooks/voice/menu` that `vr.message(...)` or `vr.dial(...)`.

- Twilio webhook tip: configure POST URL to your ngrok url (e.g. `https://XXX.ngrok.io/webhooks/sms`) and set content type for Voice/SMS as application/x-www-form-urlencoded.

## Required env vars
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `DESTAPESPR_MAIN_PHONE`, `SCHEDULING_URL`, `PORT`, `ENABLE_RECORDING`.

## Safety rules
- Do not rename existing env vars without updating `README.md` and `server.js`.
- Do not swap regex detectors for ML models unless you add dependencies to `package.json` and document migration, plus provide tests.

If you want this shortened further, translated differently, or to add a CI workflow that runs `npm test` on PRs, say which and I will implement it.