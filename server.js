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
const TAG = "DestapesPR Unified Bot 🇵🇷 [[FORCE-DEPLOY]]";

const PHONE = '+1 787-922-0068';
const FB_LINK = 'https://www.facebook.com/destapesPR/';

const LEADS_WEBHOOK_URL = process.env.LEADS_WEBHOOK_URL || '';
const LEADS_WEBHOOK_TOKEN = process.env.LEADS_WEBHOOK_TOKEN || '';

const CAL_WEBHOOK_URL =
  process.env.CAL_WEBHOOK_URL ||
  process.env.LEADS_WEBHOOK_URL ||
  '';
const CAL_WEBHOOK_TOKEN =
  process.env.CAL_WEBHOOK_TOKEN ||
  process.env.LEADS_WEBHOOK_TOKEN ||
  '';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
const WELCOME_AFTER_MS = 12 * 60 * 60 * 1000;

let db;

async function initDB() {
  if (db) return db;

  db = await open({ filename: './sessions.db', driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT DEFAULT 'es',
      case_id TEXT,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      awaiting_book_choice INTEGER DEFAULT 0,
      awaiting_slot INTEGER DEFAULT 0,
      details TEXT,
      name TEXT,
      phone TEXT,
      city TEXT,
      slots_json TEXT,
      last_active INTEGER
    );
  `);

  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const has = (n) => cols.some((c) => c.name === n);

  if (!has('case_id')) await db.exec(`ALTER TABLE sessions ADD COLUMN case_id TEXT;`);
  if (!has('awaiting_book_choice')) await db.exec(`ALTER TABLE sessions ADD COLUMN awaiting_book_choice INTEGER DEFAULT 0;`);
  if (!has('awaiting_slot')) await db.exec(`ALTER TABLE sessions ADD COLUMN awaiting_slot INTEGER DEFAULT 0;`);
  if (!has('name')) await db.exec(`ALTER TABLE sessions ADD COLUMN name TEXT;`);
  if (!has('phone')) await db.exec(`ALTER TABLE sessions ADD COLUMN phone TEXT;`);
  if (!has('city')) await db.exec(`ALTER TABLE sessions ADD COLUMN city TEXT;`);
  if (!has('slots_json')) await db.exec(`ALTER TABLE sessions ADD COLUMN slots_json TEXT;`);

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
    case_id: patch.case_id ?? prev.case_id ?? null,
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    awaiting_book_choice: patch.awaiting_book_choice ?? prev.awaiting_book_choice ?? 0,
    awaiting_slot: patch.awaiting_slot ?? prev.awaiting_slot ?? 0,
    details: patch.details ?? prev.details ?? null,
    name: patch.name ?? prev.name ?? null,
    phone: patch.phone ?? prev.phone ?? null,
    city: patch.city ?? prev.city ?? null,
    slots_json: patch.slots_json ?? prev.slots_json ?? null,
    last_active: now,
  };

  await db.run(
    `
      INSERT INTO sessions
        (from_number, lang, case_id, last_choice, awaiting_details, awaiting_book_choice, awaiting_slot, details, name, phone, city, slots_json, last_active)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_number) DO UPDATE SET
        lang = excluded.lang,
        case_id = excluded.case_id,
        last_choice = excluded.last_choice,
        awaiting_details = excluded.awaiting_details,
        awaiting_book_choice = excluded.awaiting_book_choice,
        awaiting_slot = excluded.awaiting_slot,
        details = excluded.details,
        name = excluded.name,
        phone = excluded.phone,
        city = excluded.city,
        slots_json = excluded.slots_json,
        last_active = excluded.last_active
    `,
    [
      from,
      next.lang,
      next.case_id,
      next.last_choice,
      next.awaiting_details,
      next.awaiting_book_choice,
      next.awaiting_slot,
      next.details,
      next.name,
      next.phone,
      next.city,
      next.slots_json,
      next.last_active,
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

const EN_HINTS = [
  'hello','hi','hey','good morning','good afternoon','good evening',
  'drain','unclog','clogged','leak','camera','inspection','heater','appointment','schedule','water','toilet','sink','solar'
];

const ES_HINTS = [
  'hola','buenas','buenos dias','buenas tardes','buenas noches',
  'destape','tapon','tapada','fuga','goteo','camara','cita','calentador','inodoro','fregadero','banera','bañera','solar'
];

function detectLanguage(bodyRaw, previousLang = 'es') {
  const txt = norm(bodyRaw);

  if (/\benglish\b/.test(txt) || /\bingles\b/.test(txt) || /\bingl[eé]s\b/.test(txt)) return 'en';
  if (/\bespanol\b/.test(txt) || /\bespa[ñn]ol\b/.test(txt) || /\bspanish\b/.test(txt)) return 'es';

  if (/^(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(txt)) return 'en';
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(txt)) return 'es';

  let enScore = 0;
  let esScore = 0;
  for (const w of EN_HINTS) if (txt.includes(w)) enScore++;
  for (const w of ES_HINTS) if (txt.includes(w)) esScore++;

  if (enScore > esScore && enScore > 0) return 'en';
  if (esScore > enScore && esScore > 0) return 'es';
  return previousLang || 'es';
}

const SERVICE_KEYS = ['destape','fuga','camara','calentador','otro','cita'];

const SERVICE_KEYWORDS = {
  destape: ['destape','destapar','tapon','tapada','tapado','obstruccion','drenaje','desague','fregadero','lavaplatos','inodoro','toilet','ducha','lavamanos','banera','bañera','principal','linea principal','drain','unclog','clogged','sewer'],
  fuga: ['fuga','goteo','goteando','salidero','humedad','filtracion','leak','leaking','moisture'],
  camara: ['camara','video inspeccion','inspeccion','inspection','camera inspection','sewer camera'],
  calentador: ['calentador','heater','water heater','gas','electrico','electric','hot water','agua caliente','solar','calentador solar','solar water heater'],
  otro: ['otro','servicio','consulta','presupuesto','cotizacion','other','plumbing','problem'],
  cita: ['cita','appointment','schedule','agendar','reservar'],
};

function matchService(bodyRaw) {
  const txt = norm(bodyRaw);
  const mapNums = { '1':'destape','2':'fuga','3':'camara','4':'calentador','5':'otro','6':'cita' };
  if (mapNums[txt]) return mapNums[txt];
  for (const key of SERVICE_KEYS) {
    const list = SERVICE_KEYWORDS[key];
    if (list.some((w) => txt.includes(w))) return key;
  }
  return null;
}

function serviceName(service, lang) {
  const names = {
    destape: { es: 'Destape', en: 'Drain cleaning' },
    fuga: { es: 'Fuga de agua', en: 'Water leak' },
    camara: { es: 'Inspección con cámara', en: 'Camera inspection' },
    calentador: { es: 'Calentador (gas/eléctrico/solar)', en: 'Water heater (gas/electric/solar)' },
    otro: { es: 'Otro servicio de plomería', en: 'Other plumbing service' },
    cita: { es: 'Cita / coordinar visita', en: 'Appointment' },
  };
  return (names[service] || names.otro)[lang === 'en' ? 'en' : 'es'];
}

function mainMenu(lang) {
  if (lang === 'en') {
    return (
      `👋 Welcome to DestapesPR.\n\n` +
      `Please choose a number or type the service you need:\n\n` +
      `1️⃣ Drain cleaning (clogged drains/pipes)\n` +
      `2️⃣ Leak (water leaks / dampness)\n` +
      `3️⃣ Camera inspection (video)\n` +
      `4️⃣ Water heater (gas / electric / solar)\n` +
      `5️⃣ Other plumbing service\n` +
      `6️⃣ Appointment / schedule a visit\n\n` +
      `💬 Commands:\n` +
      `Type "start", "menu" or "back" to return to this menu.\n` +
      `Type "english" or "español / espanol" to change language.\n\n` +
      `📞 Phone: ${PHONE}\n` +
      `📘 Facebook: ${FB_LINK}`
    );
  }

  return (
    `👋 Bienvenido a DestapesPR.\n\n` +
    `Por favor, selecciona un número o escribe el servicio que necesitas:\n\n` +
    `1️⃣ Destape (drenajes o tuberías tapadas)\n` +
    `2️⃣ Fuga de agua (goteos / filtraciones)\n` +
    `3️⃣ Inspección con cámara (video)\n` +
    `4️⃣ Calentador (gas / eléctrico / solar)\n` +
    `5️⃣ Otro servicio de plomería\n` +
    `6️⃣ Cita / coordinar visita\n\n` +
    `💬 Comandos:\n` +
    `Escribe "inicio", "menu" o "volver" para regresar a este menú.\n` +
    `Escribe "english" o "español / espanol" para cambiar de idioma.\n\n` +
    `📞 Teléfono: ${PHONE}\n` +
    `📘 Facebook: ${FB_LINK}`
  );
}

function servicePrompt(service, lang) {
  const svc = serviceName(service, lang);

  const baseEN =
    `✅ Selected: ${svc}\n\n` +
    `Please send everything in a single message:\n` +
    `• 🧑‍🎓 Full name\n` +
    `• 📞 Contact number\n` +
    `• 📍 City / area\n` +
    `• 📝 Short description\n\n`;

  const baseES =
    `✅ Servicio seleccionado: ${svc}\n\n` +
    `Por favor envía todo en un solo mensaje:\n` +
    `• 🧑‍🎓 Nombre completo\n` +
    `• 📞 Número de contacto\n` +
    `• 📍 Pueblo / zona\n` +
    `• 📝 Descripción breve\n\n`;

  const exEN = {
    destape: `I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged`,
    fuga: `I'm Ana Rivera, 939-555-9999, Caguas, leak on bathroom ceiling`,
    camara: `I'm Ana Rivera, 939-555-9999, Caguas, camera inspection main sewer line`,
    calentador: `I'm Ana Rivera, 939-555-9999, Caguas, solar water heater not heating`,
    cita: `I'm Ana Rivera, 939-555-9999, Caguas, prefer Mon or Tue morning, kitchen sink clogged`,
    otro: `I'm Ana Rivera, 939-555-9999, Caguas, need estimate for bathroom remodeling`
  };

  const exES = {
    destape: `Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado`,
    fuga: `Me llamo Ana Rivera, 939-555-9999, Caguas, fuga en el techo del baño`,
    camara: `Me llamo Ana Rivera, 939-555-9999, Caguas, inspección con cámara en la línea principal`,
    calentador: `Me llamo Ana Rivera, 939-555-9999, Caguas, calentador solar no calienta`,
    cita: `Me llamo Ana Rivera, 939-555-9999, Caguas, prefiero lunes o martes temprano, fregadero tapado`,
    otro: `Me llamo Ana Rivera, 939-555-9999, Caguas, necesito estimado para remodelación de baño`
  };

  if (lang === 'en') return baseEN + `Example:\n${exEN[service] || exEN.otro}`;
  return baseES + `Ejemplo:\n${exES[service] || exES.otro}`;
}

function askToSchedule(lang) {
  if (lang === 'en') {
    return (
      `📅 Do you want to schedule an appointment now?\n\n` +
      `1️⃣ Yes, show available times\n` +
      `2️⃣ No, contact me later`
    );
  }
  return (
    `📅 ¿Deseas agendar una cita ahora?\n\n` +
      `1️⃣ Sí, ver horarios disponibles\n` +
      `2️⃣ No, me contactan luego`
  );
}

function caseIdNow_() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `DP-${y}${m}${day}-${rand}`;
}

function finalSummary(session, bookedSlot) {
  const lang = session.lang || 'es';
  const cid = session.case_id || '';
  const serviceLabel = serviceName(session.last_choice || 'otro', lang);

  const apptLine = bookedSlot
    ? (lang === 'en'
        ? `Appointment: ${bookedSlot.ymd} — ${bookedSlot.slot_en}`
        : `Cita: ${bookedSlot.ymd} — ${bookedSlot.slot_es}`)
    : (lang === 'en'
        ? `Appointment: Pending (we will contact you)`
        : `Cita: Pendiente (te contactaremos)`);

  if (lang === 'en') {
    return (
      `✅ Request saved.\n` +
      `Case #: ${cid}\n\n` +
      `Service: ${serviceLabel}\n` +
      `Name: ${session.name || ''}\n` +
      `Phone: ${session.phone || ''}\n` +
      `City: ${session.city || ''}\n` +
      `Details: ${session.details || ''}\n` +
      `${apptLine}\n\n` +
      `📞 ${PHONE}\n` +
      `📘 ${FB_LINK}\n\n` +
      `Type "menu" to start again.`
    );
  }

  return (
    `✅ Solicitud guardada.\n` +
    `Caso #: ${cid}\n\n` +
    `Servicio: ${serviceLabel}\n` +
    `Nombre: ${session.name || ''}\n` +
    `Tel: ${session.phone || ''}\n` +
    `Pueblo/Zona: ${session.city || ''}\n` +
    `Detalles: ${session.details || ''}\n` +
    `${apptLine}\n\n` +
    `📞 ${PHONE}\n` +
    `📘 ${FB_LINK}\n\n` +
    `Escribe "menu" para comenzar de nuevo.`
  );
}

function renderSlots(slots, lang) {
  const lines = [];
  lines.push(lang === 'en' ? '📅 Available appointments:' : '📅 Citas disponibles:');
  lines.push('');
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    lines.push(`${i + 1}️⃣ ${s.ymd} — ${(lang === 'en') ? s.slot_en : s.slot_es}`);
  }
  lines.push('');
  lines.push(lang === 'en' ? 'Reply with the number to book.' : 'Responde con el número para reservar.');
  return lines.join('\n');
}

function sendTwilioXML(res, text) {
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.send(xml);
}

function parseDetailsLine(raw) {
  const parts = String(raw || '').split(',').map((x) => x.trim()).filter(Boolean);
  let name = parts[0] || '';
  name = name.replace(/^me llamo\s+/i,'').replace(/^i'?m\s+/i,'').replace(/^im\s+/i,'').trim();
  const phone = parts[1] || '';
  const city = parts[2] || '';
  const details = (parts.slice(3).join(', ').trim()) || String(raw || '').trim();
  return { name, phone, city, details };
}

async function postJSON(url, payload, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch (_) {}
    return { ok: true, status: r.status, txt, json };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(t);
  }
}

async function calAvailability(limit = 6) {
  if (!CAL_WEBHOOK_URL || !CAL_WEBHOOK_TOKEN) return { ok: false, error: 'calendar_not_configured' };
  const r = await postJSON(CAL_WEBHOOK_URL, { token: CAL_WEBHOOK_TOKEN, action: 'availability', limit }, 20000);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.json || !r.json.ok) return { ok: false, error: (r.json && r.json.error) || 'availability_failed' };
  return { ok: true, slots: r.json.slots || [] };
}

async function calBook(session, slot) {
  if (!CAL_WEBHOOK_URL || !CAL_WEBHOOK_TOKEN) return { ok: false, error: 'calendar_not_configured' };

  const payload = {
    token: CAL_WEBHOOK_TOKEN,
    action: 'book',
    start_iso: slot.start_iso,
    end_iso: slot.end_iso,
    case_id: session.case_id || '',
    name: session.name || '',
    phone: session.phone || '',
    city: session.city || '',
    from_number: session.from_number || '',
    lang: session.lang || 'es',
    service: session.last_choice || '',
    service_label: serviceName(session.last_choice || 'cita', session.lang || 'es'),
    details: session.details || '',
  };

  const r = await postJSON(CAL_WEBHOOK_URL, payload, 25000);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.json || !r.json.ok) return { ok: false, error: (r.json && r.json.error) || 'book_failed' };
  return { ok: true, data: r.json };
}

async function postLead(session, bookData) {
  if (!LEADS_WEBHOOK_URL || !LEADS_WEBHOOK_TOKEN) return;

  const payload = {
    token: LEADS_WEBHOOK_TOKEN,
    action: 'lead',
    created_at: new Date().toISOString(),
    case_id: session.case_id || '',
    from_number: session.from_number || '',
    lang: session.lang || 'es',
    service: session.last_choice || '',
    service_label: serviceName(session.last_choice || 'otro', session.lang || 'es'),
    name: session.name || '',
    phone: session.phone || '',
    city: session.city || '',
    details: session.details || '',
    appointment_start: (bookData && bookData.start_iso) || '',
    appointment_end: (bookData && bookData.end_iso) || '',
    calendar_event_id: (bookData && bookData.event_id) || '',
    status: (bookData && bookData.event_id) ? 'En proceso' : 'Nuevo'
  };

  postJSON(LEADS_WEBHOOK_URL, payload, 15000).catch(() => {});
}

app.get('/__version', (req, res) => {
  res.json({ ok: true, tag: TAG, tz: 'America/Puerto_Rico' });
});

app.get('/', (req, res) => {
  res.send('DestapesPR WhatsApp bot activo ✅');
});

app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from = (req.body.From || req.body.from || req.body.WaId || '').toString();
  const bodyRaw = (req.body.Body || req.body.body || '').toString();
  if (!from) return sendTwilioXML(res, 'Missing sender.');

  let session = (await getSession(from)) || {
    from_number: from,
    lang: 'es',
    case_id: null,
    last_choice: null,
    awaiting_details: 0,
    awaiting_book_choice: 0,
    awaiting_slot: 0,
    details: null,
    name: null,
    phone: null,
    city: null,
    slots_json: null,
    last_active: 0,
  };

  const newLang = detectLanguage(bodyRaw, session.lang || 'es');
  if (newLang !== session.lang) session = await saveSession(from, { lang: newLang });

  session.from_number = from;
  const lang = session.lang || 'es';
  const bodyNorm = norm(bodyRaw);

  const isMenuCommand = ['inicio','menu','volver','start','back'].includes(bodyNorm);

  const isLanguageCommand =
    /\benglish\b/.test(bodyNorm) || /\bingles\b/.test(bodyNorm) || /\bingl[eé]s\b/.test(bodyNorm) ||
    /\bespanol\b/.test(bodyNorm) || /\bespa[ñn]ol\b/.test(bodyNorm) || /\bspanish\b/.test(bodyNorm);

  const isGreeting =
    ['hola','hello','hi','hey','buenas','buenos dias','buenas tardes','buenas noches','good morning','good afternoon','good evening']
      .includes(bodyNorm);

  const inactiveMs = session.last_active ? (Date.now() - Number(session.last_active)) : Infinity;
  const shouldWelcome = inactiveMs > WELCOME_AFTER_MS;

  if (isLanguageCommand) {
    const confirm = newLang === 'en' ? '✅ Language set to English.\n\n' : '✅ Idioma establecido a español.\n\n';
    await saveSession(from, { lang: newLang });
    return sendTwilioXML(res, confirm + mainMenu(newLang));
  }

  if (!bodyNorm || isMenuCommand || isGreeting || shouldWelcome) {
    await saveSession(from, {
      case_id: null,
      last_choice: null,
      awaiting_details: 0,
      awaiting_book_choice: 0,
      awaiting_slot: 0,
      slots_json: null,
      details: null,
      name: null,
      phone: null,
      city: null,
    });

    const header =
      shouldWelcome && !isMenuCommand
        ? (lang === 'en' ? '👋 Welcome back!\n\n' : '👋 ¡Bienvenido de nuevo!\n\n')
        : (lang === 'en' ? '🔁 Main menu:\n\n' : '🔁 Menú principal:\n\n');

    return sendTwilioXML(res, header + mainMenu(lang));
  }

  if (session.awaiting_slot && session.slots_json) {
    const n = parseInt(bodyNorm, 10);
    let slots = [];
    try { slots = JSON.parse(session.slots_json || '[]'); } catch (_) {}

    if (!Number.isFinite(n) || n < 1 || n > slots.length) {
      return sendTwilioXML(res, lang === 'en' ? 'Reply with a valid number from the list.' : 'Responde con un número válido de la lista.');
    }

    const chosen = slots[n - 1];
    const book = await calBook(session, chosen);

    if (!book.ok) {
      await saveSession(from, { awaiting_slot: 0, slots_json: null });
      await postLead(session, null);
      return sendTwilioXML(res, finalSummary(session, null));
    }

    await postLead(session, book.data);

    await saveSession(from, {
      awaiting_slot: 0,
      slots_json: null,
      awaiting_details: 0,
      awaiting_book_choice: 0,
    });

    return sendTwilioXML(res, finalSummary(session, chosen));
  }

  if (session.awaiting_book_choice && session.last_choice) {
    if (bodyNorm === '1') {
      const av = await calAvailability(6);
      if (!av.ok || !av.slots.length) {
        await saveSession(from, { awaiting_book_choice: 0 });
        await postLead(session, null);
        return sendTwilioXML(res, finalSummary(session, null));
      }

      await saveSession(from, {
        awaiting_book_choice: 0,
        awaiting_slot: 1,
        slots_json: JSON.stringify(av.slots),
      });

      return sendTwilioXML(res, renderSlots(av.slots, lang));
    }

    if (bodyNorm === '2') {
      await postLead(session, null);

      await saveSession(from, {
        awaiting_book_choice: 0,
        awaiting_details: 0,
        awaiting_slot: 0,
        slots_json: null,
      });

      return sendTwilioXML(res, finalSummary(session, null));
    }

    return sendTwilioXML(res, lang === 'en' ? 'Reply 1 or 2.' : 'Responde 1 o 2.');
  }

  if (session.awaiting_details && session.last_choice) {
    const parsed = parseDetailsLine(bodyRaw);
    const cid = caseIdNow_();

    session = await saveSession(from, {
      case_id: cid,
      awaiting_details: 0,
      details: parsed.details,
      name: parsed.name,
      phone: parsed.phone,
      city: parsed.city,
      awaiting_book_choice: 1,
    });

    return sendTwilioXML(res, askToSchedule(lang));
  }

  const svc = matchService(bodyRaw);
  if (svc) {
    await saveSession(from, {
      case_id: null,
      last_choice: svc,
      awaiting_details: 1,
      awaiting_book_choice: 0,
      awaiting_slot: 0,
      slots_json: null,
      details: null,
      name: null,
      phone: null,
      city: null,
    });
    return sendTwilioXML(res, servicePrompt(svc, lang));
  }

  return sendTwilioXML(res, (lang === 'en' ? `I didn't understand.\n\n` : `No entendí.\n\n`) + mainMenu(lang));
});

app.listen(PORT, () => {
  console.log(`💬 ${TAG} escuchando en http://localhost:${PORT}`);
});