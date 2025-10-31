## Contributing & developer guide

Quick checklist for contributors and AI coding agents. Keep changes small and discoverable.

1. Setup (local)

   cp .env.example .env
   npm install

2. Dev server

   npm run dev
   # expose to Twilio with ngrok
   npx ngrok http 3000

3. Lint & tests

   npm run lint
   npm test

3a. Git hooks (local)

   After `npm install`, run:

   npm run prepare

   This installs Husky git hooks (pre-commit runs `lint-staged`).

3b. Live Twilio sends (safety)

- By default the project will *not* perform live Twilio sends unless you explicitly enable them.
- To enable real sends during local testing, set the following in your `.env` (local only):

   ENABLE_TWILIO=true

- If `ENABLE_TWILIO` is not set to `true`, the code will run in dry-run mode and return a fake SID for outbound messages. This prevents accidental messages during development.

   Dry-run details

   - The project purposely defaults to dry-run mode. When dry-run is active, calls to `createMessage()` in `lib/twilio-wrapper.js` return an object like:

      ```js
      {
         sid: 'dry-run-<timestamp>',
         dryRun: true,
         params: { from, to, body, mediaUrl, mediaUrls },
         metadata: { enableTwilio: false, hasCreds: false }
      }
      ```

   - This makes it safe to run the app or CI without sending real messages. To enable live sends locally, set `ENABLE_TWILIO=true` in your `.env` *and* provide `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.


4. Adding intents / replies

- Edit `lib/helpers.js` -> `detectIntent(text)` and `detectLang(text)` for regex changes.
- Add corresponding responses in `server.js` `buildTextReply()` for both ES/EN.
- Keep regexes conservative. If adding ML or new deps, update `package.json` and this file.

5. Voice menus

- Update spoken prompts in `/webhooks/voice/lang` (`gather.say()`)
- Add DTMF handling in `/webhooks/voice/menu` as a `case 'X':` branch.
- Keep digit ordering stable; Twilio flows rely on positions.

6. CI and secrets

- This repo's CI runs `npm run lint` and `npm test` on PRs. It also verifies presence of these GitHub secrets:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_WHATSAPP_NUMBER`

- In GitHub: Settings → Secrets → Actions → New repository secret. Add the three keys above.

7. Updating the README CI badge

- The badge URL in `README.md` uses a placeholder `OWNER/REPO`. Replace it with your repository path:

  ![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)

  Example:

  ![CI](https://github.com/my-org/destapespr-unified-bot-bilingual/actions/workflows/ci.yml/badge.svg)

8. PR checklist

- Add a short description of the change.
- Run `npm run lint` and `npm test` locally and fix issues.
- If you changed env var names, update `README.md` and `CONTRIBUTING.md`.

If anything is unclear or you want a stricter CONTRIBUTING template (CLA, codeowners, PR template), say which and I will add it.
