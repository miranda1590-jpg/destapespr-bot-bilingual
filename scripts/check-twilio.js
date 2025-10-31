#!/usr/bin/env node
// Lightweight script to report local Twilio config without revealing secrets.
const hasCreds = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER);
const liveEnabled = process.env.ENABLE_TWILIO === 'true';
console.log('Twilio configured:', hasCreds);
console.log('Live sends enabled (ENABLE_TWILIO):', liveEnabled);
if (!hasCreds) {
  console.log('\nNo Twilio credentials found in environment. For local dry-run behavior, this is expected.');
}
