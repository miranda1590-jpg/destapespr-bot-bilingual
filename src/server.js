import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fetch from 'node-fetch';
import twilio from 'twilio';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;
const TAG = process.env.TAG || "DestapesPR Unified Bot 🇵🇷 [[CLEAN-DATA-080435]]";

const PHONE = '+1 787-922-0068';
const FB_LINK = 'https://www.facebook.com/destapesPR/';

const SCRIPT_WEBAPP_URL =
  process.env.APPS_SCRIPT_URL ||
  process.env.SCRIPT_WEBAPP_URL ||
  process.env.LEADS_WEBHOOK_URL ||
  '';
const SCRIPT_TOKEN =
  process.env.APPS_SCRIPT_TOKEN ||
  process.env.DESTAPESPR_TOKEN ||
  process.env.LEADS_WEBHOOK_TOKEN ||
  '';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM =
  process.env.TWILIO_WHATSAPP_FROM ||
  process.env.TWILIO_PHONE_NUMBER ||
  process.env.TWILIO_FROM ||
  '';
const ADMIN_TO =
  process.env.ADMIN_ALERT_TO ||
  process.env.ADMIN_WHATSAPP ||
  process.env.ADMIN_TO ||
  '';

const tw = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
const WELCOME_TTL_MS = 12 * 60 * 60 * 1000;

let db;

async function initDB() {
  if (db) return db;

  db = await open({ filename: './sessions.db', driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT DEFAULT 'es',
      last_choice TEXT,
      case_id TEXT,
      heater_type TEXT,
      awaiting_heater_type INTEGER DEFAULT 0,
      awaiting_details INTEGER DEFAULT 0,
      awaiting_schedule INTEGER DEFAULT 0,
      awaiting_slot INTEGER DEFAULT 0,
      details TEXT,
      slots_json TEXT,
      last_active INTEGER
    );
  `);

  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const need = [
    ['lang', `ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es';`],
    ['last_choice', `ALTER TABLE sessions ADD COLUMN last_choice TEXT;`],
    ['case_id', `ALTER TABLE sessions ADD COLUMN case_id TEXT;`],
    ['heater_type', `ALTER TABLE sessions ADD COLUMN heater_type TEXT;`],
    ['awaiting_heater_type', `ALTER TABLE sessions ADD COLUMN awaiting_heater_type INTEGER DEFAULT 0;`],
    ['awaiting_details', `ALTER TABLE sessions ADD COLUMN awaiting_details INTEGER DEFAULT 0;`],
    ['awaiting_schedule', `ALTER TABLE sessions ADD COLUMN awaiting_schedule INTEGER DEFAULT 0;`],
    ['awaiting_slot', `ALTER TABLE sessions ADD COLUMN awaiting_slot INTEGER DEFAULT 0;`],
    ['details', `ALTER TABLE sessions ADD COLUMN details TEXT;`],
    ['slots_json', `ALTER TABLE sessions ADD COLUMN slots_json TEXT;`],
    ['last_active', `ALTER TABLE sessions ADD COLUMN last_active INTEGER;`],
  ];
  const has = (n) => cols.some(c => c.name === n);
  for (const [n, ddl] of need) if (!has(n)) await db.exec(ddl);

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
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    case_id: patch.case_id ?? prev.case_id ?? null,
    heater_type: patch.heater_type ?? prev.heater_type ?? null,
    awaiting_heater_type: patch.awaiting_heater_type ?? prev.awaiting_heater_type ?? 0,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    awaiting_schedule: patch.awaiting_schedule ?? prev.awaiting_schedule ?? 0,
    awaiting_slot: patch.awaiting_slot ?? prev.awaiting_slot ?? 0,
    details: patch.details ?? prev.details ?? null,
    slots_json: patch.slots_json ?? prev.slots_json ?? null,
    last_active: now
  };

  await db.run(
    `
      INSERT INTO sessions (from_number, lang, last_choice, case_id, heater_type, awaiting_heater_type, awaiting_details, awaiting_schedule, awaiting_slot, details, slots_json, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_number) DO UPDATE SET
        lang = excluded.lang,
        last_choice = excluded.last_choice,
        case_id = excluded.case_id,
        heater_type = excluded.heater_type,
        awaiting_heater_type = excluded.awaiting_heater_type,
        awaiting_details = excluded.awaiting_details,
        awaiting_schedule = excluded.awaiting_schedule,
        awaiting_slot = excluded.awaiting_slot,
        details = excluded.details,
        slots_json = excluded.slots_json,
        last_active = excluded.last_active
    `,
    [
      from,
      next.lang,
      next.last_choice,
      next.case_id,
      next.heater_type,
      next.awaiting_heater_type,
      next.awaiting_details,
      next.awaiting_schedule,
      next.awaiting_slot,
      next.details,
      next.slots_json,
      next.last_active
    ]
  );

  return next;
}

function norm(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

const EN_HINTS = ['drain','unclog','clogged','leak','camera','inspection','heater','appointment','schedule','water','toilet','sink','solar'];
const ES_HINTS = ['destape','tapon','tapada','fuga','goteo','camara','cita','calentador','inodoro','fregadero','banera','bañera','solar'];

function detectLanguage(bodyRaw, previousLang = 'es') {
  const txt = norm(bodyRaw);
  if (/\benglish\b/.test(txt) || /\bingles\b/.test(txt) || /\bingl[eé]s\b/.test(txt)) return 'en';
  if (/\bespanol\b/.test(txt) || /\bespa[ñn]ol\b/.test(txt) || /\bspanish\b/.test(txt)) return 'es';

  let enScore = 0;
  let esScore = 0;
  for (const w of EN_HINTS) if (txt.includes(w)) enScore++;
  for (const w of ES_HINTS) if (txt.includes(w)) esScore++;
  if (enScore > esScore && enScore > 0) return 'en';
  if (esScore > enScore && esScore > 0) return 'es';
  return previousLang || 'es';
}

const SERVICE_KEYS = ['destape', 'fuga', 'camara', 'calentador', 'otro', 'cita'];
const SERVICE_KEYWORDS = {
  destape: ['destape','destapar','tapon','tapada','tapado','obstruccion','drenaje','desague','fregadero','lavaplatos','inodoro','toilet','ducha','lavamanos','banera','principal','linea principal','drain','drain cleaning','unclog','clogged','sewer'],
  fuga: ['fuga','goteo','goteando','salidero','fuga de agua','humedad','filtracion','leak','water leak','leaking','moisture'],
  camara: ['camara','video inspeccion','inspeccion','inspection','camera inspection','sewer camera'],
  calentador: ['calentador','boiler','heater','water heater','gas','electrico','electric','hot water','agua caliente','solar','calentador solar','solar heater'],
  otro: ['otro','otros','servicio','consulta','presupuesto','cotizacion','other','plumbing','problem'],
  cita: ['cita','appointment','schedule','agendar','reservar']
};

function matchService(bodyRaw) {
  const txt = norm(bodyRaw);
  const mapNums = { '1': 'destape', '2': 'fuga', '3': 'camara', '4': 'calentador', '5': 'otro', '6': 'cita' };
  if (mapNums[txt]) return mapNums[txt];
  for (const key of SERVICE_KEYS) if (SERVICE_KEYWORDS[key].some(w => txt.includes(w))) return key;
  return null;
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

function mainMenu(lang) {
  if (lang === 'en') {
    return (
      `👋 Welcome to DestapesPR.\n\n` +
      `Choose a number or type what you need:\n\n` +
      `1️⃣ Drain cleaning (clogged drains/pipes)\n` +
      `2️⃣ Leak (water leaks / dampness)\n` +
      `3️⃣ Camera inspection (video)\n` +
      `4️⃣ Water heater (gas/electric/solar)\n` +
      `5️⃣ Other plumbing service\n` +
      `6️⃣ Appointment / schedule a visit\n\n` +
      `💬 Commands:\n` +
      `Type "start", "menu" or "back" to return here.\n` +
      `Type "english" or "español / espanol" to change language.\n\n` +
      `📞 Phone: ${PHONE}\n` +
      `📘 Facebook: ${FB_LINK}`
    );
  }

  return (
    `👋 Bienvenido a DestapesPR.\n\n` +
    `Selecciona un número o escribe lo que necesitas:\n\n` +
    `1️⃣ Destape (drenajes o tuberías tapadas)\n` +
    `2️⃣ Fuga de agua (goteos / filtraciones)\n` +
    `3️⃣ Inspección con cámara (video)\n` +
    `4️⃣ Calentador (gas/eléctrico/solar)\n` +
    `5️⃣ Otro servicio de plomería\n` +
    `6️⃣ Cita / coordinar visita\n\n` +
    `💬 Comandos:\n` +
    `Escribe "inicio", "menu" o "volver" para regresar aquí.\n` +
    `Escribe "english" o "español / espanol" para cambiar el idioma.\n\n` +
    `📞 Teléfono: ${PHONE}\n` +
    `📘 Facebook: ${FB_LINK}`
  );
}

function heaterTypeMenu(lang) {
  if (lang === 'en') {
    return (
      `✅ Selected: Water heater (gas/electric/solar)\n\n` +
      `Choose heater type:\n` +
      `1️⃣ Solar\n` +
      `2️⃣ Conventional (gas/electric)\n\n` +
      `Reply with 1 or 2.`
    );
  }
  return (
    `✅ Servicio: Calentador (gas/eléctrico/solar)\n\n` +
    `Antes de los detalles, elige tipo:\n` +
    `1️⃣ Solar\n` +
    `2️⃣ Convencional (gas/eléctrico)\n\n` +
    `Responde con 1 o 2.`
  );
}

function servicePrompt(service, lang) {
  const baseEN =
    `Please send everything in ONE message:\n` +
    `• 🧑‍🎓 Full name\n` +
    `• 📞 Contact number\n` +
    `• 📍 City / area / sector\n` +
    `• 📝 Short description\n\n`;

  const baseES =
    `Por favor envía TODO en UN solo mensaje:\n` +
    `• 🧑‍🎓 Nombre completo\n` +
    `• 📞 Número de contacto\n` +
    `• 📍 Municipio / zona / sector\n` +
    `• 📝 Descripción breve\n\n`;

  if (lang === 'en') {
    const examples = {
      destape: `"I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"`,
      fuga: `"I'm Ana Rivera, 939-555-9999, Caguas, leak in bathroom ceiling"`,
      camara: `"I'm Ana Rivera, 939-555-9999, Caguas, camera inspection in main sewer line"`,
      calentador: `"I'm Ana Rivera, 939-555-9999, Caguas, solar water heater not heating"`,
      cita: `"I'm Ana Rivera, 939-555-9999, Caguas, prefer Mon–Wed 10am–1pm, kitchen sink clogged"`,
      otro: `"I'm Ana Rivera, 939-555-9999, Caguas, need estimate for bathroom remodeling"`
    };
    return (
      `✅ Selected: ${serviceName(service, lang)}\n\n` +
      baseEN +
      `Example:\n${examples[service] || examples.otro}`
    );
  }

  const examples = {
    destape: `"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`,
    fuga: `"Me llamo Ana Rivera, 939-555-9999, Caguas, fuga en el techo del baño"`,
    camara: `"Me llamo Ana Rivera, 939-555-9999, Caguas, inspección con cámara en la línea principal"`,
    calentador: `"Me llamo Ana Rivera, 939-555-9999, Caguas, calentador solar no calienta"`,
    cita: `"Me llamo Ana Rivera, 939-555-9999, Caguas, prefiero lunes a miércoles 10am–1pm, fregadero tapado"`,
    otro: `"Me llamo Ana Rivera, 939-555-9999, Caguas, necesito estimado para remodelación de baño"`
  };

  return (
    `✅ Servicio: ${serviceName(service, lang)}\n\n` +
    baseES +
    `Ejemplo:\n${examples[service] || examples.otro}`
  );
}

function askSchedule(lang) {
  if (lang === 'en') {
    return (
      `📅 Would you like to schedule an appointment now?\n\n` +
      `Reply:\n✅ YES\n❌ NO\n\n` +
      `You can also type "menu".`
    );
  }
  return (
    `📅 ¿Quieres agendar una cita ahora?\n\n` +
    `Responde:\n✅ SI\n❌ NO\n\n` +
    `También puedes escribir "menu".`
  );
}

function formatSlots(slots, lang) {
  const lines = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const label = (lang === 'en') ? s.slot_en : s.slot_es;
    lines.push(`${i + 1}️⃣ ${s.ymd} — ${label}`);
  }
  if (lang === 'en') return `✅ Available slots:\n\n${lines.join('\n')}\n\nReply with the number (1-${slots.length}) or type "menu".`;
  return `✅ Horarios disponibles:\n\n${lines.join('\n')}\n\nResponde con el número (1-${slots.length}) o escribe "menu".`;
}

function finalMessage({ lang, caseId, service, heaterType, details, booked }) {
  const svcName = serviceName(service, lang);
  const heaterLine = (service === 'calentador' && heaterType)
    ? (lang === 'en' ? `Heater type: ${heaterType}\n` : `Tipo de calentador: ${heaterType}\n`)
    : '';
  const bookingLine = booked
    ? (lang === 'en'
        ? `✅ Appointment booked:\n${booked.ymd} — ${booked.slot}\n\n`
        : `✅ Cita agendada:\n${booked.ymd} — ${booked.slot}\n\n`)
    : '';

  if (lang === 'en') {
    return (
      `✅ Received. We saved your info.\n\n` +
      `Case ID: ${caseId}\n` +
      `Service: ${svcName}\n` +
      heaterLine +
      `Details:\n"${details}"\n\n` +
      bookingLine +
      `We will contact you ASAP.\n\n` +
      `Type "menu" to return.`
    );
  }

  return (
    `✅ Recibido. Guardamos tu información.\n\n` +
    `Case ID: ${caseId}\n` +
    `Servicio: ${svcName}\n` +
    heaterLine +
    `Detalles:\n"${details}"\n\n` +
    bookingLine +
    `Te contactamos ASAP.\n\n` +
    `Escribe "menu" para regresar.`
  );
}

function makeCaseId() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `DP-${y}${m}${day}-${rnd}`;
}

function sendTwilioXML(res, text) {
  const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.send(xml);
}

async function scriptPost(payload) {
  if (!SCRIPT_WEBAPP_URL || !SCRIPT_TOKEN) return { ok: false, error: 'missing_script_env' };

  const r = await fetch(SCRIPT_WEBAPP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({ token: SCRIPT_TOKEN, ...payload })
  });

  const txt = await r.text();
  try { return JSON.parse(txt); }
  catch { return { ok: false, error: 'non_json', raw: txt }; }
}

async function sendAdminWhatsApp(text) {
  if (!tw) return { ok: false, error: 'twilio_not_configured' };
  if (!TWILIO_FROM || !ADMIN_TO) return { ok: false, error: 'missing_admin_env' };
  if (!String(TWILIO_FROM).startsWith('whatsapp:')) return { ok: false, error: 'TWILIO_FROM_must_start_whatsapp' };
  if (!String(ADMIN_TO).startsWith('whatsapp:')) return { ok: false, error: 'ADMIN_TO_must_start_whatsapp' };
  const msg = await tw.messages.create({ from: TWILIO_FROM, to: ADMIN_TO, body: text });
  return { ok: true, sid: msg.sid };
}

function extractPhone(text) {
  const m = String(text || '').match(/(\+?1?\s*)?(\(?\d{3}\)?)[-\s.]?(\d{3})[-\s.]?(\d{4})/);
  if (!m) return '';
  const digits = (m[2] + m[3] + m[4]).replace(/\D/g, '');
  return digits.length === 10 ? digits : '';
}

function extractName(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length >= 1) return parts[0].replace(/^"|"$/g, '').trim();
  return '';
}

function extractCity(text) {
  const parts = String(text || '').split(',').map(x => x.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[2];
  return '';
}

app.get('/__version', (req, res) => {
  res.json({
    ok: true,
    tag: TAG,
    render_commit: process.env.RENDER_GIT_COMMIT || null,
    render_service: process.env.RENDER_SERVICE_NAME || null,
    node: process.version
  });
});

app.get('/', (req, res) => {
  res.send('DestapesPR Bot activo ✅');
});

app.post('/cron/alerts', async (req, res) => {
  try {
    const threshold_hours = Number(req.body?.threshold_hours ?? 24);
    const max = Number(req.body?.max ?? 2000);
    const force_send = Boolean(req.body?.force_send ?? false);

    const payload = await scriptPost({ action: 'run_alerts', threshold_hours, max });
    if (!payload?.ok) return res.status(200).json({ ok: false, where: 'apps_script', payload });

    const newAlerts = Number(payload.new_alerts || 0);
    if (newAlerts > 0 || force_send) {
      const top = Array.isArray(payload.alerts) ? payload.alerts.slice(0, 10) : [];
      let msg = `🚨 DestapesPR — ALERTAS\nNuevas: ${newAlerts}\nRegla: atrasado >= ${threshold_hours}h\n\n`;
      for (const a of top) {
        msg += `• ${a.alert_type || ''} | ${a.case_id || ''} | ${a.status || ''} | ${a.priority || ''}${a.tech ? ` | Tech: ${a.tech}` : ''}\n`;
      }
      msg = msg.trim() || `🚨 DestapesPR — ALERTAS\nNuevas: ${newAlerts}`;
      const sent = await sendAdminWhatsApp(msg);
      return res.status(200).json({ ok: true, new_alerts: newAlerts, sent, payload });
    }

    return res.status(200).json({ ok: true, new_alerts: 0, payload });
  } catch (err) {
    return res.status(200).json({ ok: false, error: String(err?.stack || err) });
  }
});

app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from = (req.body.From || req.body.from || req.body.WaId || '').toString();
  const bodyRaw = (req.body.Body || req.body.body || '').toString();
  if (!from) return sendTwilioXML(res, 'Missing sender.');

  let session = (await getSession(from)) || {
    from_number: from,
    lang: 'es',
    last_choice: null,
    case_id: null,
    heater_type: null,
    awaiting_heater_type: 0,
    awaiting_details: 0,
    awaiting_schedule: 0,
    awaiting_slot: 0,
    details: null,
    slots_json: null,
    last_active: 0
  };

  const prevLast = Number(session.last_active || 0);
  const now = Date.now();
  const bodyNorm = norm(bodyRaw);

  const isMenuCommand = ['inicio', 'menu', 'volver', 'start', 'back'].includes(bodyNorm);
  const isHello = ['hola','hello','hi','hey','buenas','buenos dias','buen día','buen dia','saludos'].some(k => bodyNorm.includes(norm(k)));
  const isLanguageCommand =
    /\benglish\b/.test(bodyNorm) ||
    /\bingles\b/.test(bodyNorm) ||
    /\bingl[eé]s\b/.test(bodyNorm) ||
    /\bespanol\b/.test(bodyNorm) ||
    /\bespa[ñn]ol\b/.test(bodyNorm) ||
    /\bspanish\b/.test(bodyNorm);

  const newLang = detectLanguage(bodyRaw, session.lang || 'es');
  if (newLang !== session.lang) session = await saveSession(from, { lang: newLang });
  const lang = session.lang || 'es';

  const isInactive = prevLast > 0 && (now - prevLast) > WELCOME_TTL_MS;
  const isFirstTime = prevLast === 0;

  if (isFirstTime || isInactive) {
    await saveSession(from, {
      last_choice: null,
      case_id: null,
      heater_type: null,
      awaiting_heater_type: 0,
      awaiting_details: 0,
      awaiting_schedule: 0,
      awaiting_slot: 0,
      details: null,
      slots_json: null
    });

    const greet = (lang === 'en')
      ? (isFirstTime ? `👋 Welcome to DestapesPR!\n\n` : `👋 Welcome back! We’re here to help.\n\n`)
      : (isFirstTime ? `👋 ¡Bienvenido a DestapesPR!\n\n` : `👋 ¡Bienvenido de nuevo! Estamos listos para ayudarte.\n\n`);

    return sendTwilioXML(res, greet + mainMenu(lang));
  }

  if (!bodyNorm || isMenuCommand || isHello) {
    await saveSession(from, {
      last_choice: null,
      case_id: null,
      heater_type: null,
      awaiting_heater_type: 0,
      awaiting_details: 0,
      awaiting_schedule: 0,
      awaiting_slot: 0,
      details: null,
      slots_json: null
    });
    const reply = (lang === 'en') ? `🔁 Main menu:\n\n${mainMenu(lang)}` : `🔁 Menú principal:\n\n${mainMenu(lang)}`;
    return sendTwilioXML(res, reply);
  }

  if (isLanguageCommand) {
    const confirm = (newLang === 'en') ? `✅ Language set to English.\n\n` : `✅ Idioma establecido a español.\n\n`;
    await saveSession(from, { lang: newLang });
    return sendTwilioXML(res, confirm + mainMenu(newLang));
  }

  if (session.awaiting_heater_type && session.last_choice === 'calentador') {
    const pick = bodyNorm;
    if (pick === '1' || pick.includes('solar')) {
      session = await saveSession(from, { heater_type: 'SOLAR', awaiting_heater_type: 0, awaiting_details: 1 });
      const msg = (lang === 'en') ? `✅ Heater type: SOLAR\n\n${servicePrompt('calentador', lang)}` : `✅ Tipo: SOLAR\n\n${servicePrompt('calentador', lang)}`;
      return sendTwilioXML(res, msg);
    }
    if (pick === '2' || pick.includes('convencional') || pick.includes('gas') || pick.includes('electrico') || pick.includes('eléctrico') || pick.includes('electric')) {
      session = await saveSession(from, { heater_type: 'Convencional', awaiting_heater_type: 0, awaiting_details: 1 });
      const msg = (lang === 'en') ? `✅ Heater type: Conventional\n\n${servicePrompt('calentador', lang)}` : `✅ Tipo: Convencional\n\n${servicePrompt('calentador', lang)}`;
      return sendTwilioXML(res, msg);
    }
    return sendTwilioXML(res, heaterTypeMenu(lang));
  }

  if (session.awaiting_slot && session.slots_json && session.case_id && session.last_choice && session.details) {
    const slots = JSON.parse(session.slots_json || '[]');
    const pick = parseInt(bodyNorm, 10);

    if (!pick || pick < 1 || pick > slots.length) {
      const msg = (lang === 'en')
        ? `Please reply with a valid number (1-${slots.length}).\n\n` + formatSlots(slots, lang)
        : `Responde con un número válido (1-${slots.length}).\n\n` + formatSlots(slots, lang);
      return sendTwilioXML(res, msg);
    }

    const chosen = slots[pick - 1];

    const bookPayload = await scriptPost({
      action: 'book',
      start_iso: chosen.start_iso,
      end_iso: chosen.end_iso,
      case_id: session.case_id,
      from_number: from,
      lang,
      service: session.last_choice,
      service_label: serviceName(session.last_choice, lang),
      name: extractName(session.details || ''),
      phone: extractPhone(session.details || ''),
      city: extractCity(session.details || ''),
      details: session.details || ''
    });

    const bookedOk = !!bookPayload?.ok;

    await scriptPost({
      action: 'lead',
      case_id: session.case_id,
      created_at: new Date().toISOString(),
      from_number: from,
      lang,
      service: session.last_choice,
      service_label: serviceName(session.last_choice, lang),
      heater_type: (session.last_choice === 'calentador') ? (session.heater_type || '') : '',
      name: extractName(session.details || ''),
      phone: extractPhone(session.details || ''),
      city: extractCity(session.details || ''),
      details: session.details || '',
      status: bookedOk ? 'En proceso' : 'Nuevo'
    });

    const booked = bookedOk
      ? { ymd: chosen.ymd, slot: (lang === 'en' ? chosen.slot_en : chosen.slot_es) }
      : null;

    const msg = bookedOk
      ? finalMessage({ lang, caseId: session.case_id, service: session.last_choice, heaterType: session.heater_type, details: session.details, booked })
      : ((lang === 'en')
        ? `✅ We saved your info (Case ID: ${session.case_id}).\n\n⚠️ Booking failed. Type "menu" to try again.\n\n`
        : `✅ Guardamos tu info (Case ID: ${session.case_id}).\n\n⚠️ No se pudo agendar. Escribe "menu" para intentar de nuevo.\n\n`) + mainMenu(lang);

    await saveSession(from, {
      last_choice: null,
      case_id: null,
      heater_type: null,
      awaiting_heater_type: 0,
      awaiting_details: 0,
      awaiting_schedule: 0,
      awaiting_slot: 0,
      details: null,
      slots_json: null
    });

    return sendTwilioXML(res, msg);
  }

  if (session.awaiting_schedule && session.case_id && session.last_choice && session.details) {
    const yes = (lang === 'en')
      ? ['yes','y','ok','sure','si','sí'].includes(bodyNorm)
      : ['si','sí','dale','ok','yes','y'].includes(bodyNorm);
    const no = ['no','n'].includes(bodyNorm);

    if (!yes && !no) return sendTwilioXML(res, askSchedule(lang));

    if (no) {
      await scriptPost({
        action: 'lead',
        case_id: session.case_id,
        created_at: new Date().toISOString(),
        from_number: from,
        lang,
        service: session.last_choice,
        service_label: serviceName(session.last_choice, lang),
        heater_type: (session.last_choice === 'calentador') ? (session.heater_type || '') : '',
        name: extractName(session.details || ''),
        phone: extractPhone(session.details || ''),
        city: extractCity(session.details || ''),
        details: session.details || '',
        status: 'Nuevo'
      });

      const msg = finalMessage({ lang, caseId: session.case_id, service: session.last_choice, heaterType: session.heater_type, details: session.details, booked: null });

      await saveSession(from, {
        last_choice: null,
        case_id: null,
        heater_type: null,
        awaiting_heater_type: 0,
        awaiting_details: 0,
        awaiting_schedule: 0,
        awaiting_slot: 0,
        details: null,
        slots_json: null
      });

      return sendTwilioXML(res, msg);
    }

    const avail = await scriptPost({ action: 'availability', limit: 6 });
    if (!avail?.ok || !Array.isArray(avail.slots) || avail.slots.length === 0) {
      await scriptPost({
        action: 'lead',
        case_id: session.case_id,
        created_at: new Date().toISOString(),
        from_number: from,
        lang,
        service: session.last_choice,
        service_label: serviceName(session.last_choice, lang),
        heater_type: (session.last_choice === 'calentador') ? (session.heater_type || '') : '',
        name: extractName(session.details || ''),
        phone: extractPhone(session.details || ''),
        city: extractCity(session.details || ''),
        details: session.details || '',
        status: 'Nuevo'
      });

      const msg = (lang === 'en')
        ? `⚠️ No slots available right now. We saved your info.\n\n` + finalMessage({ lang, caseId: session.case_id, service: session.last_choice, heaterType: session.heater_type, details: session.details, booked: null })
        : `⚠️ No hay horarios disponibles ahora mismo. Guardamos tu info.\n\n` + finalMessage({ lang, caseId: session.case_id, service: session.last_choice, heaterType: session.heater_type, details: session.details, booked: null });

      await saveSession(from, {
        last_choice: null,
        case_id: null,
        heater_type: null,
        awaiting_heater_type: 0,
        awaiting_details: 0,
        awaiting_schedule: 0,
        awaiting_slot: 0,
        details: null,
        slots_json: null
      });

      return sendTwilioXML(res, msg);
    }

    await saveSession(from, {
      awaiting_schedule: 0,
      awaiting_slot: 1,
      slots_json: JSON.stringify(avail.slots)
    });

    return sendTwilioXML(res, formatSlots(avail.slots, lang));
  }

  if (session.awaiting_details && session.last_choice) {
    const caseId = session.case_id || makeCaseId();
    await saveSession(from, {
      case_id: caseId,
      details: bodyRaw,
      awaiting_details: 0,
      awaiting_schedule: 1
    });
    return sendTwilioXML(res, askSchedule(lang));
  }

  const svc = matchService(bodyRaw);
  if (svc) {
    const caseId = makeCaseId();
    if (svc === 'calentador') {
      await saveSession(from, {
        last_choice: svc,
        case_id: caseId,
        heater_type: null,
        awaiting_heater_type: 1,
        awaiting_details: 0,
        awaiting_schedule: 0,
        awaiting_slot: 0,
        details: null,
        slots_json: null
      });
      return sendTwilioXML(res, heaterTypeMenu(lang));
    }

    await saveSession(from, {
      last_choice: svc,
      case_id: caseId,
      heater_type: null,
      awaiting_heater_type: 0,
      awaiting_details: 1,
      awaiting_schedule: 0,
      awaiting_slot: 0,
      details: null,
      slots_json: null
    });

    return sendTwilioXML(res, servicePrompt(svc, lang));
  }

  const fallback = (lang === 'en')
    ? `I didn't understand your message.\n\n${mainMenu(lang)}`
    : `No entendí tu mensaje.\n\n${mainMenu(lang)}`;

  return sendTwilioXML(res, fallback);
});

app.listen(PORT, () => {
  console.log(`💬 ${TAG} listening on http://localhost:${PORT}`);
});