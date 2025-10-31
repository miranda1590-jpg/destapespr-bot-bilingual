import 'dotenv/config';
import twilio from 'twilio';

const ENABLE = process.env.ENABLE_TWILIO === 'true';
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER } = process.env;

let client = null;
if (ENABLE && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

export async function sendWhatsApp(to, body) {
  if (!ENABLE || !client || !TWILIO_WHATSAPP_NUMBER) {
    console.log('[WA:DRYRUN]', { to, body });
    return { dryRun: true };
  }
  const from = `whatsapp:${TWILIO_WHATSAPP_NUMBER}`;
  const toNum = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const msg = await client.messages.create({ from, to: toNum, body });
  return { sid: msg.sid };
}