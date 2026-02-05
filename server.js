// server.js - DestapesPR Bot 5 Pro (bilingüe ES/EN) + Case ID + Admin WhatsApp Alerts

import 'dotenv/config';
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

// =========================
// Config
// =========================
const PHONE = '+1 787-922-0068';
const FB_LINK = 'https://www.facebook.com/destapesPR/';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const WELCOME_GAP_MS = 12 * 60 * 60 * 1000; // 12h sin escribir => bienvenida otra vez

// Google Sheets webhook (Apps Script)
const LEADS_WEBHOOK_URL = process.env.LEADS_WEBHOOK_URL || '';
const LEADS_WEBHOOK_TOKEN = process.env.LEADS_WEBHOOK_TOKEN || '';

// Admin alerts (WhatsApp via Twilio REST)
const ADMIN_ALERTS_ENABLED = String(process.env.ADMIN_ALERTS_ENABLED || '0') === '1';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const ADMIN_WHATSAPP_FROM = process.env.ADMIN_WHATSAPP_FROM || '';
const ADMIN_WHATSAPP_TO = process.env.ADMIN_WHATSAPP_TO || '';

console.log('TAG:', TAG);
console.log('Node:', process.version);
console.log('LEADS_WEBHOOK_URL set?', Boolean(LEADS_WEBHOOK_URL));
console.log('LEADS_WEBHOOK_TOKEN set?', Boolean(LEADS_WEBHOOK_TOKEN));
console.log('ADMIN_ALERTS_ENABLED?', ADMIN_ALERTS_ENABLED);

// =========================
// SQLite: sesiones
// =========================
let db;

async function initDB() {
  if (db) return db;

  db = await open({ filename: './sessions.db', driver: sqlite3.Database });

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

  // Migraciones seguras
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const names = cols.map((c) => c.name);

  if (!names.includes('lang')) await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es';`);
  if (!names.includes('name')) await db.exec(`ALTER TABLE sessions ADD COLUMN name TEXT;`);
  if (!names.includes('phone')) await db.exec(`ALTER TABLE sessions ADD COLUMN phone TEXT;`);
  if (!names.includes('city')) await db.exec(`ALTER TABLE sessions ADD COLUMN city TEXT;`);
  if (!names.includes('first_seen')) await db.exec(`ALTER TABLE sessions ADD COLUMN first_seen INTEGER;`);

  // Limpiar sesiones viejas
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
// Utilidades
// =========================
function norm(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ''); // quita puntuación rara
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

  let name = null;
  if (parts[0]) {
    let p0 = parts[0]
      .replace(/^(me llamo|soy|mi nombre es)\s+/i, '')
      .replace(/^(i am|im|i'm|my name is)\s+/i, '')
      .replace(/^["'`]+|["'`]+$/g, '');
    if (norm(p0).length >= 3) name = titleCase(p0);
  }

  const phone = extractPhone(raw);

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

function isUrgent(bodyNorm) {
  return ['urgente', 'emergencia', 'emergency', 'hoy', 'ahora', 'asap', 'ya', 'inundacion', 'inundación', 'se esta regando', 'flood']
    .some((k) => bodyNorm.includes(norm(k)));
}

function isMembershipMention(bodyNorm) {
  return ['membresia', 'membresía', 'membership', 'member', 'plan', 'soy cliente', 'tengo membresia', 'tengo membresía']
    .some((k) => bodyNorm.includes(norm(k)));
}

// =========================
// Idioma
// =========================
const EN_HINTS = ['drain', 'unclog', 'clogged', 'leak', 'camera', 'inspection', 'heater', 'appointment', 'schedule', 'water', 'toilet', 'sink', 'hello', 'hi'];
const ES_HINTS = ['destape', 'tapon', 'tapada', 'tapado', 'tapao', 'fuga', 'goteo', 'camara', 'cita', 'calentador', 'inodoro', 'fregadero', 'banera', 'hola', 'buenas'];

function detectLanguage(bodyRaw, previousLang = 'es') {
  const txt = norm(bodyRaw);

  if (/\benglish\b/.test(txt) || /\bingles\b/.test(txt) || /\bingl[eé]s\b/.test(txt)) return 'en';
  if (/\bespanol\b/.test(txt) || /\bespa[ñn]ol\b/.test(txt) || /\bspanish\b/.test(txt)) return 'es';

  let en = 0, es = 0;
  for (const w of EN_HINTS) if (txt.includes(w)) en++;
  for (const w of ES_HINTS) if (txt.includes(w)) es++;

  if (en > es && en > 0) return 'en';
  if (es > en && es > 0) return 'es';
  return previousLang || 'es';
}

// =========================
// Servicios
// =========================
const SERVICE_KEYS = ['destape', 'fuga', 'camara', 'calentador', 'otro', 'cita'];
const SERVICE_KEYWORDS = {
  destape: ['destape', 'destapar', 'tapon', 'tapada', 'tapado', 'tapao', 'obstruccion', 'drenaje', 'desague', 'fregadero', 'inodoro', 'toilet', 'ducha', 'lavamanos', 'banera', 'principal', 'linea principal', 'drain', 'unclog', 'clogged', 'sewer'],
  fuga: ['fuga', 'goteo', 'salidero', 'humedad', 'filtracion', 'leak', 'leaking', 'moisture'],
  camara: ['camara', 'cámara', 'video inspeccion', 'inspeccion', 'inspection', 'camera inspection', 'sewer camera'],
  calentador: ['calentador', 'heater', 'water heater', 'gas', 'electrico', 'eléctrico', 'electric', 'hot water', 'agua caliente'],
  otro: ['otro', 'servicio', 'consulta', 'presupuesto', 'cotizacion', 'cotización', 'other', 'plumbing', 'problem'],
  cita: ['cita', 'appointment', 'schedule', 'agendar', 'reservar'],
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
// Textos UI
// =========================
function mainMenu(lang) {
  if (lang === 'en') {
    return (
      '👋 Welcome to DestapesPR.\n\n' +
      'Choose a number or type the service you need:\n\n' +
      '1️⃣ Drain cleaning\n2️⃣ Leak\n3️⃣ Camera inspection\n4️⃣ Water heater\n5️⃣ Other\n6️⃣ Appointment\n\n' +
      '💬 Commands: "start", "menu", "back". Language: "english" / "español".\n\n' +
      `📞 ${PHONE}\n📘 ${FB_LINK}`
    );
  }
  return (
    '👋 Bienvenido a DestapesPR.\n\n' +
    'Selecciona un número o escribe el servicio:\n\n' +
    '1️⃣ Destape\n2️⃣ Fuga\n3️⃣ Cámara\n4️⃣ Calentador\n5️⃣ Otro\n6️⃣ Cita\n\n' +
    '💬 Comandos: "inicio", "menu", "volver". Idioma: "english" / "español".\n\n' +
    `📞 ${PHONE}\n📘 ${FB_LINK}`
  );
}

function welcomeText({ lang, name, returning }) {
  if (lang === 'en') {
    if (returning && name) return `👋 Hi ${name}! Welcome back.\n\n`;
    if (returning) return `👋 Welcome back.\n\n`;
    return `👋 Welcome.\n\n`;
  }
  if (returning && name) return `👋 ¡Hola ${name}! Qué bueno verte de nuevo.\n\n`;
  if (returning) return `👋 ¡Bienvenido de nuevo!\n\n`;
  return `👋 ¡Bienvenido!\n\n`;
}

function serviceName(service, lang) {
  const names = {
    destape: { es: 'Destape', en: 'Drain cleaning' },
    fuga: { es: 'Fuga de agua', en: 'Water leak' },
    camara: { es: 'Inspección con cámara', en: 'Camera inspection' },
    calentador: { es: 'Calentador de agua', en: 'Water heater' },
    otro: { es: 'Otro servicio', en: 'Other service' },
    cita: { es: 'Cita / coordinar visita', en: 'Appointment' },
  };
  return (names[service] || names.otro)[lang === 'en' ? 'en' : 'es'];
}

function servicePrompt(service, lang) {
  const baseEN =
    'Send everything in ONE message:\n• Name\n• Phone\n• City\n• Description\n\nExample:\n' +
    `"Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"`;
  const baseES =
    'Envía TODO en UN solo mensaje:\n• Nombre\n• Teléfono\n• Municipio\n• Descripción\n\nEjemplo:\n' +
    `"Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`;

  return lang === 'en'
    ? `✅ Selected: ${serviceName(service, lang)}\n\n${baseEN}`
    : `✅ Seleccionaste: ${serviceName(service, lang)}\n\n${baseES}`;
}

function detailsThankYou(service, lang, details, caseId, priority, isMember) {
  const memberLine = isMember
    ? (lang === 'en' ? '⭐ Membership: YES\n' : '⭐ Membresía: SÍ\n')
    : '';

  const prLine = lang === 'en' ? `Priority: ${priority || 'Normal'}\n` : `Prioridad: ${priority || 'Normal'}\n`;
  const caseLine = lang === 'en' ? `Case ID: ${caseId}\n` : `Caso: ${caseId}\n`;

  return lang === 'en'
    ? `✅ Thank you! We saved your info.\n\n${caseLine}${prLine}${memberLine}Service: ${serviceName(service, lang)}\n\nDetails:\n"${details}"\n\nType "menu" for options.`
    : `✅ ¡Gracias! Guardamos tu información.\n\n${caseLine}${prLine}${memberLine}Servicio: ${serviceName(service, lang)}\n\nDetalles:\n"${details}"\n\nEscribe "menu" para opciones.`;
}

// =========================
// Twilio XML responder
// =========================
function sendTwilioXML(res, text) {
  const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  res.set('Content-Type', 'application/xml');
  return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`);
}

// =========================
// Admin WhatsApp alert (Twilio REST)
// =========================
async function sendAdminAlert(message) {
  if (!ADMIN_ALERTS_ENABLED) return;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !ADMIN_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
    console.log('ADMIN ALERT -> missing env vars');
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const body = new URLSearchParams({
    From: ADMIN_WHATSAPP_FROM,
    To: ADMIN_WHATSAPP_TO,
    Body: message,
  });

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(t);
    console.log('ADMIN ALERT ->', resp.status);
  } catch (e) {
    clearTimeout(t);
    console.log('ADMIN ALERT ERROR ->', String(e?.message || e));
  }
}

// =========================
// Post lead to Apps Script (token in BODY)
// =========================
async function postLeadToWebhook(payload) {
  if (!LEADS_WEBHOOK_URL) return { ok: false, error: 'LEADS_WEBHOOK_URL empty' };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  try {
    console.log('LEAD POST -> sending', { service: payload.service, name: payload.name });

    const resp = await fetch(LEADS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: LEADS_WEBHOOK_TOKEN, ...payload }),
      signal: controller.signal,
    });

    clearTimeout(t);

    const txt = await resp.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(txt); } catch { json = null; }

    console.log('LEAD POST RESULT ->', resp.status);
    console.log('LEAD POST BODY ->', txt.slice(0, 300));

    return { status: resp.status, ok: resp.ok, text: txt, json };
  } catch (e) {
    clearTimeout(t);
    console.log('LEAD POST ERROR ->', String(e?.message || e));
    return { ok: false, error: String(e?.message || e) };
  }
}

// =========================
// Rutas
// =========================
app.get('/__version', (req, res) => res.json({ ok: true, tag: TAG, tz: 'America/Puerto_Rico' }));
app.get('/', (req, res) => res.send('DestapesPR WhatsApp bot activo ✅'));

// =========================
// Webhook principal
// =========================
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from = (req.body.From || req.body.from || req.body.WaId || '').toString();
    const bodyRaw = (req.body.Body || req.body.body || '').toString();
    if (!from) return sendTwilioXML(res, 'Missing sender.');

    let session = await getSession(from);
    const isFirstTime = !session;
    if (!session) session = await saveSession(from, { lang: 'es', first_seen: Date.now() });

    // idioma
    const newLang = detectLanguage(bodyRaw, session.lang || 'es');
    if (newLang !== session.lang) session = await saveSession(from, { lang: newLang });

    const lang = session.lang || 'es';
    const bodyNorm = norm(bodyRaw);

    // bienvenida solo si primera vez o gap
    const idleMs = session.last_active ? Date.now() - Number(session.last_active) : Infinity;
    const isReturningAfterGap = !isFirstTime && idleMs > WELCOME_GAP_MS;

    const isMenuCommand = ['inicio', 'menu', 'volver', 'start', 'back', 'hola', 'hello', 'hi', 'buenas'].includes(bodyNorm);

    const isLanguageCommand =
      /\benglish\b/.test(bodyNorm) || /\bingles\b/.test(bodyNorm) || /\bingl[eé]s\b/.test(bodyNorm) ||
      /\bespanol\b/.test(bodyNorm) || /\bespa[ñn]ol\b/.test(bodyNorm) || /\bspanish\b/.test(bodyNorm);

    if (isFirstTime || isReturningAfterGap) {
      await saveSession(from, { last_choice: null, awaiting_details: 0, details: null });
      return sendTwilioXML(res, welcomeText({ lang, name: session.name, returning: !isFirstTime }) + mainMenu(lang));
    }

    // menú
    if (!bodyNorm || isMenuCommand) {
      await saveSession(from, { last_choice: null, awaiting_details: 0, details: null });
      const msg = lang === 'en' ? '🔁 Returning to menu.\n\n' : '🔁 Regresando al menú.\n\n';
      return sendTwilioXML(res, msg + mainMenu(lang));
    }

    // cambio de idioma
    if (isLanguageCommand) {
      await saveSession(from, { lang: newLang });
      const confirm = newLang === 'en' ? '✅ Language set to English.\n\n' : '✅ Idioma establecido a español.\n\n';
      return sendTwilioXML(res, confirm + mainMenu(newLang));
    }

    // si espera detalles: guarda + manda a Sheets + responde con Case ID + alerta interna
    if (session.awaiting_details && session.last_choice) {
      const { name, phone, city } = extractLeadFields(bodyRaw);

      session = await saveSession(from, {
        awaiting_details: 0,
        details: bodyRaw,
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
        ...(city ? { city } : {}),
      });

      const payload = {
        ts: new Date().toISOString(),
        from_number: from,
        lang: session.lang,
        service: session.last_choice,
        service_label: serviceName(session.last_choice, session.lang),
        name: session.name || '',
        phone: session.phone || '',
        city: session.city || '',
        details: bodyRaw,
      };

      const leadRes = await postLeadToWebhook(payload);
      const caseId = leadRes?.json?.case_id || 'DP-PENDING';
      const priority = leadRes?.json?.priority || (isUrgent(bodyNorm) ? 'Alta' : 'Normal');
      const isMember = Boolean(leadRes?.json?.is_member) || isMembershipMention(bodyNorm);

      // ✅ notificación interna (WhatsApp)
      const alertText =
        `🧾 Nuevo caso ${caseId}\n` +
        `🔧 Servicio: ${payload.service_label}\n` +
        `🔥 Prioridad: ${priority}\n` +
        `⭐ Membresía: ${isMember ? 'YES' : 'NO'}\n` +
        `👤 Cliente: ${payload.name} (${payload.city})\n` +
        `📞 Tel: ${payload.phone}\n` +
        `📝 ${String(payload.details).slice(0, 220)}`;

      await sendAdminAlert(alertText);

      // ✅ respuesta al cliente con Case ID
      return sendTwilioXML(res, detailsThankYou(session.last_choice, lang, bodyRaw, caseId, priority, isMember));
    }

    // urgencia => empujar a cita
    if (isUrgent(bodyNorm)) {
      await saveSession(from, { last_choice: 'cita', awaiting_details: 1, details: null });
      return sendTwilioXML(res, servicePrompt('cita', lang));
    }

    // detectar servicio
    const svc = matchService(bodyRaw);
    if (svc) {
      await saveSession(from, { last_choice: svc, awaiting_details: 1, details: null });
      return sendTwilioXML(res, servicePrompt(svc, lang));
    }

    // fallback
    const fallback = lang === 'en'
      ? "I didn't understand.\n\n" + mainMenu(lang)
      : 'No entendí.\n\n' + mainMenu(lang);

    return sendTwilioXML(res, fallback);
  } catch (err) {
    console.log('WEBHOOK ERROR ->', String(err?.message || err));
    return sendTwilioXML(res, 'Temporary error. Type "menu" / "inicio".');
  }
});

// =========================
// Arrancar servidor
// =========================
app.listen(PORT, () => {
  console.log(`💬 DestapesPR bot escuchando en http://localhost:${PORT}`);
});