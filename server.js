import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import twilio from 'twilio';
const { twiml: Twiml } = twilio;

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

import { createMessage } from './lib/twilio-wrapper.js';

const PORT = process.env.PORT || 3000;
const MAIN_PHONE = process.env.DESTAPESPR_MAIN_PHONE || '+17879220068';
const SCHEDULING_URL = process.env.SCHEDULING_URL || 'https://calendly.com/tu-usuario/servicio';
const ENABLE_RECORDING = (process.env.ENABLE_RECORDING || 'true') === 'true';

/** Helpers */
import { isBusinessHoursPR, detectIntent, detectLang } from './lib/helpers.js';

/** Build replies */
function buildTextReply(intent, _fromChannel='SMS', lang='ES') {
  const es = {
    intro: 'DestapesPR 💧🚚 — ¿En qué te ayudamos hoy?',
    sched: `Agenda aquí: ${SCHEDULING_URL}`,
    EMERGENCIA: 'Parece EMERGENCIA. Envíanos dirección + fotos/video si puedes. Si necesitas hablar YA, llama ',
    AGENDAR: 'Perfecto, vamos a agendar. ',
    MEMBRESIA: 'Planes de membresía (cupos limitados): prioridad, descuentos y mantenimientos. ¿Residencial o negocio?',
    COTIZACION: 'Hagamos una cotización rápida. Dime: pueblo, servicio (destape, fuga, calentador, inspección) y fotos.',
    INSPECCION: 'Hacemos inspección con cámara y localización. Comparte dirección y síntomas.',
    OTRO: 'Podemos ayudarte con destapes, fugas, calentadores, inspecciones y membresías. ¿Qué necesitas?'
  };
  const en = {
    intro: 'DestapesPR 💧🚚 — How can we help you today?',
    sched: `Book here: ${SCHEDULING_URL}`,
    EMERGENCIA: 'It sounds like an EMERGENCY. Send address + photos/video if possible. If you need to talk NOW, call ',
    AGENDAR: 'Great, let’s schedule. ',
    MEMBRESIA: 'Membership plans (limited spots): priority response, discounts, maintenance. Residential or business?',
    COTIZACION: 'Quick quote: city, service (unclog, leak, water heater, inspection), and photos.',
    INSPECCION: 'We do camera inspection and locating. Share address and symptoms.',
    OTRO: 'We handle unclogs, leaks, water heaters, camera inspections and memberships. What do you need?'
  };
  const t = lang === 'EN' ? en : es;
  const bodies = {
    EMERGENCIA: `${t.intro}\n\n${t.EMERGENCIA}${MAIN_PHONE}.\n\n${t.sched}`,
    AGENDAR: `${t.intro}\n\n${t.AGENDAR}${t.sched}\n` + (lang==='EN' ? 'Please share name, city and 2 preferred times.' : 'Comparte nombre, pueblo y 2 horarios preferidos.'),
    MEMBRESIA: `${t.intro}\n\n${t.MEMBRESIA}\n${t.sched}`,
    COTIZACION: `${t.intro}\n\n${t.COTIZACION}\n${t.sched}`,
    INSPECCION: `${t.intro}\n\n${t.INSPECCION}\n${t.sched}`,
    OTRO: `${t.intro}\n\n${t.OTRO}\n${t.sched}`
  };
  return bodies[intent] || bodies.OTRO;
}

/** Health */
app.get('/', (req, res) => res.json({ ok: true, service: 'DestapesPR Unified Bot (Bilingual)' }));

/** WhatsApp inbound */
app.post('/webhooks/whatsapp', async (req, res) => {
  const body = req.body;
  const from = body.From;
  const text = body.Body || '';
  const intent = detectIntent(text);
  const lang = detectLang(text);
  const reply = buildTextReply(intent, 'WHATSAPP', lang);

  try {
    await createMessage({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: from,
      body: reply
    });
    res.status(200).send('OK');
  } catch (e) {
    console.error('WA error', e);
    res.status(500).send('ERR');
  }
});

/** SMS inbound */
app.post('/webhooks/sms', async (req, res) => {
  const body = req.body;
  const _from = body.From;
  const text = body.Body || '';
  const intent = detectIntent(text);
  const lang = detectLang(text);
  const reply = buildTextReply(intent, 'SMS', lang);

  const twiml = new Twiml.MessagingResponse();
  twiml.message(reply);
  // keep sender available for debugging/logging
  console.debug('SMS from:', _from);
  res.type('text/xml').send(twiml.toString());
});

/** Voice: language picker + menu + after-hours */
app.post('/webhooks/voice', (req, res) => {
  const vr = new Twiml.VoiceResponse();
  if (ENABLE_RECORDING) {
    vr.say({ language: 'es-PR' }, 'Aviso: Esta llamada puede ser grabada para fines de calidad.');
    vr.say({ language: 'en-US' }, 'Notice: This call may be recorded for quality purposes.');
  }

  if (!isBusinessHoursPR()) {
    vr.say({ language: 'es-PR' }, 'Estamos fuera de horario. Si es una emergencia, te conectaremos con un técnico ahora.');
    vr.say({ language: 'en-US' }, 'We are after-hours. If this is an emergency, we will connect you to a technician now.');
    vr.dial(MAIN_PHONE);
    return res.type('text/xml').send(vr.toString());
  }

  const gather = vr.gather({ numDigits: 1, action: '/webhooks/voice/lang', method: 'POST' });
  gather.say({ language: 'es-PR' }, 'Para español, marque 1.');
  gather.say({ language: 'en-US' }, 'For English, press 2.');
  res.type('text/xml').send(vr.toString());
});

app.post('/webhooks/voice/lang', (req, res) => {
  const digit = (req.body.Digits || '').trim();
  const lang = digit === '2' ? 'EN' : 'ES';
  const vr = new Twiml.VoiceResponse();
  const action = `/webhooks/voice/menu?lang=${lang}`;
  const gather = vr.gather({ numDigits: 1, action, method: 'POST' });

  if (lang === 'EN') {
    gather.say({ language: 'en-US' },
      'Thank you for calling Destapes P R. For emergencies, press 1. To schedule, press 2. For memberships, press 3. For a quick quote by WhatsApp, press 4. To repeat, press 9.');
  } else {
    gather.say({ language: 'es-PR' },
      'Gracias por llamar a Destapes P R. Para emergencias, presione 1. Para agendar, presione 2. Para membresías, presione 3. Para cotización por WhatsApp, presione 4. Para repetir, presione 9.');
  }

  res.type('text/xml').send(vr.toString());
});

app.post('/webhooks/voice/menu', (req, res) => {
  const vr = new Twiml.VoiceResponse();
  const lang = (req.query.lang || 'ES').toUpperCase();
  const sayES = (t)=> vr.say({ language: 'es-PR' }, t);
  const sayEN = (t)=> vr.say({ language: 'en-US' }, t);
  const digit = (req.body.Digits || '').trim();

  const say = lang === 'EN' ? sayEN : sayES;

  switch (digit) {
    case '1':
      say(lang === 'EN' ? 'Connecting you to a technician now.' : 'Conectando con un técnico ahora.');
      vr.dial(MAIN_PHONE);
      break;
    case '2':
      say(lang === 'EN' ? 'We will text you a scheduling link.' : 'Te enviaremos un mensaje de texto con el enlace para agendar.');
      if (req.body.Caller) {
        vr.message((lang === 'EN' ? 'Schedule here: ' : 'Agenda aquí: ') + SCHEDULING_URL);
      }
      say(lang === 'EN' ? 'Thank you for calling. Bye.' : 'Gracias por llamar. Hasta luego.');
      break;
    case '3':
      say(lang === 'EN'
        ? 'Our memberships include priority response, discounts and maintenance. You will receive a link with details.'
        : 'Nuestras membresías incluyen prioridad, descuentos y mantenimientos. Recibirás un enlace con los detalles.');
      if (req.body.Caller) {
        vr.message((lang === 'EN' ? 'Membership info: ' : 'Info de membresías: ') + SCHEDULING_URL);
      }
      vr.hangup();
      break;
    case '4':
      say(lang === 'EN' ? 'We will send you a WhatsApp for a quick quote.' : 'Te enviaremos un WhatsApp para cotización rápida.');
      vr.hangup();
      break;
    case '9':
    default:
      vr.redirect('/webhooks/voice');
  }
  res.type('text/xml').send(vr.toString());
});

/** Demo proactive WhatsApp */
app.post('/actions/send-wa', async (req, res) => {
  const { to, template, params=[] } = req.body || {};
  try {
    const body = `DestapesPR: ${template} ${params.join(' ')}`;
    const msg = await createMessage({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${to.replace('whatsapp:','')}`,
      body
    });
    res.json({ ok: true, sid: msg.sid || msg.sid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Health endpoint that reports non-sensitive Twilio readiness and live-send flag.
app.get('/health', (req, res) => {
  const hasTwilioCreds = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER);
  const liveEnabled = process.env.ENABLE_TWILIO === 'true';
  res.json({ ok: true, twilioConfigured: hasTwilioCreds, enableTwilio: liveEnabled });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`DestapesPR Unified Bot (Bilingual) listening on http://localhost:${PORT}`);
    console.log('Expose locally with: npx ngrok http ' + PORT);
  });
}

export { app };