// src/server.js
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

// ================== CONFIG GENERAL ==================
const TAG = 'Bilingual Bot V5.1 🇵🇷';
const PHONE_MAIN = '+17879220068';
const FB_LINK = 'https://www.facebook.com/destapesPR/';

const FOOTER_ES = `
✅ Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR

📞 Tel: 787-922-0068
📘 Facebook: ${FB_LINK}

${TAG}`;

const FOOTER_EN = `
✅ We will contact you shortly.
Thank you for your business.
— DestapesPR

📞 Phone: +1 (787) 922-0068
📘 Facebook: ${FB_LINK}

${TAG}`;

// ================ HELPERS TEXTO & IDIOMA =================
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

// Detección muy simple según palabras clave
function detectLanguageFromText(raw) {
  const t = norm(raw);

  const esHints = [
    'hola','buenos dias','buenas tardes','buenas noches',
    'destape','tapon','tapada','fuga','filtro','tuberia','tuberias',
    'baño','bano','inodoro','sanitario','plomeria','plomería',
    'cita','gracias','municipio','sector'
  ];

  const enHints = [
    'hi','hello','good morning','good afternoon','good evening',
    'clog','clogged','drain','leak','pipe','pipes',
    'toilet','sink','shower','appointment','schedule','thanks'
  ];

  if (esHints.some(w => t.includes(w))) return 'es';
  if (enHints.some(w => t.includes(w))) return 'en';
  return 'es'; // por defecto español
}

function isCommandMenu(bodyNorm) {
  return [
    'inicio','menu','volver',
    'start','back'
  ].includes(bodyNorm);
}

function isLangSwitchToEnglish(bodyNorm) {
  return [
    'english','inglés','ingles'
  ].includes(bodyNorm);
}

function isLangSwitchToSpanish(bodyNorm) {
  return [
    'español','espanol','spanish'
  ].includes(bodyNorm);
}

// ================ MENÚ & TEXTOS ===================
function mainMenu(lang = 'es') {
  const headerES = '👋 Bienvenido a DestapesPR\n\nSelecciona el servicio que necesitas (escribe el número o la palabra):';
  const headerEN = '👋 Welcome to DestapesPR\n\nSelect the service you need (type the number or the word):';

  const body = [
    '1️⃣ Destape / Drain unclogging',
    '2️⃣ Fuga / Leak',
    '3️⃣ Cámara / Camera inspection',
    '4️⃣ Calentador / Water heater',
    '5️⃣ Otro servicio / Other service',
    '6️⃣ Cita / Schedule appointment'
  ].join('\n');

  const commands = `
ℹ️ Comandos / Commands:
- Español: escribe "inicio", "menu" o "volver" para regresar al menú.
- English: type "start", "menu" or "back" to return to the menu.

🌐 Para cambiar idioma / To switch language:
- Escribe: "english" o "español".
- Type: "english" or "español".`;

  if (lang === 'en') {
    return `${TAG}

${headerEN}

${body}

${commands}`;
  }

  return `${TAG}

${headerES}

${body}

${commands}`;
}

const LABELS = {
  es: {
    destape: 'destape',
    fuga: 'fuga',
    camara: 'inspección con cámara',
    calentador: 'calentador de agua',
    otro: 'otro servicio',
    cita: 'cita'
  },
  en: {
    destape: 'drain unclogging',
    fuga: 'leak service',
    camara: 'camera inspection',
    calentador: 'water heater service',
    otro: 'other service',
    cita: 'appointment'
  }
};

function servicePrompt(lang, choiceKey) {
  const isES = lang === 'es';

  const baseES = {
    destape: `🚰 Servicio de destape de tuberías.
Cuéntame brevemente qué línea está afectada (fregadero, inodoro, ducha, línea principal, etc.) y en qué municipio/sector te encuentras.`,
    fuga: `💧 Servicio de detección/reparación de fugas.
Descríbeme dónde ves la fuga o humedad y en qué área de la propiedad ocurre.`,
    camara: `📹 Inspección con cámara.
Indica en qué zona necesitas la inspección (baño, cocina, línea principal, etc.) y cuál es el problema principal.`,
    calentador: `🔥 Servicio de calentador de agua (gas o eléctrico).
Dime el tipo de calentador, el problema que presenta y el municipio/sector.`,
    otro: `🛠️ Otro servicio de plomería.
Descríbeme brevemente el trabajo que necesitas y el municipio/sector.`,
    cita: `📅 Coordinación de cita.
Vamos a tomar tus datos para coordinar una visita de servicio.`
  };

  const baseEN = {
    destape: `🚰 Drain unclogging service.
Tell me which line is affected (sink, toilet, shower, main line, etc.) and your city/area.`,
    fuga: `💧 Leak detection/repair service.
Tell me where you see the leak or moisture and in which area of the property it happens.`,
    camara: `📹 Camera inspection.
Tell me where you need the inspection (bathroom, kitchen, main line, etc.) and the main issue.`,
    calentador: `🔥 Water heater service (gas or electric).
Tell me what type of heater you have, the issue, and your city/area.`,
    otro: `🛠️ Other plumbing service.
Briefly describe the job you need and your city/area.`,
    cita: `📅 Appointment scheduling.
We’ll take your details to coordinate a service visit.`
  };

  const commonES = `
Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Municipio o sector
⏰ Horario disponible

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, 10am-1pm en Caguas"

(Escribe "volver" para regresar al menú).`;

  const commonEN = `
Please send everything in ONE message:
👤 Full name
📞 Contact number (US/PR)
📍 City/area
⏰ Available time window

Example:
"My name is Anna Rivera, +1-939-555-9999, 10am-1pm in Caguas"

(Type "back" to return to the menu).`;

  if (isES) {
    return `${baseES[choiceKey]}

${commonES}
${FOOTER_ES}`;
  } else {
    return `${baseEN[choiceKey]}

${commonEN}
${FOOTER_EN}`;
  }
}

function confirmMessage(lang, choiceKey, detailsRaw) {
  const isES = lang === 'es';
  const label = LABELS[lang]?.[choiceKey] || choiceKey;

  if (isES) {
    return `✅ Recibido. Guardé tus detalles para *${label}*:
"${detailsRaw}"

${FOOTER_ES}`;
  }

  return `✅ Received. I saved your details for *${label}*:
"${detailsRaw}"

${FOOTER_EN}`;
}

// ================ MATCH OPCIONES =====================
const OPTION_KEY_BY_NUMBER = {
  '1': 'destape',
  '2': 'fuga',
  '3': 'camara',
  '4': 'calentador',
  '5': 'otro',
  '6': 'cita',

  // emojis:
  '1️⃣': 'destape',
  '2️⃣': 'fuga',
  '3️⃣': 'camara',
  '4️⃣': 'calentador',
  '5️⃣': 'otro',
  '6️⃣': 'cita'
};

const KEYWORDS = {
  destape: [
    'destape','tapon','tapones','tapada','trancada','obstruccion','obstruction',
    'clog','clogged','drain','drains',
    'fregadero','sink','toilet','inodoro','sanitario','bathroom','baño','bano',
    'shower','ducha','linea principal','main line'
  ],
  fuga: [
    'fuga','fugas','leak','leaks','goteo','goteando','humedad','moisture',
    'filtracion','filtration'
  ],
  camara: [
    'camara','cámara','camera','inspection','inspeccion','video','scope'
  ],
  calentador: [
    'calentador','heater','water heater','boiler','gas','electric','eléctrico','electrico'
  ],
  otro: [
    'otro','otros','other','servicio','service','help','ayuda','consulta','quote','estimate'
  ],
  cita: [
    'cita','citas','appointment','schedule','agendar','reservar','booking'
  ]
};

function matchChoice(bodyRaw) {
  const n = norm(bodyRaw);

  if (OPTION_KEY_BY_NUMBER[n]) return OPTION_KEY_BY_NUMBER[n];

  for (const [key, words] of Object.entries(KEYWORDS)) {
    if (words.some(w => n.includes(norm(w)))) {
      return key;
    }
  }

  return null;
}

// ================ SQLite SESSIONS =====================
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database
  });

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

  await db.run(
    'DELETE FROM sessions WHERE last_active < ?',
    Date.now() - SESSION_TTL_MS
  );

  return db;
}

async function getSession(from) {
  return db.get(
    'SELECT from_number, lang, last_choice, awaiting_details, details, last_active FROM sessions WHERE from_number = ?',
    from
  );
}

async function saveSession(from, patch) {
  const prev = (await getSession(from)) || {};
  const now = Date.now();

  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    last_active: now
  };

  await db.run(
    `
    INSERT INTO sessions (from_number, lang, last_choice, awaiting_details, details, last_active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      lang = excluded.lang,
      last_choice = excluded.last_choice,
      awaiting_details = excluded.awaiting_details,
      details = excluded.details,
      last_active = excluded.last_active
  `,
    [
      from,
      next.lang,
      next.last_choice,
      next.awaiting_details,
      next.details,
      next.last_active
    ]
  );

  return next;
}

async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// ================ TWILIO XML ==========================
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  return res.status(200).send(xml);
}

// ================ RUTAS ===============================

app.get('/__version', (_req, res) => {
  res.json({
    ok: true,
    tag: TAG,
    tz: 'America/Puerto_Rico'
  });
});

app.get('/', (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from =
      (req.body.From || req.body.from || req.body.WaId || '').toString();
    const bodyRaw =
      (req.body.Body || req.body.body || '').toString().trim();
    const bodyNorm = norm(bodyRaw);

    let session = await getSession(from);
    let lang = session?.lang || detectLanguageFromText(bodyRaw);

    // 1) Cambio de idioma explícito
    if (isLangSwitchToEnglish(bodyNorm)) {
      lang = 'en';
      session = await saveSession(from, { lang, awaiting_details: 0 });
      const msg =
        `🌐 Language set to English.\nFrom now on I'll answer in English.\n\n` +
        mainMenu('en');
      return sendTwilioXML(res, msg);
    }

    if (isLangSwitchToSpanish(bodyNorm)) {
      lang = 'es';
      session = await saveSession(from, { lang, awaiting_details: 0 });
      const msg =
        `🌐 Idioma configurado a español.\nDe ahora en adelante contestaré en español.\n\n` +
        mainMenu('es');
      return sendTwilioXML(res, msg);
    }

    // 2) Comandos de menú
    if (!bodyNorm || isCommandMenu(bodyNorm)) {
      await clearSession(from);
      const msg = mainMenu(lang);
      return sendTwilioXML(res, msg);
    }

    // 3) Si está esperando detalles, los guardamos primero
    session = await getSession(from);
    lang = session?.lang || lang || 'es';

    if (session?.last_choice && Number(session.awaiting_details) === 1) {
      const choiceKey = session.last_choice;
      await saveSession(from, {
        lang,
        last_choice: choiceKey,
        awaiting_details: 0,
        details: bodyRaw
      });

      const reply = confirmMessage(lang, choiceKey, bodyRaw);
      return sendTwilioXML(res, reply);
    }

    // 4) Intentar detectar opción de menú
    const choiceKey = matchChoice(bodyRaw);
    if (choiceKey) {
      await saveSession(from, {
        lang,
        last_choice: choiceKey,
        awaiting_details: 1,
        details: null
      });

      const reply = servicePrompt(lang, choiceKey);
      return sendTwilioXML(res, reply);
    }

    // 5) No se entendió → mandar menú
    const notUnderstood =
      lang === 'es'
        ? 'No entendí tu mensaje. Te muestro el menú nuevamente:'
        : "I didn’t understand your message. Here’s the menu again:";

    const reply = `${notUnderstood}\n\n${mainMenu(lang)}`;
    return sendTwilioXML(res, reply);
  } catch (err) {
    console.error(err);
    const fallback =
      '⚠️ Ocurrió un error temporal. Intenta nuevamente en unos minutos.';
    return sendTwilioXML(res, fallback);
  }
});

// ================ START ===============================
app.listen(PORT, () => {
  console.log(`${TAG} listening on http://localhost:${PORT}`);
});