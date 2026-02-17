import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fetch from 'node-fetch';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;

const TAG = process.env.TAG || 'DestapesPR Bot 🇵🇷';
const PHONE = process.env.PHONE || '+1 787-922-0068';
const FB_LINK = process.env.FB_LINK || 'https://www.facebook.com/destapesPR/';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || process.env.DESTAPESPR_TOKEN || '';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
const WELCOME_TTL_MS = 12 * 60 * 60 * 1000;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

let db;

async function initDB() {
  if (db) return db;

  db = await open({ filename: './sessions.db', driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT DEFAULT 'es',
      last_choice TEXT,
      awaiting_heater INTEGER DEFAULT 0,
      awaiting_details INTEGER DEFAULT 0,
      awaiting_schedule INTEGER DEFAULT 0,
      awaiting_slot INTEGER DEFAULT 0,
      heater_type TEXT,
      case_id TEXT,
      details TEXT,
      slots_json TEXT,
      profile_name TEXT,
      last_active INTEGER
    );
  `);

  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const has = (n) => cols.some((c) => c.name === n);

  if (!has('lang')) await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es';`);
  if (!has('last_choice')) await db.exec(`ALTER TABLE sessions ADD COLUMN last_choice TEXT;`);
  if (!has('awaiting_heater')) await db.exec(`ALTER TABLE sessions ADD COLUMN awaiting_heater INTEGER DEFAULT 0;`);
  if (!has('awaiting_details')) await db.exec(`ALTER TABLE sessions ADD COLUMN awaiting_details INTEGER DEFAULT 0;`);
  if (!has('awaiting_schedule')) await db.exec(`ALTER TABLE sessions ADD COLUMN awaiting_schedule INTEGER DEFAULT 0;`);
  if (!has('awaiting_slot')) await db.exec(`ALTER TABLE sessions ADD COLUMN awaiting_slot INTEGER DEFAULT 0;`);
  if (!has('heater_type')) await db.exec(`ALTER TABLE sessions ADD COLUMN heater_type TEXT;`);
  if (!has('case_id')) await db.exec(`ALTER TABLE sessions ADD COLUMN case_id TEXT;`);
  if (!has('details')) await db.exec(`ALTER TABLE sessions ADD COLUMN details TEXT;`);
  if (!has('slots_json')) await db.exec(`ALTER TABLE sessions ADD COLUMN slots_json TEXT;`);
  if (!has('profile_name')) await db.exec(`ALTER TABLE sessions ADD COLUMN profile_name TEXT;`);
  if (!has('last_active')) await db.exec(`ALTER TABLE sessions ADD COLUMN last_active INTEGER;`);

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
    awaiting_heater: patch.awaiting_heater ?? prev.awaiting_heater ?? 0,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    awaiting_schedule: patch.awaiting_schedule ?? prev.awaiting_schedule ?? 0,
    awaiting_slot: patch.awaiting_slot ?? prev.awaiting_slot ?? 0,
    heater_type: patch.heater_type ?? prev.heater_type ?? null,
    case_id: patch.case_id ?? prev.case_id ?? null,
    details: patch.details ?? prev.details ?? null,
    slots_json: patch.slots_json ?? prev.slots_json ?? null,
    profile_name: patch.profile_name ?? prev.profile_name ?? null,
    last_active: now,
  };

  await db.run(
    `
    INSERT INTO sessions (
      from_number, lang, last_choice, awaiting_heater, awaiting_details,
      awaiting_schedule, awaiting_slot, heater_type, case_id, details, slots_json, profile_name, last_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      lang = excluded.lang,
      last_choice = excluded.last_choice,
      awaiting_heater = excluded.awaiting_heater,
      awaiting_details = excluded.awaiting_details,
      awaiting_schedule = excluded.awaiting_schedule,
      awaiting_slot = excluded.awaiting_slot,
      heater_type = excluded.heater_type,
      case_id = excluded.case_id,
      details = excluded.details,
      slots_json = excluded.slots_json,
      profile_name = excluded.profile_name,
      last_active = excluded.last_active
    `,
    [
      from,
      next.lang,
      next.last_choice,
      next.awaiting_heater,
      next.awaiting_details,
      next.awaiting_schedule,
      next.awaiting_slot,
      next.heater_type,
      next.case_id,
      next.details,
      next.slots_json,
      next.profile_name,
      next.last_active,
    ]
  );

  return next;
}

function clean(s) { return String(s || '').trim(); }

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
  let enScore = 0, esScore = 0;
  for (const w of EN_HINTS) if (txt.includes(w)) enScore++;
  for (const w of ES_HINTS) if (txt.includes(w)) esScore++;
  if (enScore > esScore && enScore > 0) return 'en';
  if (esScore > enScore && esScore > 0) return 'es';
  return previousLang || 'es';
}

const SERVICE_KEYS = ['destape','fuga','camara','calentador','otro','cita'];

const SERVICE_KEYWORDS = {
  destape: ['destape','destapar','tapon','tapada','tapado','obstruccion','drenaje','desague','fregadero','lavaplatos','inodoro','toilet','ducha','lavamanos','banera','principal','linea principal','drain','unclog','clogged','sewer'],
  fuga: ['fuga','goteo','goteando','salidero','humedad','filtracion','leak','leaking','moisture'],
  camara: ['camara','video inspeccion','inspeccion','inspection','camera inspection','sewer camera'],
  calentador: ['calentador','boiler','heater','water heater','gas','electrico','electric','hot water','agua caliente','solar','calentador solar','solar heater'],
  otro: ['otro','otros','servicio','consulta','presupuesto','cotizacion','other','plumbing','problem'],
  cita: ['cita','appointment','schedule','agendar','reservar']
};

function matchService(bodyRaw) {
  const txt = norm(bodyRaw);
  const mapNums = { '1':'destape','2':'fuga','3':'camara','4':'calentador','5':'otro','6':'cita' };
  if (mapNums[txt]) return mapNums[txt];
  for (const key of SERVICE_KEYS) {
    const list = SERVICE_KEYWORDS[key];
    if (list.some(w => txt.includes(w))) return key;
  }
  return null;
}

function serviceName(service, lang) {
  const names = {
    destape: { es:'Destape', en:'Drain cleaning' },
    fuga: { es:'Fuga de agua', en:'Water leak' },
    camara: { es:'Inspección con cámara', en:'Camera inspection' },
    calentador: { es:'Calentador (gas/eléctrico/solar)', en:'Water heater (gas/electric/solar)' },
    otro: { es:'Otro servicio de plomería', en:'Other plumbing service' },
    cita: { es:'Cita / coordinar visita', en:'Appointment' },
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

function heaterMenu(lang) {
  if (lang === 'en') {
    return (
      `✅ Selected: Water heater (gas/electric/solar)\n\n` +
      `Before details, choose heater type:\n` +
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

function servicePrompt(service, lang, heaterType) {
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

  const examplesEN = {
    destape: `"I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"`,
    fuga: `"I'm Ana Rivera, 939-555-9999, Caguas, leak on bathroom ceiling"`,
    camara: `"I'm Ana Rivera, 939-555-9999, Caguas, camera inspection main sewer line"`,
    otro: `"I'm Ana Rivera, 939-555-9999, Caguas, need estimate for bathroom remodeling"`,
    cita: `"I'm Ana Rivera, 939-555-9999, Caguas, prefer Mon–Wed 10am–1pm, kitchen sink clogged"`,
    calentador: `"I'm Ana Rivera, 939-555-9999, Caguas, water heater not heating"`,
  };

  const examplesES = {
    destape: `"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`,
    fuga: `"Me llamo Ana Rivera, 939-555-9999, Caguas, fuga en el techo del baño"`,
    camara: `"Me llamo Ana Rivera, 939-555-9999, Caguas, inspección con cámara en la línea principal"`,
    otro: `"Me llamo Ana Rivera, 939-555-9999, Caguas, necesito estimado para remodelación de baño"`,
    cita: `"Me llamo Ana Rivera, 939-555-9999, Caguas, prefiero lunes a miércoles 10am–1pm, fregadero tapado"`,
    calentador: `"Me llamo Ana Rivera, 939-555-9999, Caguas, calentador no calienta"`,
  };

  if (service === 'calentador') {
    const typeLine = heaterType ? (lang === 'en' ? `✅ Heater type: ${heaterType}\n\n` : `✅ Tipo: ${heaterType}\n\n`) : '';
    if (lang === 'en') return `✅ Selected: Water heater (gas/electric/solar)\n\n${typeLine}${baseEN}Example:\n${examplesEN.calentador}`;
    return `✅ Servicio: Calentador (gas/eléctrico/solar)\n\n${typeLine}${baseES}Ejemplo:\n${examplesES.calentador}`;
  }

  if (lang === 'en') return `✅ Selected: ${serviceName(service, lang)}\n\n${baseEN}Example:\n${examplesEN[service] || examplesEN.otro}`;
  return `✅ Servicio: ${serviceName(service, lang)}\n\n${baseES}Ejemplo:\n${examplesES[service] || examplesES.otro}`;
}

function askSchedule(lang) {
  if (lang === 'en') {
    return (
      `📅 Would you like to schedule an appointment now?\n\n` +
      `Reply:\n` +
      `✅ YES = show available slots\n` +
      `❌ NO = finish without booking\n\n` +
      `You can also type "menu".`
    );
  }
  return (
    `📅 ¿Quieres agendar una cita ahora?\n\n` +
    `Responde:\n` +
    `✅ SI = ver horarios disponibles\n` +
    `❌ NO = finalizar sin cita\n\n` +
    `También puedes escribir "menu".`
  );
}

function formatSlots(slots, lang) {
  const lines = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const label = lang === 'en' ? s.slot_en : s.slot_es;
    lines.push(`${i + 1}️⃣ ${s.ymd} — ${label}`);
  }
  if (lang === 'en') return `✅ Available slots:\n\n${lines.join('\n')}\n\nReply with the number (1-${slots.length}) or type "menu".`;
  return `✅ Horarios disponibles:\n\n${lines.join('\n')}\n\nResponde con el número (1-${slots.length}) o escribe "menu".`;
}

function makeCaseId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `DP-${y}${m}${day}-${rnd}`;
}

function sendTwilioXML(res, text) {
  const safe = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.status(200).send(xml);
}

function b64url(obj) {
  const s = JSON.stringify(obj);
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

async function appsGet(action, payload = {}, extraQuery = {}) {
  if (!APPS_SCRIPT_URL) throw new Error('missing_APPS_SCRIPT_URL');

  const qs = new URLSearchParams();
  qs.set('action', String(action || '').trim());

  if (action !== 'ready') {
    if (!APPS_SCRIPT_TOKEN) throw new Error('missing_APPS_SCRIPT_TOKEN');
    qs.set('token', APPS_SCRIPT_TOKEN);
  }

  if (payload && Object.keys(payload).length) qs.set('p', b64url(payload));

  for (const [k, v] of Object.entries(extraQuery || {})) {
    if (v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
  }

  const url = `${APPS_SCRIPT_URL}?${qs.toString()}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { status, text } = await fetchTextWithTimeout(url);

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        return { ok: false, error: 'non_json_response', status, raw: text.slice(0, 500) };
      }

      if (json?.ok === true) return json;
      if (json?.error === 'unauthorized') return json;

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return json || { ok: false, error: 'unknown' };
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return { ok: false, error: 'fetch_failed', details: msg };
    }
  }

  return { ok: false, error: 'max_retries_exceeded' };
}

function extractPhone(text) {
  const m = String(text || '').match(/(\+?1?\s*)?(\(?\d{3}\)?)[-\s.]?(\d{3})[-\s.]?(\d{4})/);
  if (!m) return '';
  const digits = (m[2] + m[3] + m[4]).replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : '';
}

function extractName(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 1) return parts[0].replace(/^"|"$/g, '').trim().replace(/^me llamo\s+/i, '').replace(/^i'?m\s+/i, '');
  return '';
}

function extractCity(text) {
  const parts = String(text || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[2];
  return '';
}

function normalizeFrom(from) {
  const s = String(from || '').trim();
  if (!s) return '';
  if (/^whatsapp:/i.test(s)) return s;
  if (/^\+?\d+$/.test(s)) return `whatsapp:${s.startsWith('+') ? s : `+${s}`}`;
  return s;
}

app.get('/', (req, res) => res.send('DestapesPR Bot activo ✅'));

app.get('/health', async (req, res) => {
  try {
    const scriptCheck = await appsGet('ready');
    res.json({
      ok: true,
      tag: TAG,
      apps_script: scriptCheck?.ok ? 'connected' : 'error',
      apps_script_version: scriptCheck?.version || 'unknown',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err), tag: TAG });
  }
});

app.post('/twilio', async (req, res) => {
  try {
    await initDB();

    const from = normalizeFrom(req.body.From || req.body.from || '');
    const bodyRaw = String(req.body.Body || req.body.body || '');
    const profileName = clean(req.body.ProfileName || req.body.profileName || '');

    if (!from) return sendTwilioXML(res, '');

    let session =
      (await getSession(from)) || {
        from_number: from,
        lang: 'es',
        last_choice: null,
        awaiting_heater: 0,
        awaiting_details: 0,
        awaiting_schedule: 0,
        awaiting_slot: 0,
        heater_type: null,
        case_id: null,
        details: null,
        slots_json: null,
        profile_name: null,
        last_active: 0,
      };

    const prevLast = Number(session.last_active || 0);
    const now = Date.now();
    const bodyNorm = norm(bodyRaw);

    const isMenuCommand = ['inicio', 'menu', 'volver', 'start', 'back'].includes(bodyNorm);
    const isHello = ['hola', 'hello', 'hi', 'hey', 'buenas', 'saludos'].some((k) => bodyNorm.includes(norm(k)));

    const isLanguageCommand =
      /\benglish\b/.test(bodyNorm) ||
      /\bingles\b/.test(bodyNorm) ||
      /\bingl[eé]s\b/.test(bodyNorm) ||
      /\bespanol\b/.test(bodyNorm) ||
      /\bespa[ñn]ol\b/.test(bodyNorm) ||
      /\bspanish\b/.test(bodyNorm);

    const newLang = detectLanguage(bodyRaw, session.lang || 'es');
    if (newLang !== session.lang) session = await saveSession(from, { lang: newLang });

    if (profileName) session = await saveSession(from, { profile_name: profileName });

    const lang = session.lang || 'es';
    const isInactive = prevLast > 0 && now - prevLast > WELCOME_TTL_MS;
    const isFirstTime = prevLast === 0;

    if (isFirstTime || isInactive) {
      await saveSession(from, {
        last_choice: null,
        awaiting_heater: 0,
        awaiting_details: 0,
        awaiting_schedule: 0,
        awaiting_slot: 0,
        heater_type: null,
        case_id: null,
        details: null,
        slots_json: null,
      });

      const greet =
        lang === 'en'
          ? isFirstTime
            ? `👋 Welcome to DestapesPR!\n\n`
            : `👋 Welcome back! We’re here to help.\n\n`
          : isFirstTime
            ? `👋 ¡Bienvenido a DestapesPR!\n\n`
            : `👋 ¡Bienvenido de nuevo! Estamos listos para ayudarte.\n\n`;

      return sendTwilioXML(res, greet + mainMenu(lang));
    }

    if (!bodyNorm || isMenuCommand || isHello) {
      await saveSession(from, {
        last_choice: null,
        awaiting_heater: 0,
        awaiting_details: 0,
        awaiting_schedule: 0,
        awaiting_slot: 0,
        heater_type: null,
        case_id: null,
        details: null,
        slots_json: null,
      });
      const reply = lang === 'en' ? `🔁 Main menu:\n\n${mainMenu(lang)}` : `🔁 Menú principal:\n\n${mainMenu(lang)}`;
      return sendTwilioXML(res, reply);
    }

    if (isLanguageCommand) {
      const confirm = newLang === 'en' ? `✅ Language set to English.\n\n` : `✅ Idioma establecido a español.\n\n`;
      await saveSession(from, { lang: newLang });
      return sendTwilioXML(res, confirm + mainMenu(newLang));
    }

    if (Number(session.awaiting_heater) === 1 && session.last_choice === 'calentador') {
      if (bodyNorm === '1') {
        session = await saveSession(from, { heater_type: 'SOLAR', awaiting_heater: 0, awaiting_details: 1 });
        return sendTwilioXML(res, (lang === 'en' ? `✅ Heater type: SOLAR\n\n` : `✅ Tipo: SOLAR\n\n`) + servicePrompt('calentador', lang, 'SOLAR'));
      }
      if (bodyNorm === '2') {
        session = await saveSession(from, { heater_type: 'Convencional', awaiting_heater: 0, awaiting_details: 1 });
        return sendTwilioXML(res, (lang === 'en' ? `✅ Heater type: Conventional\n\n` : `✅ Tipo: Convencional\n\n`) + servicePrompt('calentador', lang, 'Convencional'));
      }
      return sendTwilioXML(res, heaterMenu(lang));
    }

    if (Number(session.awaiting_slot) === 1 && session.slots_json) {
      let slots = [];
      try { slots = JSON.parse(session.slots_json || '[]'); } catch { slots = []; }

      const pick = parseInt(bodyNorm, 10);
      if (!pick || pick < 1 || pick > slots.length) {
        return sendTwilioXML(
          res,
          lang === 'en'
            ? `Please reply with a valid number (1-${slots.length}).\n\n${formatSlots(slots, lang)}`
            : `Responde con un número válido (1-${slots.length}).\n\n${formatSlots(slots, lang)}`
        );
      }

      const chosen = slots[pick - 1];
      const svc = session.last_choice || 'otro';
      const heaterTypeToSend = svc === 'calentador' ? (session.heater_type || 'N/A') : 'N/A';

      const name = extractName(session.details || '') || session.profile_name || '';
      const phone = extractPhone(session.details || '');
      const city = extractCity(session.details || '');

      const bookResp = await appsGet('book', {
        case_id: session.case_id,
        name: name || (lang === 'en' ? 'Client' : 'Cliente'),
        phone: phone || '+1',
        city: city || 'PR',
        from_number: from,
        service_label: serviceName(svc, lang),
        details: session.details || '',
        start_iso: chosen.start_iso,
        end_iso: chosen.end_iso
      });

      const bookedOk = !!bookResp?.ok;

      await appsGet('lead', {
        case_id: session.case_id,
        created_at: new Date().toISOString(),
        from_number: from,
        lang,
        service: svc,
        service_label: serviceName(svc, lang),
        heater_type: heaterTypeToSend,
        name: name || '',
        phone: phone || '',
        city: city || '',
        details: session.details || '',
        status: bookedOk ? 'Programado' : 'Nuevo'
      });

      await saveSession(from, {
        awaiting_slot: 0,
        awaiting_schedule: 0,
        awaiting_details: 0,
        awaiting_heater: 0,
        last_choice: null,
        heater_type: null,
        details: null,
        slots_json: null,
        case_id: null
      });

      if (lang === 'en') {
        let msg = `✅ Received.\n\nCase: ${session.case_id}\nService: ${serviceName(svc, lang)}\n`;
        if (svc === 'calentador') msg += `Heater type: ${heaterTypeToSend}\n`;
        msg += `\n`;
        if (bookedOk) msg += `✅ Appointment booked:\n${chosen.ymd} — ${chosen.slot_en}\n\n`;
        else msg += `⚠️ I couldn't book that slot. We'll contact you.\n\n`;
        msg += `Type "menu" to return.`;
        return sendTwilioXML(res, msg);
      } else {
        let msg = `✅ Recibido.\n\nCaso: ${session.case_id}\nServicio: ${serviceName(svc, lang)}\n`;
        if (svc === 'calentador') msg += `Tipo de calentador: ${heaterTypeToSend}\n`;
        msg += `\n`;
        if (bookedOk) msg += `✅ Cita agendada:\n${chosen.ymd} — ${chosen.slot_es}\n\n`;
        else msg += `⚠️ No pude reservar ese horario. Te contactamos.\n\n`;
        msg += `Escribe "menu" para regresar.`;
        return sendTwilioXML(res, msg);
      }
    }

    if (Number(session.awaiting_schedule) === 1 && session.case_id && session.last_choice && session.details) {
      const yes = ['si','sí','yes','y','ok','dale'].includes(bodyNorm);
      const no = ['no','n'].includes(bodyNorm);

      if (!yes && !no) return sendTwilioXML(res, askSchedule(lang));

      const svc = session.last_choice || 'otro';
      const heaterTypeToSend = svc === 'calentador' ? (session.heater_type || 'N/A') : 'N/A';

      const name = extractName(session.details || '') || session.profile_name || '';
      const phone = extractPhone(session.details || '');
      const city = extractCity(session.details || '');

      if (no) {
        await appsGet('lead', {
          case_id: session.case_id,
          created_at: new Date().toISOString(),
          from_number: from,
          lang,
          service: svc,
          service_label: serviceName(svc, lang),
          heater_type: heaterTypeToSend,
          name: name || '',
          phone: phone || '',
          city: city || '',
          details: session.details || '',
          status: 'Nuevo'
        });

        await saveSession(from, {
          awaiting_schedule: 0,
          awaiting_details: 0,
          awaiting_heater: 0,
          awaiting_slot: 0,
          last_choice: null,
          heater_type: null,
          case_id: null,
          details: null,
          slots_json: null
        });

        const msg = lang === 'en'
          ? `✅ Received. Saved.\nCase: ${session.case_id}\nService: ${serviceName(svc, lang)}\n\nType "menu" to return.`
          : `✅ Recibido. Guardado.\nCaso: ${session.case_id}\nServicio: ${serviceName(svc, lang)}\n\nEscribe "menu" para regresar.`;
        return sendTwilioXML(res, msg);
      }

      const avail = await appsGet('availability', {}, { limit: 6, days_ahead: 14 });
      if (!avail?.ok || !Array.isArray(avail.slots) || avail.slots.length === 0) {
        await appsGet('lead', {
          case_id: session.case_id,
          created_at: new Date().toISOString(),
          from_number: from,
          lang,
          service: svc,
          service_label: serviceName(svc, lang),
          heater_type: heaterTypeToSend,
          name: name || '',
          phone: phone || '',
          city: city || '',
          details: session.details || '',
          status: 'Nuevo'
        });

        await saveSession(from, {
          awaiting_schedule: 0,
          awaiting_details: 0,
          awaiting_heater: 0,
          awaiting_slot: 0,
          last_choice: null,
          heater_type: null,
          case_id: null,
          details: null,
          slots_json: null
        });

        return sendTwilioXML(res, lang === 'en'
          ? `⚠️ No slots available right now. We saved your info.\n\nType "menu" to return.`
          : `⚠️ No hay horarios disponibles ahora mismo. Guardamos tu info.\n\nEscribe "menu" para regresar.`);
      }

      await saveSession(from, { awaiting_slot: 1, awaiting_schedule: 0, slots_json: JSON.stringify(avail.slots) });
      return sendTwilioXML(res, formatSlots(avail.slots, lang));
    }

    if (Number(session.awaiting_details) === 1 && session.last_choice) {
      const caseId = session.case_id || makeCaseId();
      await saveSession(from, { awaiting_details: 0, awaiting_schedule: 1, details: bodyRaw, case_id: caseId });
      return sendTwilioXML(res, askSchedule(lang));
    }

    const svc = matchService(bodyRaw);
    if (svc) {
      const caseId = makeCaseId();

      if (svc === 'calentador') {
        await saveSession(from, {
          last_choice: 'calentador',
          awaiting_heater: 1,
          awaiting_details: 0,
          awaiting_schedule: 0,
          awaiting_slot: 0,
          heater_type: null,
          case_id: caseId,
          details: null,
          slots_json: null
        });
        return sendTwilioXML(res, heaterMenu(lang));
      }

      await saveSession(from, {
        last_choice: svc,
        awaiting_heater: 0,
        awaiting_details: 1,
        awaiting_schedule: 0,
        awaiting_slot: 0,
        heater_type: null,
        case_id: caseId,
        details: null,
        slots_json: null
      });

      return sendTwilioXML(res, servicePrompt(svc, lang));
    }

    return sendTwilioXML(res, lang === 'en'
      ? `I didn't understand your message.\n\n${mainMenu(lang)}`
      : `No entendí tu mensaje.\n\n${mainMenu(lang)}`);
  } catch {
    return sendTwilioXML(res, '');
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ ${TAG} listening on port ${PORT}`);
    });
  })
  .catch(() => process.exit(1));
