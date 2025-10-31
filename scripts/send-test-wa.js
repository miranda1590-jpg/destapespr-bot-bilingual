#!/usr/bin/env node
/*
  Lightweight test script to send a WhatsApp message via the repo's
  `createMessage` wrapper. It respects the `ENABLE_TWILIO` flag and will
  perform a dry-run if Twilio is not configured.

  Usage:
    # create .env from example and edit TWILIO_WHATSAPP_NUMBER and recipient
    cp .env.example .env
    # set TEST_WHATSAPP_TO to the target (e.g. whatsapp:+123...)
    TEST_WHATSAPP_TO="whatsapp:+1xxxxxxxxxx" node scripts/send-test-wa.js

*/

import dotenv from 'dotenv';
import { createMessage } from '../lib/twilio-wrapper.js';

dotenv.config();

const to = process.env.TEST_WHATSAPP_TO || process.argv[2];
if (!to) {
  console.error('Usage: TEST_WHATSAPP_TO="whatsapp:+123..." node scripts/send-test-wa.js');
  process.exit(2);
}

async function run() {
  try {
    const from = process.env.TWILIO_WHATSAPP_NUMBER;
    if (!from) {
      console.warn('TWILIO_WHATSAPP_NUMBER not set in .env — create .env from .env.example or set the var.');
    }

    const res = await createMessage({
      from: from || 'whatsapp:+00000000000',
      to,
      body: `Test message from destapespr repo at ${new Date().toISOString()}`
    });

    console.log('Result:', res);
  } catch (err) {
    console.error('Error sending test WA:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

run();
