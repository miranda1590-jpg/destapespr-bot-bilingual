// server.js — DestapesPR Bilingual Bot V5.1 (🇵🇷)
// Ejecuta con: `node server.js`  (PORT por defecto: 10000)

import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;
const TAG = 'Bilingual Bot V5.1';

// ============ Utilidades ============

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

// Mapea emojis de dígitos a números
const EMOJI_NUM = {
  '1️⃣': '1', '2️⃣': '2', '3️⃣': '3', '4️⃣': '4', '5️⃣': '5', '6️⃣': '6',
  '7️⃣': '7', '8️⃣': '8', '9️⃣': '9', '0️⃣': '0'
};
function stripEmojiDigits(s) {
  let out = s;
  for (const [emo, num] of Object.entries(EMOJI_NUM)) out = out.replaceAll(emo, num);
  return out;
}

// ============ Contacto / Footer ============

const DIRECT_LINE = '+17879220068';
const FB_URL = 'https://www.facebook.com/destapesPR/';

const CONTACTO = `📞 Directo: ${DIRECT_LINE}
🔗 Facebook: ${FB_URL}`;

const COMMANDS_BILINGUAL = `🧭 Comandos / Commands:
• 🇪🇸 Escribe "inicio", "menu" o "volver" para regresar al menú.
• 🇬🇧 Type "start", "menu" or "back" to return to the menu.

🌐 Idioma / Language:
• 🇪🇸 Para cambiar de idioma, escribe: español
• 🇬🇧 To switch language, type: english`;

const FOOTER = `\n${CONTACTO}\n\n— DestapesPR 🇵🇷\nBilingual Bot V5.1`;

// ============ Menús ES / EN ============

const MENU_ES = `🇵🇷 *Bienvenido a DestapesPR* 💧

1️⃣ Destape (drenajes/tuberías tapadas)
2️⃣ Fuga (fugas de agua/filtraciones)
3️⃣ Cámara (inspección con cámara)
4️⃣ Calentador (gas o eléctrico)
5️⃣ Otro (consulta general)
6️⃣ Cita (coordinar una cita)

${COMMANDS_BILINGUAL}

${FOOTER}`;

const MENU_EN = `🇵🇷 *Welcome to DestapesPR* 💧

1️⃣ Unclog (drains or blocked pipes)
2️⃣ Leak (water leaks)
3️⃣ Camera (pipe inspection)
4️⃣ Heater (gas or electric)
5️⃣ Other service (general inquiry)
6️⃣ Schedule an appointment

${COMMANDS_BILINGUAL}

${FOOTER}`;

// ============ Prompts de servicios ES / EN ============

const PROMPTS = {
  es: {
    menu: MENU_ES,
    services: {
      destape: `🔧 *Destape*
Vamos a coordinar. Por favor envía en *un solo mensaje*:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
🚿 Qué línea está tapada (fregadero, inodoro, principal, etc.)
⏰ Horario disponible

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, Caguas, inodoro, 10am–1pm"

${FOOTER}`,

      fuga: `💧 *Fuga*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
💦 Dónde notas la fuga (pared, piso, techo, interior/exterior)
⏰ Horario disponible

${FOOTER}`,

      camara: `📹 *Inspección con cámara*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
🧭 Área a inspeccionar (baño, cocina, línea principal)
⏰ Horario disponible

${FOOTER}`,

      calentador: `🔥 *Calentador*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
⚙️ Tipo y problema (gas/eléctrico, sin calentar, goteo, etc.)
⏰ Horario disponible

${FOOTER}`,

      otro: `📝 *Otro servicio / consulta*
Cuéntame en *un solo mensaje*:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
🛠️ Descripción breve del servicio
⏰ Horario disponible

${FOOTER}`,

      cita: `📅 *Cita*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
🛠️ Servicio que necesitas
⏰ Horario disponible

${FOOTER}`
    },
    confirm: (service, details) => `✅ *Recibido.* Guardé tus detalles:\n"${details}"\n\nServicio: *${service}*\n\n${CONTACTO}\n\n— DestapesPR 🇵🇷\nBilingual Bot V5.1\n(Escribe "volver" para regresar al menú)`,
    changed_to_es: `🇪🇸 *Idioma cambiado a Español.*\n${MENU_ES}`,
    changed_to_en: `🇬🇧 *Language changed to English.*\n${MENU_EN}`,
    didnt_get: `No entendí tu mensaje. Elige una opción del menú o escribe "inicio".\n\n${MENU_ES}`
  },
  en: {
    menu: MENU_EN,
    services: {
      destape: `🔧 *Unclog*
Please send in *one single message*:
👤 Full name
📞 Phone (US or 787/939)
📍 Area (city/sector)
🚿 Which line is clogged (sink, toilet, main, etc.)
⏰ Available time

Example:
"My name is Ana Rivera, 939-555-9999, Caguas, toilet, 10am–1pm"

${FOOTER}`,

      fuga: `💧 *Leak*
Please send:
👤 Full name
📞 Phone (US or 787/939)
📍 Area (city/sector)
💦 Where is the leak (wall, floor, ceiling, indoor/outdoor)
⏰ Available time

${FOOTER}`,

      camara: `📹 *Camera inspection*
Please send:
👤 Full name
📞 Phone (US or 787/939)
📍 Area (city/sector)
🧭 Where to inspect (bathroom, kitchen, main line)
⏰ Available time

${FOOTER}`,

      calentador: `🔥 *Heater*
Please send:
👤 Full name
📞 Phone (US or 787/939)
📍 Area (city/sector)
⚙️ Type & issue (gas/electric, not heating, leaking, etc.)
⏰ Available time

${FOOTER}`,

      otro: `📝 *Other service / question*
Please send in *one single message*:
👤 Full name
📞 Phone (US or 787/939)
📍 Area (city/sector)
🛠️ Brief description
⏰ Available time

${FOOTER}`,

      cita: `📅 *Schedule an appointment*
Please send:
👤 Full name
📞 Phone (US or 787/939)
📍 Area (city/sector)
🛠️ Service needed
⏰ Available time

${FOOTER}`
    },
    confirm: (service, details) => `✅ *Received.* I saved your details:\n"${details}"\n\nService: *${service}*\n\n${CONTACTO}\n\n— DestapesPR 🇵🇷\nBilingual Bot V5.1\n(Type "back" to return to the menu)`,
    changed_to_es: `🇪🇸 *Idioma cambiado a Español.*\n${MENU_ES}`,
    changed_to_en: `🇬🇧 *Language changed to English.*\n${MENU_EN}`,
    didnt_get: `I didn’t understand. Choose an option or type "start".\n\n${MENU_EN}`
  }
};

// Para imprimir nombre del servicio en EN/ES
const SERVICE_NAME = {
  es: {
    destape: 'destape',
    fuga: 'fuga',
    camara: 'inspección con cámara',
    calentador: 'calentador',
    otro: 'otro',
    cita: 'cita'
  },
  en: {
    destape: 'unclog',
    fuga: 'leak',
    camara: 'camera inspection',
    calentador: 'heater',
    otro: 'other',
    cita: 'appointment'
  }
};

// ============ Detección de opciones y comandos ============

const CHOICE_KEYWORDS = {
  destape: ['destape','desagüe','desague','drenaje','obstruccion','tapada','tapon','unclog','clog','blocked'],
  fuga: ['fuga','salidero','leak','filtracion','filtration','goteo'],
  camara: ['camara','cámara','camera','inspection','video'],
  calentador: ['calentador','heater','boiler','water heater','gas','electrico','electric'],
  otro: ['otro','consulta','other','general','question'],
  cita: ['cita','agendar','agenda','appointment','schedule']
};

function detectChoice(body) {
  const b = norm(stripEmojiDigits(body));
  // números
  if (['1','2','3','4','5','6'].includes(b)) {
    return { n: b, key: ['destape','fuga','camara','calentador','otro','cita'][Number(b)-1] };
  }
  // keywords
  for (const [key, arr] of Object.entries(CHOICE_KEYWORDS)) {
    if (arr.some(k => b.includes(k))) return { n: null, key };
  }
  return null;
}

function isMenuCmd(body) {
  const b = norm(body);
  return ['inicio','menu','volver','start','back'].includes(b);
}
function isLangToEN(body) {
  const b = norm(body);
  return ['english','ingles','inglés'].includes(b);
}
function isLangToES(body) {
  const b = norm(body);
  return ['espanol','español','spanish'].includes(b);
}

// ============ SQLite ============

let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function ensureDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      last_active INTEGER
    );
  `);
  // Migración defensiva (añade columnas si faltan)
  const info = await db.all(`PRAGMA table_info(sessions);`);
  const cols = info.map(r => r.name);
  const maybeAdd = async (col, type, def = '') => {
    if (!cols.includes(col)) {
      await db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${type}${def};`);
    }
  };
  await maybeAdd('lang','TEXT');
  await maybeAdd('last_choice','TEXT');
  await maybeAdd('awaiting_details','INTEGER',' DEFAULT 0');
  await maybeAdd('details','TEXT');
  await maybeAdd('last_active','INTEGER');

  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);
  return db;
}

async function getSession(from) {
  return await db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}
async function upsertSession(from, patch = {}) {
  const prev = (await getSession(from)) || {};
  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    last_active: Date.now()
  };
  await db.run(
    `INSERT INTO sessions (from_number, lang, last_choice, awaiting_details, details, last_active)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_number) DO UPDATE SET
       lang=excluded.lang,
       last_choice=excluded.last_choice,
       awaiting_details=excluded.awaiting_details,
       details=excluded.details,
       last_active=excluded.last_active`,
    [from, next.lang, next.last_choice, next.awaiting_details, next.details, next.last_active]
  );
  return next;
}
async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// ============ Twilio responder ============

function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type','application/xml; charset=utf-8');
  return res.send(xml);
}

// ============ Endpoints ============

app.get('/__version', (_req, res) => {
  res.json({ ok:true, tag: TAG, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
});

app.get('/', (_req, res) => res.send(`${TAG} running ✅`));

app.post('/webhook/whatsapp', async (req, res) => {
  await ensureDB();

  const from = String(req.body.From || req.body.from || req.body.WaId || '').trim();
  const bodyRaw = String(req.body.Body || req.body.body || '').trim();
  const bodyNorm = norm(bodyRaw);

  // Obtener/crear sesión
  let sess = await getSession(from);
  if (!sess) {
    // idioma por defecto ES; si detecta palabras ingles -> EN
    const defaultLang = /the|and|please|leak|heater|camera|appointment|english/i.test(bodyRaw) ? 'en' : 'es';
    sess = await upsertSession(from, { lang: defaultLang });
  }
  let lang = sess.lang || 'es';

  // Comandos de menú
  if (isMenuCmd(bodyRaw)) {
    await clearSession(from);
    await upsertSession(from, { lang }); // conserva idioma actual
    const msg = PROMPTS[lang].menu;
    return sendTwilioXML(res, msg);
  }

  // Cambio de idioma
  if (isLangToEN(bodyRaw)) {
    await upsertSession(from, { lang: 'en', last_choice: null, awaiting_details: 0, details: null });
    return sendTwilioXML(res, PROMPTS.es.changed_to_en); // confirmación bilingüe (mensaje en ES/EN)
  }
  if (isLangToES(bodyRaw)) {
    await upsertSession(from, { lang: 'es', last_choice: null, awaiting_details: 0, details: null });
    return sendTwilioXML(res, PROMPTS.en.changed_to_es); // confirmación bilingüe (mensaje en ES/EN)
  }

  // Si está esperando detalles y no es comando, guardar y confirmar
  sess = await getSession(from);
  lang = sess?.lang || 'es';
  if (sess?.last_choice && Number(sess?.awaiting_details) === 1) {
    // Guardar detalles y cerrar "awaiting"
    await upsertSession(from, { details: bodyRaw, awaiting_details: 0 });
    const svcName = SERVICE_NAME[lang][sess.last_choice] || sess.last_choice;
    const msg = PROMPTS[lang].confirm(svcName, bodyRaw);
    return sendTwilioXML(res, msg);
  }

  // Selección de servicio por número o palabra
  const choice = detectChoice(bodyRaw);
  if (choice?.key) {
    await upsertSession(from, { last_choice: choice.key, awaiting_details: 1, details: null });
    const msg = PROMPTS[lang].services[choice.key] || PROMPTS[lang].menu;
    return sendTwilioXML(res, msg);
  }

  // Si dice "hola", "hello", etc., mostrar menú
  if (!bodyNorm || /^(hola|hello|buenas|hi)$/i.test(bodyRaw)) {
    const msg = PROMPTS[lang].menu;
    return sendTwilioXML(res, msg);
  }

  // No entendido
  return sendTwilioXML(res, PROMPTS[lang].didnt_get);
});

// ============ Arranque ============

app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bilingual Bot listening on http://localhost:${PORT}`);
});