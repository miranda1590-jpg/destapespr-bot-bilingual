/*
  Minimal Venom example for a WhatsApp bot.

  This file is an example only. To use it:
  1. Install venom: npm install venom-bot
  2. Copy this file to the project root as `bot.js` or adapt it.
  3. Run: npm run bot

  The example listens for messages and replies with a simple echo + intent detection.
*/

import venom from 'venom-bot';
import dotenv from 'dotenv';
import { detectIntent, detectLang } from '../lib/helpers.js';

dotenv.config();

venom.create().then((client) => start(client));

function start(client) {
  client.onMessage(async (message) => {
    if (!message.body) return;
    const intent = detectIntent(message.body || '');
    const lang = detectLang(message.body || '');
    const reply = `Intent: ${intent} | Lang: ${lang} — You said: ${message.body}`;
    await client.sendText(message.from, reply);
  });
}

// Note: venom-bot requires a working Chrome/Chromium install and permissions.
