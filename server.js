// server.js - DestapesPR Bot 5 Pro 🇵🇷 (Bilingüe ES/EN)
// ✅ Welcome after inactivity
// ✅ Lead capture (name/phone/city/details)
// ✅ Smart fallback (price + urgent)
// ✅ Export lead to Google Sheets (Apps Script Web App) via LEADS_WEBHOOK_URL + token
// ✅ Debug logs to diagnose Render env + webhook delivery
//
// Reqs:
//   npm i node-fetch@3
// Render env vars:
//   LEADS_WEBHOOK_URL=https://script.google.com/macros/s/XXXX/exec
//   LEADS_WEBHOOK_TOKEN=DESTAPESPR_TOKEN

import 'dotenv/config';
import fetch from 'node-fetch'; // ensures fetch on Node <18
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;
const TAG = 'DestapesPR Bot 5 Pro 🇵🇷';

let db;

const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const WELCOME_GAP_MS = 12 * 60 * 60 * 1000; // welcome again if idle 12h+

const LEADS_WEBHOOK_URL = process.env.LEADS_WEBHOOK_URL || '';
const LEADS_WEBHOOK_TOKEN = process.env.LEADS_WEBHOOK_TOKEN || '';

// Debug (no token printed)
console.log('Node:', process.version);
console.log('LEADS_WEBHOOK_URL set?', Boolean(LEADS_WEBHOOK_URL));
console.log('LEADS_WEBHOOK_TOKEN set?', Boolean(LEADS_WEBHOOK_TOKEN));

// =========================
// SQLite
// =========================
async function initDB() {
  if (db) return db;

  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT DEFAULT 'es',
      name TEXT,
      phone TEXT,
      city TEXT,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      first_seen INTEGER,
      last_active INTEGER
    );
  `);

  // migrations for older DBs
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const colNames = cols.map((c) => c.name);

  if (!colNames.includes('lang')) await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es';`);
  if (!colNames.includes('name')) await db.exec(`ALTER TABLE sessions ADD COLUMN name TEXT;`);
  if (!colNames.includes('phone')) await db.exec(`ALTER TABLE sessions ADD COLUMN phone TEXT;`);
  if (!colNames.includes('city')) await db.exec(`ALTER TABLE sessions ADD COLUMN city TEXT;`);
  if (!colNames.includes('first_seen')) await db.exec(`ALTER TABLE sessions ADD COLUMN first_seen INTEGER;`);

  // cleanup old sessions
  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);

  return db;
}

async function getSession(from) {
  return db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}

async function saveSession(from, patch = {}) {
  const prev = (await getSession(from)) || {};
  const now = Date.now();

  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    name: patch.name ?? prev.name ?? null,
    phone: patch.phone ?? prev.phone ?? null,
    city: patch.city ?? prev.city ?? null,
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    first_seen: patch.first_seen ?? prev.first_seen ?? (prev.first_seen ? prev.first_seen : now),
    last_active: now,
  };

  await db.run(
    `
    INSERT INTO sessions (from_number, lang, name, phone, city, last_choice, awaiting_details, details, first_seen, last_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      lang = excluded.lang,
      name = excluded.name,
      phone = excluded.phone,
      city = excluded.city,
      last_choice = excluded.last_choice,
      awaiting_details = excluded.awaiting_details,
      details = excluded.details,
      first_seen = excluded.first_seen,
      last_active = excluded.last_active
  `,
    [
      from,
      next.lang,
      next.name,
      next.phone,
      next.city,
      next.last_choice,
      next.awaiting_details,
      next.details,
      next.first_seen,
      next.last_active,
    ]
  );

  return next;
}

// =========================
// Helpers
// =========================
function norm(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '');
}

function titleCase(s) {
  const raw = String(s || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, ' ').slice(0, 60);
  return cleaned
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ')
    .trim();
}

function extractPhone(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (digits.length === 10) return digits.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1);
    return d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  return null;
}

function extractLeadFields(detailsRaw) {
  const raw = String(detailsRaw || '').trim();
  if (!raw) return { name: null, phone: null, city: null };

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);

  // name from first segment
  let name = null;
  if (parts[0]) {
    let p0 = parts[0];
    p0 = p0.replace(/^(me llamo|soy|mi nombre es)\s+/i, '');
    p0 = p0.replace(/^(i am|im|i'm|my name is)\s+/i, '');
    if (norm(p0).length >= 3) name = titleCase(p0);
  }

  // phone anywhere
  const phone = extractPhone(raw);

  // city from next segment without digits
  let city = null;
  for (const p of parts.slice(1)) {
    const pn = norm(p);
    if (!/\d/.test(pn) && pn.length >= 3) {
      city = titleCase(p);
      break;
    }
  }

  return { name, phone, city };
}

// =========================
// Language detection
// =========================
const EN_HINTS = ['drain','unclog','clogged','leak','camera','inspection','heater','appointment','schedule','water','toilet','sink','hello','hi'];
const ES_HINTS = ['destape','tapon','tapada','tapado','tapao','fuga','goteo','camara','cita','calentador','inodoro','fregadero','banera','buenas','hola'];

function detectLanguage(bodyRaw, previousLang = 'es') {
  const txt = norm(bodyRaw);

  if (/\benglish\b/.test(txt) || /\bingles\b/.test(txt) || /\bingl[eé]s\b/.test(txt)) return 'en';
  if (/\bespanol\b/.test(txt) || /\bespa[ñn]ol\b/.test(txt) || /\bspanish\b/.test(txt)) return 'es';

  let en = 0;
  let es = 0;
  for (const w of EN_HINTS) if (txt.includes(w)) en++;
  for (const w of ES_HINTS) if (txt.includes(w)) es++;

  if (en > es && en > 0) return 'en';
  if (es > en && es > 0) return 'es';
  return previousLang || 'es';
}

// =========================
// Service matching
// =========================
const SERVICE_KEYS = ['destape', 'fuga', 'camara', 'calentador', 'otro', 'cita'];

const SERVICE_KEYWORDS = {
  destape: [
    'destape','destapar','tapon','tapada','tapado','tapao','obstruccion','drenaje','desague',
    'fregadero','lavaplatos','inodoro','toilet','ducha','lavamanos','banera','bañera',
    'principal','linea principal','drain','unclog','clogged','sewer','tubo','bajante','bajada','alcantarillado'
  ],
  fuga: ['fuga','goteo','goteando','salidero','humedad','filtracion','leak','leaking','moisture'],
  camara: ['camara','cámara','video inspeccion','inspeccion','inspection','camera inspection','sewer camera'],
  calentador: ['calentador','heater','water heater','boiler','gas','electrico','eléctrico','electric','hot water','agua caliente'],
  otro: ['otro','servicio','consulta','presupuesto','cotizacion','cotización','other','plumbing','problem','presion','no tengo agua','cisterna','bomba'],
  cita: ['cita','appointment','schedule','agendar','reservar'],
};

function matchService(bodyRaw) {
  const txt = norm(bodyRaw);

  const mapNums = { '1': 'destape', '2': 'fuga', '3': 'camara', '4': 'calentador', '5': 'otro', '6': 'cita' };
  if (mapNums[txt]) return mapNums[txt];

  for (const key of SERVICE_KEYS) {
    if (SERVICE_KEYWORDS[key].some((w) => txt.includes(norm(w)))) return key;
  }
  return null;
}

// =========================
// Smart fallback
// =========================
function wantsPrice(bodyNorm) {
  return [
    'precio','precios','cuanto','cuánto','costo','costos','tarifa','valor',
    'estimate','estimado','quote','cotizacion','cotización'
  ].some((k) => bodyNorm.includes(norm(k)));
}

function isUrgent(bodyNorm) {
  return [
    'urgente','emergencia','emergency','hoy','ahora','asap','ya',
    'inundacion','inundación','se esta regando','se esta botando','flood'
  ].some((k) => bodyNorm.includes(norm(k)));
}

// =========================
// Text / menus
// =========================
const PHONE = '+1 787-922-0068';
const FB_LINK = 'https://www.facebook.com/destapesPR/';

function mainMenu(lang) {
  if (lang === 'en') {
    return (
      '👋 Welcome to DestapesPR.\n\n' +
      'Please choose a number or type the service you need:\n\n' +
      '1️⃣ Drain cleaning (clogged drains/pipes)\n' +
      '2️⃣ Leak (water leaks / dampness)\n' +
      '3️⃣ Camera inspection (video)\n' +
      '4️⃣ Water heater (gas or electric)\n' +
      '5️⃣ Other plumbing service\n' +
      '6️⃣ Appointment / schedule a visit\n\n' +
      '💬 Commands:\n' +
      'Type "start", "menu" or "back" to return to this menu.\n' +
      'Type "english" or "español / espanol" to change language.\n\n' +
      `📞 Phone: ${PHONE}\n` +
      `📘 Facebook: ${FB_LINK}`
    );
  }

  return (
    '👋 Bienvenido a DestapesPR.\n\n' +
    'Por favor, selecciona un número o escribe el servicio que necesitas:\n\n' +
    '1️⃣ Destape (drenajes o tuberías tapadas)\n' +
    '2️⃣ Fuga de agua (goteos / filtraciones)\n' +
    '3️⃣ Inspección con cámara (video)\n' +
    '4️⃣ Calentador de agua (gas o eléctrico)\n' +
    '5️⃣ Otro servicio de plomería\n' +
    '6️⃣ Cita / coordinar visita\n\n' +
    '💬 Comandos:\n' +
    'Escribe "inicio", "menu" o "volver" para regresar a este menú.\n' +
    'Escribe "english" o "español / espanol" para cambiar de idioma.\n\n' +
    `📞 Teléfono: ${PHONE}\n` +
    `📘 Facebook: ${FB_LINK}`
  );
}

function welcomeText({ lang, name, returning }) {
  if (lang === 'en') {
    if (returning && name) return `👋 Hi ${name}! Welcome back to DestapesPR.\n\n`;
    if (returning) return `👋 Welcome back to DestapesPR.\n\n`;
    return `👋 Welcome to DestapesPR.\n\n`;
  }
  if (returning && name) return `👋 ¡Hola ${name}! Qué bueno verte de nuevo en DestapesPR.\n\n`;
  if (returning) return `👋 ¡Bienvenido de nuevo a DestapesPR!\n\n`;
  return `👋 ¡Bienvenido a DestapesPR!\n\n`;
}

function serviceName(service, lang) {
  const names = {
    destape: { es: 'Destape', en: 'Drain cleaning' },
    fuga: { es: 'Fuga de agua', en: 'Water leak' },
    camara: { es: 'Inspección con cámara', en: 'Camera inspection' },
    calentador: { es: 'Calentador de agua', en: 'Water heater' },
    otro: { es: 'Otro servicio de plomería', en: 'Other plumbing service' },
    cita: { es: 'Cita / coordinar visita', en: 'Appointment' },
  };
  return (names[service] || names.otro)[lang === 'en' ? 'en' : 'es'];
}

function servicePrompt(service, lang) {
  if (service === 'destape') {
    return lang === 'en'
      ? '✅ Selected service: Drain cleaning\n\n' +
          'Please send everything in a single message:\n' +
          '• 🧑‍🎓 Full name\n' +
          '• 📞 Contact number (US/PR)\n' +
          '• 📍 City / area / sector\n' +
          '• 📝 Short description of the issue (sink, toilet, main line, etc.)\n\n' +
          'Example:\n' +
          `"I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"\n\n` +
          'We will review your information and contact you as soon as possible.'
      : '✅ Servicio seleccionado: Destape\n\n' +
          'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
          '• 🧑‍🎓 Nombre completo\n' +
          '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
          '• 📍 Zona / municipio / sector\n' +
          '• 📝 Descripción breve del problema (fregadero, inodoro, línea principal, etc.)\n\n' +
          'Ejemplo:\n' +
          `"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n\n` +
          'Revisaremos tu información y nos comunicaremos lo antes posible.';
  }

  if (service === 'fuga') {
    return lang === 'en'
      ? '✅ Selected service: Water leak\n\n' +
          'Please send everything in a single message:\n' +
          '• 🧑‍🎓 Full name\n' +
          '• 📞 Contact number (US/PR)\n' +
          '• 📍 City / area / sector\n' +
          '• 📝 Where do you see the leak or dampness? (wall, ceiling, floor, etc.)\n\n' +
          'Example:\n' +
          `"I'm Ana Rivera, 939-555-9999, Caguas, water leak in the bathroom ceiling"\n\n` +
          'We will review your information and contact you as soon as possible.'
      : '✅ Servicio seleccionado: Fuga de agua\n\n' +
          'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
          '• 🧑‍🎓 Nombre completo\n' +
          '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
          '• 📍 Zona / municipio / sector\n' +
          '• 📝 Dónde notas la fuga o la humedad (pared, techo, piso, etc.)\n\n' +
          'Ejemplo:\n' +
          `"Me llamo Ana Rivera, 939-555-9999, Caguas, fuga en el techo del baño"\n\n` +
          'Revisaremos tu información y nos comunicaremos lo antes posible.';
  }

  if (service === 'camara') {
    return lang === 'en'
      ? '✅ Selected service: Camera inspection\n\n' +
          'Please send everything in a single message:\n' +
          '• 🧑‍🎓 Full name\n' +
          '• 📞 Contact number (US/PR)\n' +
          '• 📍 City / area / sector\n' +
          '• 📝 Area to inspect (bathroom, kitchen, main line, etc.)\n\n' +
          'Example:\n' +
          `"I'm Ana Rivera, 939-555-9999, Caguas, camera inspection in main sewer line"\n\n` +
          'We will review your information and contact you as soon as possible.'
      : '✅ Servicio seleccionado: Inspección con cámara\n\n' +
          'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
          '• 🧑‍🎓 Nombre completo\n' +
          '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
          '• 📍 Zona / municipio / sector\n' +
          '• 📝 Área a inspeccionar (baño, cocina, línea principal, etc.)\n\n' +
          'Ejemplo:\n' +
          `"Me llamo Ana Rivera, 939-555-9999, Caguas, inspección con cámara en la línea principal"\n\n` +
          'Revisaremos tu información y nos comunicaremos lo antes posible.';
  }

  if (service === 'calentador') {
    return lang === 'en'
      ? '✅ Selected service: Water heater (gas or electric)\n\n' +
          'Please send everything in a single message:\n' +
          '• 🧑‍🎓 Full name\n' +
          '• 📞 Contact number (US/PR)\n' +
          '• 📍 City / area / sector\n' +
          '• 📝 Type of heater and problem (gas/electric, not heating, leaking, etc.)\n\n' +
          'Example:\n' +
          `"I'm Ana Rivera, 939-555-9999, Caguas, electric water heater not heating"\n\n` +
          'We will review your information and contact you as soon as possible.'
      : '✅ Servicio seleccionado: Calentador de agua\n\n' +
          'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
          '• 🧑‍🎓 Nombre completo\n' +
          '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
          '• 📍 Zona / municipio / sector\n' +
          '• 📝 Tipo de calentador y problema (gas/eléctrico, no calienta, fuga, etc.)\n\n' +
          'Ejemplo:\n' +
          `"Me llamo Ana Rivera, 939-555-9999, Caguas, calentador eléctrico no calienta"\n\n` +
          'Revisaremos tu información y nos comunicaremos lo antes posible.';
  }

  if (service === 'cita') {
    return lang === 'en'
      ? '✅ Selected: Schedule an appointment\n\n' +
          'Please send everything in a single message:\n' +
          '• 🧑‍🎓 Full name\n' +
          '• 📞 Contact number (US/PR)\n' +
          '• 📍 City / area / sector\n' +
          '• 📝 Preferred days and time range\n' +
          '• 📝 Short description of the plumbing issue\n\n' +
          'Example:\n' +
          `"I'm Ana Rivera, 939-555-9999, Caguas, prefer Monday–Wednesday 10am–1pm, kitchen sink clogged"\n\n` +
          'We will review your information and contact you as soon as possible.'
      : '✅ Servicio seleccionado: Cita / coordinar visita\n\n' +
          'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
          '• 🧑‍🎓 Nombre completo\n' +
          '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
          '• 📍 Zona / municipio / sector\n' +
          '• 📝 Días y horario aproximado de disponibilidad\n' +
          '• 📝 Descripción breve del problema de plomería\n\n' +
          'Ejemplo:\n' +
          `"Me llamo Ana Rivera, 939-555-9999, Caguas, prefiero lunes a miércoles 10am–1pm, fregadero de cocina tapado"\n\n` +
          'Revisaremos tu información y nos comunicaremos lo antes posible.';
  }

  return lang === 'en'
    ? '✅ Selected service: Other plumbing service\n\n' +
        'Please send everything in a single message:\n' +
        '• 🧑‍🎓 Full name\n' +
        '• 📞 Contact number (US/PR)\n' +
        '• 📍 City / area / sector\n' +
        '• 📝 Short description of the service you need\n\n' +
        'Example:\n' +
        `"I'm Ana Rivera, 939-555-9999, Caguas, need estimate for bathroom remodeling"\n\n` +
        'We will review your information and contact you as soon as possible.'
    : '✅ Servicio seleccionado: Otro servicio de plomería\n\n' +
        'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
        '• 🧑‍🎓 Nombre completo\n' +
        '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
        '• 📍 Zona / municipio / sector\n' +
        '• 📝 Descripción breve del servicio que necesitas\n\n' +
        'Ejemplo:\n' +
        `"Me llamo Ana Rivera, 939-555-9999, Caguas, necesito estimado para remodelación de baño"\n\n` +
        'Revisaremos tu información y nos comunicaremos lo antes posible.';
}

function detailsThankYou(service, lang, details, session) {
  const sName = session?.name ? ` ${session.name}` : '';
  const sCity = session?.city ? ` (${session.city})` : '';
  const sPhone = session?.phone ? ` • ${session.phone}` : '';

  return lang === 'en'
    ? '✅ Thank you, we saved your information.\n\n' +
        `Service: ${serviceName(service, lang)}\n` +
        `Contact:${sName}${sCity}${sPhone}\n\n` +
        `Details:\n"${details}"\n\n` +
        'We will review your information and contact you as soon as possible.\n\n' +
        'To return to the menu, type "menu" or "start".'
    : '✅ Gracias, hemos guardado tu información.\n\n' +
        `Servicio: ${serviceName(service, lang)}\n` +
        `Contacto:${sName}${sCity}${sPhone}\n\n` +
        `Detalles:\n"${details}"\n\n` +
        'Revisaremos tu información y nos comunicaremos lo antes posible.\n\n' +
        'Para regresar al menú escribe "menu", "inicio" o "volver".';
}

// =========================
// Twilio XML
// =========================
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.send(xml);
}

// =========================
// Google Sheets Webhook
// =========================
async function postLeadToWebhook(payload) {
  if (!LEADS_WEBHOOK_URL) {
    console.log('LEAD POST -> skipped (LEADS_WEBHOOK_URL empty)');
    return { ok: false, skipped: true };
  }

  console.log('LEAD POST -> sending', { service: payload?.service, name: payload?.name || null });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(LEADS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(LEADS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${LEADS_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(t);

    console.log('LEAD POST RESULT ->', res.status);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.log('LEAD POST BODY ->', txt.slice(0, 300));
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    clearTimeout(t);
    console.log('LEAD POST ERROR ->', String(e?.message || e));
    return { ok: false, error: String(e?.message || e) };
  }
}

// =========================
// Routes
// =========================
app.get('/__version', (req, res) => res.json({ ok: true, tag: TAG, tz: 'America/Puerto_Rico' }));
app.get('/', (req, res) => res.send('DestapesPR WhatsApp bot activo ✅'));

// =========================
// WhatsApp webhook
// =========================
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from = (req.body.From || req.body.from || req.body.WaId || '').toString();
    const bodyRaw = (req.body.Body || req.body.body || '').toString();

    if (!from) return sendTwilioXML(res, 'Missing sender.');

    let session = await getSession(from);
    const isFirstTime = !session;

    if (!session) {
      session = await saveSession(from, { lang: 'es', first_seen: Date.now() });
    }

    // Detect language
    const newLang = detectLanguage(bodyRaw, session.lang || 'es');
    if (newLang !== session.lang) session = await saveSession(from, { lang: newLang });

    const lang = session.lang || 'es';
    const bodyNorm = norm(bodyRaw);

    // Welcome after inactivity
    const idleMs = session.last_active ? Date.now() - Number(session.last_active) : Infinity;
    const isReturningAfterGap = !isFirstTime && idleMs > WELCOME_GAP_MS;

    // Commands
    const isMenuCommand = [
      'inicio','menu','volver','start','back',
      'hola','hello','hi','buenas','buenos dias','buenas tardes','buenas noches'
    ].includes(bodyNorm);

    const isLanguageCommand =
      /\benglish\b/.test(bodyNorm) ||
      /\bingles\b/.test(bodyNorm) ||
      /\bingl[eé]s\b/.test(bodyNorm) ||
      /\bespanol\b/.test(bodyNorm) ||
      /\bespa[ñn]ol\b/.test(bodyNorm) ||
      /\bspanish\b/.test(bodyNorm);

    // 1) Welcome only first time or after long gap
    if (isFirstTime || isReturningAfterGap) {
      await saveSession(from, { last_choice: null, awaiting_details: 0, details: null });
      const welcome = welcomeText({ lang, name: session.name, returning: !isFirstTime });
      return sendTwilioXML(res, welcome + mainMenu(lang));
    }

    // 2) Menu command (no welcome)
    if (!bodyNorm || isMenuCommand) {
      await saveSession(from, { last_choice: null, awaiting_details: 0, details: null });
      const reply =
        lang === 'en'
          ? '🔁 Returning to the main menu.\n\n' + mainMenu(lang)
          : '🔁 Regresando al menú principal.\n\n' + mainMenu(lang);
      return sendTwilioXML(res, reply);
    }

    // 3) Language command (confirm + menu)
    if (isLanguageCommand) {
      const confirm = newLang === 'en' ? '✅ Language set to English.\n\n' : '✅ Idioma establecido a español.\n\n';
      await saveSession(from, { lang: newLang });
      return sendTwilioXML(res, confirm + mainMenu(newLang));
    }

    // 4) Awaiting details -> save + export to Sheets
    if (session.awaiting_details && session.last_choice) {
      const { name, phone, city } = extractLeadFields(bodyRaw);

      session = await saveSession(from, {
        awaiting_details: 0,
        details: bodyRaw,
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
        ...(city ? { city } : {}),
      });

      await postLeadToWebhook({
        ts: new Date().toISOString(),
        from_number: from,
        lang: session.lang,
        service: session.last_choice,
        service_label: serviceName(session.last_choice, session.lang),
        name: session.name || null,
        phone: session.phone || null,
        city: session.city || null,
        details: bodyRaw,
      });

      return sendTwilioXML(res, detailsThankYou(session.last_choice, lang, bodyRaw, session));
    }

    // 5) Smart fallback: urgent -> appointment
    if (isUrgent(bodyNorm)) {
      await saveSession(from, { last_choice: 'cita', awaiting_details: 1, details: null });
      return sendTwilioXML(res, servicePrompt('cita', lang));
    }

    // 6) Smart fallback: price -> ask service
    if (wantsPrice(bodyNorm)) {
      const msg =
        lang === 'en'
          ? '💲 Sure — to give you the right price, tell us which service you need (choose 1–6):\n\n'
          : '💲 Claro — para darte el precio correcto, dime qué servicio necesitas (elige 1–6):\n\n';
      return sendTwilioXML(res, msg + mainMenu(lang));
    }

    // 7) Match service
    const svc = matchService(bodyRaw);
    if (svc) {
      await saveSession(from, { last_choice: svc, awaiting_details: 1, details: null });
      return sendTwilioXML(res, servicePrompt(svc, lang));
    }

    // 8) Fallback
    const fallback =
      lang === 'en'
        ? "I didn't understand your message.\n\n" + mainMenu(lang)
        : 'No entendí tu mensaje.\n\n' + mainMenu(lang);

    return sendTwilioXML(res, fallback);
  } catch (err) {
    console.log('WEBHOOK ERROR ->', String(err?.message || err));
    return sendTwilioXML(res, 'Temporary error. Please type "menu" / "inicio" and try again.');
  }
});

// =========================
// Start
// =========================
app.listen(PORT, () => {
  console.log(`💬 DestapesPR bot escuchando en http://localhost:${PORT}`);
});