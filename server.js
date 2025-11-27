import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// =========================
// Configuración general
// =========================
const TAG = 'DestapesPR Bot 5 Pro 🇵🇷';
const PORT = process.env.PORT || 10000;

const DESTAPESPR_PHONE = '787-922-0068';
const FACEBOOK_URL = 'https://www.facebook.com/destapesPR/';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const DB_FILE = './sessions.db';

// =========================
// SQLite: sesiones
// =========================
let db;

async function getDB() {
  if (db) return db;
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  // Crear tabla básica si no existe
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

  // Asegurar columnas (por si la tabla viene de una versión anterior)
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const names = cols.map(c => c.name);

  if (!names.includes('lang')) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT;`);
  }
  if (!names.includes('last_choice')) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN last_choice TEXT;`);
  }
  if (!names.includes('awaiting_details')) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN awaiting_details INTEGER DEFAULT 0;`);
  }
  if (!names.includes('details')) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN details TEXT;`);
  }
  if (!names.includes('last_active')) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN last_active INTEGER;`);
  }

  await db.run(
    'DELETE FROM sessions WHERE last_active < ?',
    Date.now() - SESSION_TTL_MS
  );

  return db;
}

async function loadSession(from) {
  const db = await getDB();
  const row = await db.get(
    'SELECT * FROM sessions WHERE from_number = ?',
    from
  );
  if (!row) {
    return {
      from_number: from,
      lang: null,
      last_choice: null,
      awaiting_details: 0,
      details: null,
      last_active: Date.now()
    };
  }
  return row;
}

async function saveSession(from, patch = {}) {
  const db = await getDB();
  const prev =
    (await db.get('SELECT * FROM sessions WHERE from_number = ?', from)) || {};
  const now = Date.now();

  const next = {
    lang: patch.lang ?? prev.lang ?? null,
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
  const db = await getDB();
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// =========================
// Helpers: normalizar y detectar idioma/servicio
// =========================
function normalize(str) {
  return (str || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function detectLangHeuristic(text) {
  const t = normalize(text);
  if (!t) return null;

  // Palabras más típicas en español
  const esHits = [
    'destape',
    'tapada',
    'tapon',
    'obstruccion',
    'fuga',
    'filtracion',
    'humedad',
    'camara',
    'inspeccion',
    'calentador',
    'inodoro',
    'fregadero',
    'ba',
    'baño',
    'plomeria',
    'cita',
    'servicio'
  ].filter(w => t.includes(w)).length;

  // Palabras más típicas en inglés
  const enHits = [
    'clog',
    'unclog',
    'drain',
    'leak',
    'leaking',
    'camera',
    'inspection',
    'heater',
    'toilet',
    'sink',
    'shower',
    'plumbing',
    'appointment',
    'schedule',
    'service'
  ].filter(w => t.includes(w)).length;

  if (esHits > enHits && esHits > 0) return 'es';
  if (enHits > esHits && enHits > 0) return 'en';

  if (t.includes('english')) return 'en';
  if (t.includes('espanol') || t.includes('español') || t.includes('spanish'))
    return 'es';

  return null;
}

// Map de palabras clave por servicio
const SERVICE_KEYWORDS = {
  destape: {
    es: [
      'destape',
      'tapada',
      'tapon',
      'tapon en',
      'obstruccion',
      'drenaje',
      'desague',
      'desagüe',
      'inodoro',
      'fregadero',
      'lavamanos',
      'ducha',
      'bañera',
      'banera',
      'sanitario',
      'toilet',
      'linea principal',
      'línea principal'
    ],
    en: [
      'clog',
      'clogged',
      'unclog',
      'blockage',
      'blocked drain',
      'backed up',
      'drain issue',
      'drain problem'
    ]
  },
  fuga: {
    es: ['fuga', 'goteo', 'goteando', 'salidero', 'filtracion', 'humedad'],
    en: ['leak', 'leaking', 'drip', 'dripping', 'water leak', 'pipe leak']
  },
  camara: {
    es: [
      'camara',
      'cámara',
      'camara de inspeccion',
      'inspeccion con camara',
      'video inspeccion',
      'ver tuberia',
      'ver tuberías'
    ],
    en: [
      'camera inspection',
      'sewer camera',
      'video inspection',
      'pipe camera',
      'camera service'
    ]
  },
  calentador: {
    es: [
      'calentador',
      'calentador de gas',
      'calentador electrico',
      'calentador eléctrico',
      'agua caliente',
      'no hay agua caliente'
    ],
    en: [
      'water heater',
      'heater',
      'no hot water',
      'hot water',
      'heater problem'
    ]
  },
  otros: {
    es: [
      'otro',
      'otros',
      'servicio',
      'evaluacion',
      'evaluación',
      'cotizacion',
      'cotización',
      'presupuesto'
    ],
    en: ['other', 'general', 'quote', 'estimate', 'inspection only']
  },
  cita: {
    es: ['cita', 'agendar', 'agenda', 'reservar'],
    en: ['appointment', 'schedule', 'booking']
  }
};

function detectServiceFromText(text) {
  const t = normalize(text);
  if (!t) return { service: null, lang: null };

  for (const [service, langs] of Object.entries(SERVICE_KEYWORDS)) {
    for (const [lang, words] of Object.entries(langs)) {
      for (const w of words) {
        if (t.includes(normalize(w))) {
          return { service, lang };
        }
      }
    }
  }
  return { service: null, lang: null };
}

function detectServiceFromNumber(text) {
  const t = normalize(text);
  if (['1', 'uno', 'one'].includes(t)) return 'destape';
  if (['2', 'dos', 'two'].includes(t)) return 'fuga';
  if (['3', 'tres', 'three'].includes(t)) return 'camara';
  if (['4', 'cuatro', 'four'].includes(t)) return 'calentador';
  if (['5', 'cinco', 'five'].includes(t)) return 'otros';
  if (['6', 'seis', 'six'].includes(t)) return 'cita';
  return null;
}

// =========================
// Mensajes: menú principal, idioma y servicios
// =========================
function buildMainMenu() {
  return (
    `${TAG}\n\n` +
    `👋 Bienvenido a DestapesPR / Welcome to DestapesPR.\n\n` +
    `📝 Puedes escribir directamente el servicio que necesitas en español o inglés\n` +
    `por ejemplo: "destape", "fuga", "camera inspection", "water heater", etc.\n\n` +
    `O usar las opciones con números:\n\n` +
    `1️⃣ Destape / Unclog (drenajes o tuberías tapadas)\n` +
    `2️⃣ Fugas / Leaks (fugas de agua, humedad)\n` +
    `3️⃣ Cámara / Camera (inspección con cámara)\n` +
    `4️⃣ Calentador / Heater (gas o eléctrico / water heater)\n` +
    `5️⃣ Otro / Other (otro tipo de servicio)\n` +
    `6️⃣ Cita / Appointment (deja tus datos)\n\n` +
    `🔁 Comandos / Commands:\n` +
    `   • "menu" / "inicio" / "start" → volver al menú.\n\n` +
    `📞 Teléfono directo: ${DESTAPESPR_PHONE}\n` +
    `📲 Facebook: ${FACEBOOK_URL}\n\n` +
    `🤖 DestapesPR Bot 5 Pro 🇵🇷`
  );
}

function buildLanguageAsk(serviceKey) {
  let serviceLabel = '';
  switch (serviceKey) {
    case 'destape':
      serviceLabel = '1️⃣ Destape / Unclog';
      break;
    case 'fuga':
      serviceLabel = '2️⃣ Fugas / Leaks';
      break;
    case 'camara':
      serviceLabel = '3️⃣ Cámara / Camera';
      break;
    case 'calentador':
      serviceLabel = '4️⃣ Calentador / Heater';
      break;
    case 'otros':
      serviceLabel = '5️⃣ Otro / Other';
      break;
    case 'cita':
      serviceLabel = '6️⃣ Cita / Appointment';
      break;
    default:
      serviceLabel = '';
  }

  return (
    `${TAG}\n\n` +
    `Has elegido el servicio: ${serviceLabel}.\n\n` +
    `🌐 Elige idioma / Choose language:\n` +
    `   • Español 🇵🇷 → escribe "español"\n` +
    `   • English 🇺🇸 → type "english"\n\n` +
    `Después de elegir el idioma, te haré unas preguntas rápidas\n` +
    `para guardar tu información y coordinar tu servicio.`
  );
}

function buildServicePrompt(serviceKey, lang) {
  const isES = lang === 'es';
  switch (serviceKey) {
    case 'destape':
      return isES
        ? `${TAG}\n\n` +
            `🌀 Servicio de destape / drenajes tapados.\n\n` +
            `📍 Primero dime en qué área estás (municipio o sector).\n` +
            `📝 Luego cuéntame qué línea está afectada (inodoro, fregadero, ducha, línea principal, etc.).\n\n` +
            `Por favor envía TODO en un solo mensaje:\n` +
            `👤 Nombre completo\n` +
            `📞 Número de contacto (787/939 o EE.UU.)\n` +
            `🏡 Municipio / sector\n` +
            `🚿 Línea afectada y breve descripción.\n\n` +
            `Ejemplo:\n` +
            `"Soy Ana Rivera, 939-555-9999, Caguas – inodoro tapado que se rebosa al usarlo."\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`
        : `${TAG}\n\n` +
            `🌀 Unclog / drain service.\n\n` +
            `📍 First, tell me your area (city / neighborhood).\n` +
            `📝 Then describe which line is affected (toilet, sink, shower, main line, etc.).\n\n` +
            `Please send EVERYTHING in ONE message:\n` +
            `👤 Full name\n` +
            `📞 Contact number (US/PR)\n` +
            `🏡 City / neighborhood\n` +
            `🚿 Fixture and short description.\n\n` +
            `Example:\n` +
            `"I'm John Smith, +1-787-555-0000, Cayey – clogged toilet backing up when flushing."\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`;

    case 'fuga':
      return isES
        ? `${TAG}\n\n` +
            `💧 Servicio de fugas / filtraciones.\n\n` +
            `📍 Dime en qué área notas la fuga o humedad (baño, cocina, patio, etc.).\n` +
            `📝 Explica si es goteo constante, mancha en el techo, pared húmeda, etc.\n\n` +
            `Envía en un solo mensaje:\n` +
            `👤 Nombre completo\n` +
            `📞 Número de contacto (787/939 o EE.UU.)\n` +
            `🏡 Municipio / sector\n` +
            `💧 Tipo de fuga y breve descripción.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`
        : `${TAG}\n\n` +
            `💧 Leak / moisture service.\n\n` +
            `📍 Tell me where you see the leak or moisture (bathroom, kitchen, yard, etc.).\n` +
            `📝 Explain if it's a constant drip, stain on the ceiling, wet wall, etc.\n\n` +
            `Send everything in ONE message:\n` +
            `👤 Full name\n` +
            `📞 Contact number (US/PR)\n` +
            `🏡 City / neighborhood\n` +
            `💧 Type of leak and short description.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`;

    case 'camara':
      return isES
        ? `${TAG}\n\n` +
            `🎥 Inspección con cámara.\n\n` +
            `📍 Indica en qué área necesitas la cámara (baño, cocina, línea principal, etc.).\n` +
            `📝 Explica el problema: destape recurrente, mal olor, filtración, construcción nueva, etc.\n\n` +
            `Envía en un solo mensaje:\n` +
            `👤 Nombre completo\n` +
            `📞 Número de contacto (787/939 o EE.UU.)\n` +
            `🏡 Municipio / sector\n` +
            `🎥 Dónde deseas la inspección y breve descripción.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`
        : `${TAG}\n\n` +
            `🎥 Camera inspection service.\n\n` +
            `📍 Tell me where you need the camera (bathroom, kitchen, main line, etc.).\n` +
            `📝 Explain the issue: recurring clogs, bad odor, leak, new construction, etc.\n\n` +
            `Send in ONE message:\n` +
            `👤 Full name\n` +
            `📞 Contact number (US/PR)\n` +
            `🏡 City / neighborhood\n` +
            `🎥 Where you need the inspection and short description.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`;

    case 'calentador':
      return isES
        ? `${TAG}\n\n` +
            `🔥 Servicio de calentador (gas o eléctrico).\n\n` +
            `📍 Indica en qué pueblo estás y si el calentador es de gas o eléctrico.\n` +
            `📝 Explica el problema: no calienta, bota agua, se apaga, etc.\n\n` +
            `Envía en un solo mensaje:\n` +
            `👤 Nombre completo\n` +
            `📞 Número de contacto (787/939 o EE.UU.)\n` +
            `🏡 Municipio / sector\n` +
            `🔥 Tipo de calentador y breve descripción del problema.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`
        : `${TAG}\n\n` +
            `🔥 Water heater service (gas or electric).\n\n` +
            `📍 Tell me your city and if the heater is gas or electric.\n` +
            `📝 Explain the problem: no hot water, leaking, turns off, etc.\n\n` +
            `Send everything in ONE message:\n` +
            `👤 Full name\n` +
            `📞 Contact number (US/PR)\n` +
            `🏡 City / neighborhood\n` +
            `🔥 Type of heater and short description of the issue.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`;

    case 'otros':
      return isES
        ? `${TAG}\n\n` +
            `🛠️ Otro servicio de plomería.\n\n` +
            `📍 Dime en qué municipio / sector te encuentras.\n` +
            `📝 Explica brevemente el servicio que necesitas (remodelación, evaluación, presupuesto, etc.).\n\n` +
            `Envía en un solo mensaje:\n` +
            `👤 Nombre completo\n` +
            `📞 Número de contacto (787/939 o EE.UU.)\n` +
            `🏡 Municipio / sector\n` +
            `🛠️ Servicio que necesitas y breve descripción.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`
        : `${TAG}\n\n` +
            `🛠️ Other plumbing service.\n\n` +
            `📍 Tell me your city / neighborhood.\n` +
            `📝 Briefly explain the service you need (remodel, evaluation, quote, etc.).\n\n` +
            `Send in ONE message:\n` +
            `👤 Full name\n` +
            `📞 Contact number (US/PR)\n` +
            `🏡 City / neighborhood\n` +
            `🛠️ Service you need and short description.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`;

    case 'cita':
      return isES
        ? `${TAG}\n\n` +
            `📅 Vamos a coordinar tu cita.\n\n` +
            `Envía en un solo mensaje:\n` +
            `👤 Nombre completo\n` +
            `📞 Número de contacto (787/939 o EE.UU.)\n` +
            `🏡 Municipio / sector\n` +
            `🛠️ Servicio que necesitas (destape, fuga, cámara, calentador, etc.) y breve descripción.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`
        : `${TAG}\n\n` +
            `📅 Let's schedule your appointment.\n\n` +
            `Please send in ONE message:\n` +
            `👤 Full name\n` +
            `📞 Contact number (US/PR)\n` +
            `🏡 City / neighborhood\n` +
            `🛠️ Service you need (unclog, leak, camera, heater, etc.) and short description.\n\n` +
            `🤖 DestapesPR Bot 5 Pro 🇵🇷`;

    default:
      return buildMainMenu();
  }
}

function buildConfirmation(serviceKey, lang, rawDetails) {
  const isES = lang === 'es';
  const serviceNameES = {
    destape: 'destape',
    fuga: 'fuga',
    camara: 'cámara',
    calentador: 'calentador',
    otros: 'otro servicio',
    cita: 'cita'
  }[serviceKey] || 'servicio';

  const serviceNameEN = {
    destape: 'unclog',
    fuga: 'leak',
    camara: 'camera inspection',
    calentador: 'water heater',
    otros: 'other service',
    cita: 'appointment'
  }[serviceKey] || 'service';

  return isES
    ? `${TAG}\n\n` +
        `✅ Recibido. Guardé tus detalles para *${serviceNameES}*:\n` +
        `"${rawDetails}"\n\n` +
        `Próximamente nos estaremos comunicando.\n` +
        `Gracias por su patrocinio.\n` +
        `— DestapesPR\n\n` +
        `📞 Teléfono directo: ${DESTAPESPR_PHONE}\n` +
        `📲 Facebook: ${FACEBOOK_URL}\n\n` +
        `🤖 DestapesPR Bot 5 Pro 🇵🇷`
    : `${TAG}\n\n` +
        `✅ Received. I saved your details for *${serviceNameEN}*:\n` +
        `"${rawDetails}"\n\n` +
        `We will contact you shortly.\n` +
        `Thank you for your business.\n` +
        `— DestapesPR\n\n` +
        `📞 Direct phone: ${DESTAPESPR_PHONE}\n` +
        `📲 Facebook: ${FACEBOOK_URL}\n\n` +
        `🤖 DestapesPR Bot 5 Pro 🇵🇷`;
}

// =========================
// Twilio helper
// =========================
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.status(200).send(xml);
}

// =========================
// Express app
// =========================
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

// Health + versión
app.get('/', (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

app.get('/__version', (_req, res) => {
  res.json({
    ok: true,
    tag: TAG,
    tz: 'America/Puerto_Rico'
  });
});

// Endpoint diagnóstico opcional
app.get('/__diag', async (_req, res) => {
  const db = await getDB();
  const count = await db.get('SELECT COUNT(*) AS c FROM sessions;');
  res.json({
    ok: true,
    tag: TAG,
    sessions: count?.c ?? 0
  });
});

// =========================
// Webhook principal WhatsApp
// =========================
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const from =
      (req.body.From || req.body.from || req.body.WaId || '').toString();
    const rawBody = (req.body.Body || req.body.body || '').toString();
    const normBody = normalize(rawBody);

    let session = await loadSession(from);

    // 1) Comandos para volver al menú
    if (
      !normBody ||
      ['menu', 'inicio', 'start', 'hola', 'buenas', 'hello', 'hi'].includes(
        normBody
      )
    ) {
      session = await saveSession(from, {
        last_choice: null,
        awaiting_details: 0
      });
      return sendTwilioXML(res, buildMainMenu());
    }

    // 2) Si estamos esperando detalles del servicio (awaiting_details = 1)
    if (session.awaiting_details === 1 && session.last_choice) {
      const langGuess =
        session.lang || detectLangHeuristic(rawBody) || 'es';
      session = await saveSession(from, {
        details: rawBody,
        awaiting_details: 0,
        lang: langGuess
      });
      const reply = buildConfirmation(
        session.last_choice,
        langGuess,
        rawBody
      );
      return sendTwilioXML(res, reply);
    }

    // 3) Si estamos esperando que elija idioma (awaiting_details = 2)
    if (session.awaiting_details === 2 && session.last_choice) {
      const langChoice = detectLangHeuristic(rawBody);
      if (!langChoice) {
        const ask = buildLanguageAsk(session.last_choice);
        return sendTwilioXML(res, ask);
      }
      session = await saveSession(from, {
        lang: langChoice,
        awaiting_details: 1
      });
      const prompt = buildServicePrompt(
        session.last_choice,
        langChoice
      );
      return sendTwilioXML(res, prompt);
    }

    // 4) Fuera de flujo: detectar servicio por texto primero
    const { service: svcFromText, lang: langFromText } =
      detectServiceFromText(rawBody);

    if (svcFromText) {
      const finalLang =
        session.lang || langFromText || detectLangHeuristic(rawBody) || 'es';

      session = await saveSession(from, {
        lang: finalLang,
        last_choice: svcFromText,
        awaiting_details: 1
      });

      const prompt = buildServicePrompt(svcFromText, finalLang);
      return sendTwilioXML(res, prompt);
    }

    // 5) Detectar servicio por número
    const svcFromNumber = detectServiceFromNumber(rawBody);
    if (svcFromNumber) {
      if (!session.lang) {
        // no sabemos idioma → preguntamos idioma
        session = await saveSession(from, {
          last_choice: svcFromNumber,
          awaiting_details: 2
        });
        const ask = buildLanguageAsk(svcFromNumber);
        return sendTwilioXML(res, ask);
      } else {
        // ya sabemos idioma → vamos directo al menú del servicio
        session = await saveSession(from, {
          last_choice: svcFromNumber,
          awaiting_details: 1
        });
        const prompt = buildServicePrompt(
          svcFromNumber,
          session.lang || 'es'
        );
        return sendTwilioXML(res, prompt);
      }
    }

    // 6) Si escribe algo que no encaja, mostrar menú bilingüe
    const fallback = buildMainMenu();
    return sendTwilioXML(res, fallback);
  } catch (err) {
    console.error('Error in /webhook/whatsapp', err);
    const fallback = buildMainMenu();
    return sendTwilioXML(res, fallback);
  }
});

// =========================
// Arrancar servidor
// =========================
app.listen(PORT, () => {
  console.log(`${TAG} listening on http://localhost:${PORT}`);
});