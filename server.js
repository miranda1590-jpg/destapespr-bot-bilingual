// server.js
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

// ====== SQLite ======
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database
  });

  // Tabla base
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      last_active INTEGER
    )
  `);

  // Migración defensiva: asegurar columna lang
  const cols = await db.all(`PRAGMA table_info(sessions)`);
  const hasLang = cols.some(c => c.name === 'lang');
  if (!hasLang) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT`);
  }

  // Limpieza de sesiones viejas
  await db.run(
    'DELETE FROM sessions WHERE last_active < ?',
    Date.now() - SESSION_TTL_MS
  );

  return db;
}

async function getSession(from) {
  return db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}

async function saveSession(from, patch = {}) {
  const current = (await getSession(from)) || {};
  const merged = {
    lang: patch.lang ?? current.lang ?? null,
    last_choice: patch.last_choice ?? current.last_choice ?? null,
    awaiting_details:
      patch.awaiting_details ?? current.awaiting_details ?? 0,
    details: patch.details ?? current.details ?? null,
    last_active: Date.now()
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
      merged.lang,
      merged.last_choice,
      merged.awaiting_details,
      merged.details,
      merged.last_active
    ]
  );

  return merged;
}

async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// ====== Utilidades texto / idioma ======
function norm(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

// Detección simple de idioma
function detectLangFromText(bodyRaw) {
  const b = norm(bodyRaw);
  if (!b) return null;

  const esHits = [
    'destape',
    'fuga',
    'camara',
    'camara',
    'calentador',
    'tuberia',
    'tuberia',
    'baño',
    'bano',
    'inodoro',
    'tuberias'
  ].filter(w => b.includes(w)).length;

  const enHits = [
    'drain',
    'clog',
    'leak',
    'water heater',
    'camera inspection',
    'pipe',
    'sewer',
    'toilet'
  ].filter(w => b.includes(w)).length;

  if (esHits === 0 && enHits === 0) return null;
  if (esHits >= enHits) return 'es';
  return 'en';
}

// ====== Textos por idioma ======
const CONTACT_FOOTER = `
📞 Teléfono: 787-922-0068
📘 Facebook: https://www.facebook.com/destapesPR/

🇵🇷 DestapesPR Bot 5 Pro – Bilingüe ES/EN`;

const LANG_HELP = `🌐 Idioma / Language
• Escribe "español" para continuar en español
• Type "english" to switch to English`;

const MENU_TEXT = {
  es: {
    greeting: `👋 DestapesPR – Servicio al cliente`,
    intro: `Por favor, selecciona un número o escribe el servicio que necesitas:`,
    services: [
      '1️⃣ Destape (drenajes/tuberías tapadas)',
      '2️⃣ Fuga de agua',
      '3️⃣ Inspección con cámara',
      '4️⃣ Calentador de agua',
      '5️⃣ Otro servicio',
      '6️⃣ Cita'
    ],
    commands: `💬 Comandos:
Escribe "inicio", "menu" o "volver" para regresar a este menú.
Escribe "english" para cambiar a inglés.`,
    confirmLang: `✅ Idioma establecido a español.`
  },
  en: {
    greeting: `👋 DestapesPR – Customer Service`,
    intro: `Please select a number or type the service you need:`,
    services: [
      '1️⃣ Drain cleaning (clogged drains/pipes)',
      '2️⃣ Water leak',
      '3️⃣ Camera inspection',
      '4️⃣ Water heater',
      '5️⃣ Other service',
      '6️⃣ Schedule appointment'
    ],
    commands: `💬 Commands:
Type "start", "menu" or "back" to return to this menu.
Type "español" to switch to Spanish.`,
    confirmLang: `✅ Language set to English.`
  }
};

const SERVICE_KEYS = ['destape', 'fuga', 'camara', 'calentador', 'otro', 'cita'];

const NUMBER_TO_SERVICE = {
  '1': 'destape',
  '2': 'fuga',
  '3': 'camara',
  '4': 'calentador',
  '5': 'otro',
  '6': 'cita'
};

// Sinónimos por idioma
const KEYWORDS = {
  es: {
    destape: [
      'destape',
      'tapon',
      'tapada',
      'tapon en tuberia',
      'tuberia tapada',
      'drenaje tapado',
      'inodoro tapado',
      'baño tapado',
      'bano tapado',
      'fregadero tapado'
    ],
    fuga: [
      'fuga',
      'fuga de agua',
      'goteo',
      'goteando',
      'salidero',
      'humedad',
      'filtracion',
      'filtración'
    ],
    camara: [
      'camara',
      'cámara',
      'inspeccion con camara',
      'inspeccion con cámara',
      'video inspeccion',
      'ver tuberia',
      'ver tubería'
    ],
    calentador: [
      'calentador',
      'calentador de agua',
      'boiler',
      'heater',
      'agua caliente'
    ],
    otro: ['otro servicio', 'otro', 'consulta', 'cotizacion', 'cotización'],
    cita: ['cita', 'agendar', 'agenda', 'reservar', 'appointment']
  },
  en: {
    destape: [
      'drain cleaning',
      'clogged drain',
      'clogged pipe',
      'unclog',
      'sewer cleaning',
      'toilet clogged',
      'kitchen sink clogged'
    ],
    fuga: ['leak', 'water leak', 'dripping', 'drip', 'leaking'],
    camara: [
      'camera inspection',
      'pipe inspection',
      'video inspection',
      'sewer camera'
    ],
    calentador: ['water heater', 'heater', 'no hot water'],
    otro: ['other service', 'other', 'question', 'estimate'],
    cita: ['appointment', 'schedule', 'book visit', 'schedule appointment']
  }
};

// Prompts por servicio
const SERVICE_PROMPTS = {
  es: {
    destape: `🚰 *Destape*

Vamos a coordinar. Por favor envía *todo en un solo mensaje*:
• 👤 Nombre completo
• 📞 Número de contacto (787/939 o EE.UU.)
• 📍 Zona (municipio/sector)
• 🔧 Qué línea está tapada (fregadero, inodoro, principal, etc.)

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`,
    fuga: `💧 *Fuga de agua*

Por favor envía *todo en un solo mensaje*:
• 👤 Nombre completo
• 📞 Número de contacto (787/939 o EE.UU.)
• 📍 Zona (municipio/sector)
• 💧 Dónde notas la fuga (pared, piso, techo, interior/exterior)`,
    camara: `📹 *Inspección con cámara*

Por favor envía *todo en un solo mensaje*:
• 👤 Nombre completo
• 📞 Número de contacto (787/939 o EE.UU.)
• 📍 Zona (municipio/sector)
• 📍 Área a inspeccionar (baño, cocina, línea principal)`,
    calentador: `🔥 *Calentador de agua*

Por favor envía *todo en un solo mensaje*:
• 👤 Nombre completo
• 📞 Número de contacto (787/939 o EE.UU.)
• 📍 Zona (municipio/sector)
• 🔥 Tipo de calentador (gas o eléctrico) y problema que notas`,
    otro: `🛠️ *Otro servicio*

Por favor envía *todo en un solo mensaje*:
• 👤 Nombre completo
• 📞 Número de contacto (787/939 o EE.UU.)
• 📍 Zona (municipio/sector)
• ✏️ Breve descripción del servicio que necesitas`,
    cita: `📅 *Solicitud de cita*

Por favor envía *todo en un solo mensaje*:
• 👤 Nombre completo
• 📞 Número de contacto (787/939 o EE.UU.)
• 📍 Zona (municipio/sector)
• ✏️ Servicio que te interesa y disponibilidad aproximada`
  },
  en: {
    destape: `🚰 *Drain cleaning*

Please send *everything in a single message*:
• 👤 Full name
• 📞 Contact number (US/PR)
• 📍 City / Area
• 🔧 Short description of the clog (toilet, kitchen sink, main line, etc.)

Example:
"I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"`,
    fuga: `💧 *Water leak*

Please send *everything in a single message*:
• 👤 Full name
• 📞 Contact number (US/PR)
• 📍 City / Area
• 💧 Where you see the leak (wall, floor, ceiling, inside/outside)`,
    camara: `📹 *Camera inspection*

Please send *everything in a single message*:
• 👤 Full name
• 📞 Contact number (US/PR)
• 📍 City / Area
• 📍 Area to inspect (bathroom, kitchen, main line)`,
    calentador: `🔥 *Water heater*

Please send *everything in a single message*:
• 👤 Full name
• 📞 Contact number (US/PR)
• 📍 City / Area
• 🔥 Type of heater (gas or electric) and what is happening`,
    otro: `🛠️ *Other service*

Please send *everything in a single message*:
• 👤 Full name
• 📞 Contact number (US/PR)
• 📍 City / Area
• ✏️ Short description of the service you need`,
    cita: `📅 *Schedule an appointment*

Please send *everything in a single message*:
• 👤 Full name
• 📞 Contact number (US/PR)
• 📍 City / Area
• ✏️ Service you need and approximate availability`
  }
};

const SERVICE_LABEL = {
  es: {
    destape: 'Destape',
    fuga: 'Fuga de agua',
    camara: 'Inspección con cámara',
    calentador: 'Calentador de agua',
    otro: 'Otro servicio',
    cita: 'Cita'
  },
  en: {
    destape: 'Drain cleaning',
    fuga: 'Water leak',
    camara: 'Camera inspection',
    calentador: 'Water heater',
    otro: 'Other service',
    cita: 'Appointment'
  }
};

// ====== Helpers de lógica ======
function buildMainMenu(lang = 'es') {
  const t = MENU_TEXT[lang] || MENU_TEXT.es;
  return `${t.greeting}

${LANG_HELP}

${t.intro}
${t.services.join('\n')}

${t.commands}

${CONTACT_FOOTER}`;
}

function matchService(bodyRaw, lang = 'es') {
  const b = norm(bodyRaw);
  if (!b) return null;

  // Número directo
  if (NUMBER_TO_SERVICE[b]) return NUMBER_TO_SERVICE[b];

  // Nombre exacto de servicio
  if (SERVICE_KEYS.includes(b)) return b;

  // Keywords por idioma
  const dict = KEYWORDS[lang] || KEYWORDS.es;
  for (const [service, words] of Object.entries(dict)) {
    if (words.some(w => b.includes(norm(w)))) {
      return service;
    }
  }

  // Si no encontró en ese idioma, probar el otro
  const otherLang = lang === 'es' ? 'en' : 'es';
  const dict2 = KEYWORDS[otherLang];
  for (const [service, words] of Object.entries(dict2)) {
    if (words.some(w => b.includes(norm(w)))) {
      return service;
    }
  }

  return null;
}

// ====== Twilio XML helper ======
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  res.send(xml);
}

// ====== Rutas diagnostico ======
app.get('/__version', (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: 'America/Puerto_Rico' });
});

app.get('/', (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

// ====== Webhook WhatsApp ======
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from =
      req.body.From ||
      req.body.from ||
      req.body.WaId ||
      req.body.waId ||
      '';
    const bodyRaw = req.body.Body || req.body.body || '';
    const body = norm(bodyRaw);

    if (!from) {
      return sendTwilioXML(
        res,
        'Error: no se recibió el número de origen.'
      );
    }

    let session = await getSession(from);

    // ----- Comandos de idioma -----
    if (['english'].includes(body)) {
      session = await saveSession(from, { lang: 'en', awaiting_details: 0 });
      const text = `${MENU_TEXT.en.confirmLang}

${buildMainMenu('en')}`;
      return sendTwilioXML(res, text);
    }

    if (['espanol', 'español', 'spanish'].includes(body)) {
      session = await saveSession(from, { lang: 'es', awaiting_details: 0 });
      const text = `${MENU_TEXT.es.confirmLang}

${buildMainMenu('es')}`;
      return sendTwilioXML(res, text);
    }

    // Idioma por sesión / detección
    let lang = session?.lang;
    if (!lang) {
      lang = detectLangFromText(bodyRaw) || 'es';
      session = await saveSession(from, { lang });
    }

    // ----- Comandos de menú -----
    if (
      ['inicio', 'menu', 'volver', 'start', 'back'].includes(body)
    ) {
      await saveSession(from, {
        awaiting_details: 0,
        last_choice: null,
        details: null
      });
      return sendTwilioXML(res, buildMainMenu(lang));
    }

    // Si la sesión está esperando detalles y el mensaje NO es un servicio
    const possibleService = matchService(bodyRaw, lang);
    if (
      session?.awaiting_details &&
      session?.last_choice &&
      !possibleService
    ) {
      // Guardar detalles y cerrar ciclo
      await saveSession(from, {
        awaiting_details: 0,
        details: bodyRaw
      });

      const label =
        SERVICE_LABEL[lang]?.[session.last_choice] ||
        SERVICE_LABEL.es[session.last_choice] ||
        session.last_choice;

      const closing =
        lang === 'es'
          ? `✅ Datos recibidos. Guardé tu información para *${label}*:

"${bodyRaw}"

Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR 🇵🇷

${CONTACT_FOOTER}`
          : `✅ Received. I saved your information for *${label}*:

"${bodyRaw}"

We will contact you shortly.
Thank you for your business.
— DestapesPR 🇵🇷

${CONTACT_FOOTER}`;

      return sendTwilioXML(res, closing);
    }

    // Si el mensaje parece indicar un servicio (número o palabra)
    if (possibleService) {
      const key = possibleService;
      await saveSession(from, {
        lang,
        last_choice: key,
        awaiting_details: 1,
        details: null
      });

      const label =
        SERVICE_LABEL[lang]?.[key] ||
        SERVICE_LABEL.es[key] ||
        key;

      const header =
        lang === 'es'
          ? `✅ Servicio seleccionado: ${label}`
          : `✅ Selected service: ${label}`;

      const prompt =
        SERVICE_PROMPTS[lang]?.[key] ||
        SERVICE_PROMPTS.es[key];

      const msg = `${header}

${prompt}

${lang === 'es'
        ? 'Escribe "menu" o "volver" para regresar al menú principal.'
        : 'Type "menu" or "back" to return to the main menu.'}`;

      return sendTwilioXML(res, msg);
    }

    // Si nada matcheó: mostrar menú principal en el idioma actual
    return sendTwilioXML(res, buildMainMenu(lang));
  } catch (err) {
    console.error('Error en /webhook/whatsapp', err);
    return sendTwilioXML(
      res,
      'Ocurrió un error interno. Intenta de nuevo más tarde.'
    );
  }
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bot escuchando en http://localhost:${PORT}`);
});