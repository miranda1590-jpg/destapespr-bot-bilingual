// server.js - DestapesPR Bot 5 Pro (bilingüe ES/EN)

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
// SQLite: sesiones
// =========================
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas

async function initDB() {
  if (db) return db;

  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database,
  });

  // Crear tabla si no existe
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT DEFAULT 'es',
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      last_active INTEGER
    );
  `);

  // Migración: añadir columna lang si la tabla es vieja
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const hasLang = cols.some((c) => c.name === 'lang');
  if (!hasLang) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es';`);
  }

  // Limpiar sesiones viejas
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
  const prev = (await getSession(from)) || {};
  const now = Date.now();

  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details:
      patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    last_active: now,
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
      next.last_active,
    ]
  );

  return next;
}

async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// =========================
// Utilidades de texto
// =========================
function norm(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

// Palabras clave para detección de idioma
const EN_HINTS = [
  'drain',
  'unclog',
  'clogged',
  'leak',
  'camera',
  'inspection',
  'heater',
  'appointment',
  'schedule',
  'water',
  'toilet',
  'sink',
];
const ES_HINTS = [
  'destape',
  'tapon',
  'tapada',
  'fuga',
  'goteo',
  'camara',
  'camara',
  'cita',
  'calentador',
  'inodoro',
  'fregadero',
  'banera',
  'bañera',
];

function detectLanguage(bodyRaw, previousLang = 'es') {
  const txt = norm(bodyRaw);

  // Cambio explícito de idioma
  if (/\benglish\b/.test(txt) || /\bingles\b/.test(txt) || /\bingl[eé]s\b/.test(txt)) {
    return 'en';
  }
  if (/\bespanol\b/.test(txt) || /\bespa[ñn]ol\b/.test(txt) || /\bspanish\b/.test(txt)) {
    return 'es';
  }

  let enScore = 0;
  let esScore = 0;
  for (const w of EN_HINTS) {
    if (txt.includes(w)) enScore++;
  }
  for (const w of ES_HINTS) {
    if (txt.includes(w)) esScore++;
  }

  if (enScore > esScore && enScore > 0) return 'en';
  if (esScore > enScore && esScore > 0) return 'es';

  return previousLang || 'es';
}

// =========================
// Servicios y keywords
// =========================
const SERVICE_KEYS = ['destape', 'fuga', 'camara', 'calentador', 'otro', 'cita'];

const SERVICE_KEYWORDS = {
  destape: [
    'destape',
    'destapar',
    'tapon',
    'tapada',
    'tapado',
    'obstruccion',
    'obstruccion',
    'drenaje',
    'desague',
    'desague',
    'fregadero',
    'lavaplatos',
    'inodoro',
    'toilet',
    'ducha',
    'lavamanos',
    'banera',
    'banera',
    'principal',
    'linea principal',
    'drain',
    'drain cleaning',
    'unclog',
    'clogged',
    'sewer',
  ],
  fuga: [
    'fuga',
    'goteo',
    'goteando',
    'salidero',
    'fuga de agua',
    'humedad',
    'filtracion',
    'filtracion',
    'leak',
    'water leak',
    'leaking',
    'moisture',
  ],
  camara: [
    'camara',
    'camara',
    'video inspeccion',
    'inspeccion',
    'inspection',
    'camera inspection',
    'sewer camera',
  ],
  calentador: [
    'calentador',
    'boiler',
    'heater',
    'water heater',
    'gas',
    'electrico',
    'electric',
    'hot water',
    'agua caliente',
  ],
  otro: [
    'otro',
    'otros',
    'servicio',
    'consulta',
    'presupuesto',
    'cotizacion',
    'other',
    'plumbing',
    'problem',
  ],
  cita: [
    'cita',
    'appointment',
    'schedule',
    'agendar',
    'reservar',
  ],
};

function matchService(bodyRaw) {
  const txt = norm(bodyRaw);

  // Números 1–6
  const mapNums = {
    '1': 'destape',
    '2': 'fuga',
    '3': 'camara',
    '4': 'calentador',
    '5': 'otro',
    '6': 'cita',
  };
  if (mapNums[txt]) return mapNums[txt];

  // Palabras
  for (const key of SERVICE_KEYS) {
    const list = SERVICE_KEYWORDS[key];
    if (list.some((w) => txt.includes(w))) {
      return key;
    }
  }
  return null;
}

// =========================
// Textos de menús
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

  // Español por defecto
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

function servicePrompt(service, lang) {
  if (service === 'destape') {
    if (lang === 'en') {
      return (
        '✅ Selected service: Drain cleaning\n\n' +
        'Please send everything in a single message:\n' +
        '• 🧑‍🎓 Full name\n' +
        '• 📞 Contact number (US/PR)\n' +
        '• 📍 City / area / sector\n' +
        '• 📝 Short description of the issue (sink, toilet, main line, etc.)\n\n' +
        'Example:\n' +
        `"I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"\n\n` +
        'We will review your information and contact you as soon as possible.'
      );
    }
    return (
      '✅ Servicio seleccionado: Destape\n\n' +
      'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
      '• 🧑‍🎓 Nombre completo\n' +
      '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
      '• 📍 Zona / municipio / sector\n' +
      '• 📝 Descripción breve del problema (fregadero, inodoro, línea principal, etc.)\n\n' +
      'Ejemplo:\n' +
      `"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n\n` +
      'Revisaremos tu información y nos comunicaremos lo antes posible.'
    );
  }

  if (service === 'fuga') {
    if (lang === 'en') {
      return (
        '✅ Selected service: Water leak\n\n' +
        'Please send everything in a single message:\n' +
        '• 🧑‍🎓 Full name\n' +
        '• 📞 Contact number (US/PR)\n' +
        '• 📍 City / area / sector\n' +
        '• 📝 Where do you see the leak or dampness? (wall, ceiling, floor, etc.)\n\n' +
        'Example:\n' +
        `"I'm Ana Rivera, 939-555-9999, Caguas, water leak in the bathroom ceiling"\n\n` +
        'We will review your information and contact you as soon as possible.'
      );
    }
    return (
      '✅ Servicio seleccionado: Fuga de agua\n\n' +
      'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
      '• 🧑‍🎓 Nombre completo\n' +
      '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
      '• 📍 Zona / municipio / sector\n' +
      '• 📝 Dónde notas la fuga o la humedad (pared, techo, piso, etc.)\n\n' +
      'Ejemplo:\n' +
      `"Me llamo Ana Rivera, 939-555-9999, Caguas, fuga en el techo del baño"\n\n` +
      'Revisaremos tu información y nos comunicaremos lo antes posible.'
    );
  }

  if (service === 'camara') {
    if (lang === 'en') {
      return (
        '✅ Selected service: Camera inspection\n\n' +
        'Please send everything in a single message:\n' +
        '• 🧑‍🎓 Full name\n' +
        '• 📞 Contact number (US/PR)\n' +
        '• 📍 City / area / sector\n' +
        '• 📝 Area to inspect (bathroom, kitchen, main line, etc.)\n\n' +
        'Example:\n' +
        `"I'm Ana Rivera, 939-555-9999, Caguas, camera inspection in main sewer line"\n\n` +
        'We will review your information and contact you as soon as possible.'
      );
    }
    return (
      '✅ Servicio seleccionado: Inspección con cámara\n\n' +
      'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
      '• 🧑‍🎓 Nombre completo\n' +
      '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
      '• 📍 Zona / municipio / sector\n' +
      '• 📝 Área a inspeccionar (baño, cocina, línea principal, etc.)\n\n' +
      'Ejemplo:\n' +
      `"Me llamo Ana Rivera, 939-555-9999, Caguas, inspección con cámara en la línea principal"\n\n` +
      'Revisaremos tu información y nos comunicaremos lo antes posible.'
    );
  }

  if (service === 'calentador') {
    if (lang === 'en') {
      return (
        '✅ Selected service: Water heater (gas or electric)\n\n' +
        'Please send everything in a single message:\n' +
        '• 🧑‍🎓 Full name\n' +
        '• 📞 Contact number (US/PR)\n' +
        '• 📍 City / area / sector\n' +
        '• 📝 Type of heater and problem (gas/electric, not heating, leaking, etc.)\n\n' +
        'Example:\n' +
        `"I'm Ana Rivera, 939-555-9999, Caguas, electric water heater not heating"\n\n` +
        'We will review your information and contact you as soon as possible.'
      );
    }
    return (
      '✅ Servicio seleccionado: Calentador de agua\n\n' +
      'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
      '• 🧑‍🎓 Nombre completo\n' +
      '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
      '• 📍 Zona / municipio / sector\n' +
      '• 📝 Tipo de calentador y problema (gas/eléctrico, no calienta, fuga, etc.)\n\n' +
      'Ejemplo:\n' +
      `"Me llamo Ana Rivera, 939-555-9999, Caguas, calentador eléctrico no calienta"\n\n` +
      'Revisaremos tu información y nos comunicaremos lo antes posible.'
    );
  }

  if (service === 'cita') {
    if (lang === 'en') {
      return (
        '✅ Selected: Schedule an appointment\n\n' +
        'Please send everything in a single message:\n' +
        '• 🧑‍🎓 Full name\n' +
        '• 📞 Contact number (US/PR)\n' +
        '• 📍 City / area / sector\n' +
        '• 📝 Preferred days and time range\n' +
        '• 📝 Short description of the plumbing issue\n\n' +
        'Example:\n' +
        `"I'm Ana Rivera, 939-555-9999, Caguas, prefer Monday–Wednesday 10am–1pm, kitchen sink clogged"\n\n` +
        'We will review your information and contact you as soon as possible.'
      );
    }
    return (
      '✅ Servicio seleccionado: Cita / coordinar visita\n\n' +
      'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
      '• 🧑‍🎓 Nombre completo\n' +
      '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
      '• 📍 Zona / municipio / sector\n' +
      '• 📝 Días y horario aproximado de disponibilidad\n' +
      '• 📝 Descripción breve del problema de plomería\n\n' +
      'Ejemplo:\n' +
      `"Me llamo Ana Rivera, 939-555-9999, Caguas, prefiero lunes a miércoles 10am–1pm, fregadero de cocina tapado"\n\n` +
      'Revisaremos tu información y nos comunicaremos lo antes posible.'
    );
  }

  // "otro"
  if (lang === 'en') {
    return (
      '✅ Selected service: Other plumbing service\n\n' +
      'Please send everything in a single message:\n' +
      '• 🧑‍🎓 Full name\n' +
      '• 📞 Contact number (US/PR)\n' +
      '• 📍 City / area / sector\n' +
      '• 📝 Short description of the service you need\n\n' +
      'Example:\n' +
      `"I'm Ana Rivera, 939-555-9999, Caguas, need estimate for bathroom remodeling"\n\n` +
      'We will review your information and contact you as soon as possible.'
    );
  }
  return (
    '✅ Servicio seleccionado: Otro servicio de plomería\n\n' +
    'Vamos a coordinar. Por favor envía todo en un solo mensaje:\n' +
    '• 🧑‍🎓 Nombre completo\n' +
    '• 📞 Número de contacto (787/939 o EE.UU.)\n' +
    '• 📍 Zona / municipio / sector\n' +
    '• 📝 Descripción breve del servicio que necesitas\n\n' +
    'Ejemplo:\n' +
    `"Me llamo Ana Rivera, 939-555-9999, Caguas, necesito estimado para remodelación de baño"\n\n` +
    'Revisaremos tu información y nos comunicaremos lo antes posible.'
  );
}

function detailsThankYou(service, lang, details) {
  if (lang === 'en') {
    return (
      '✅ Thank you, we saved your information.\n\n' +
      `Service: ${serviceName(service, lang)}\n` +
      `Details:\n"${details}"\n\n` +
      'We will review your information and contact you as soon as possible.\n\n' +
      'To return to the menu, type "menu" or "start".'
    );
  }
  return (
    '✅ Gracias, hemos guardado tu información.\n\n' +
    `Servicio: ${serviceName(service, lang)}\n` +
    `Detalles:\n"${details}"\n\n` +
    'Revisaremos tu información y nos comunicaremos lo antes posible.\n\n' +
    'Para regresar al menú escribe "menu", "inicio" o "volver".'
  );
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

// =========================
// Twilio helpers
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
// Rutas de diagnóstico
// =========================
app.get('/__version', (req, res) => {
  res.json({ ok: true, tag: TAG, tz: 'America/Puerto_Rico' });
});

app.get('/', (req, res) => {
  res.send('DestapesPR WhatsApp bot activo ✅');
});

// =========================
// Webhook principal
// =========================
app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from =
    (req.body.From ||
      req.body.from ||
      req.body.WaId ||
      '').toString();
  const bodyRaw = (req.body.Body || req.body.body || '').toString();

  if (!from) {
    return sendTwilioXML(res, 'Missing sender.');
  }

  let session = (await getSession(from)) || {
    from_number: from,
    lang: 'es',
    last_choice: null,
    awaiting_details: 0,
    details: null,
    last_active: Date.now(),
  };

  // Detectar idioma (puede cambiarlo explícitamente)
  const newLang = detectLanguage(bodyRaw, session.lang || 'es');
  if (newLang !== session.lang) {
    session = await saveSession(from, { lang: newLang });
  }

  const lang = session.lang || 'es';
  const bodyNorm = norm(bodyRaw);

  // Comandos de menú
  const isMenuCommand =
    ['inicio', 'menu', 'volver', 'start', 'back'].includes(bodyNorm);
  const isLanguageCommand =
    /\benglish\b/.test(bodyNorm) ||
    /\bingles\b/.test(bodyNorm) ||
    /\bingl[eé]s\b/.test(bodyNorm) ||
    /\bespanol\b/.test(bodyNorm) ||
    /\bespa[ñn]ol\b/.test(bodyNorm) ||
    /\bspanish\b/.test(bodyNorm);

  // 1) Comandos de menú → siempre mandan al menú principal
  if (!bodyNorm || isMenuCommand) {
    await saveSession(from, {
      last_choice: null,
      awaiting_details: 0,
      details: null,
    });
    const reply =
      lang === 'en'
        ? '🔁 Returning to the main menu.\n\n' + mainMenu(lang)
        : '🔁 Regresando al menú principal.\n\n' + mainMenu(lang);
    return sendTwilioXML(res, reply);
  }

  // 2) Comando de idioma explícito → confirmar + menú
  if (isLanguageCommand) {
    const confirm =
      newLang === 'en'
        ? '✅ Language set to English.\n\n'
        : '✅ Idioma establecido a español.\n\n';
    await saveSession(from, { lang: newLang });
    return sendTwilioXML(res, confirm + mainMenu(newLang));
  }

  // 3) Si está esperando detalles, PRIORIDAD: tomar el mensaje como detalles
  if (session.awaiting_details && session.last_choice) {
    await saveSession(from, {
      awaiting_details: 0,
      details: bodyRaw,
    });
    const reply = detailsThankYou(session.last_choice, lang, bodyRaw);
    return sendTwilioXML(res, reply);
  }

  // 4) Detectar servicio (por número o palabras)
  const svc = matchService(bodyRaw);
  if (svc) {
    await saveSession(from, {
      last_choice: svc,
      awaiting_details: 1,
      details: null,
    });
    const reply = servicePrompt(svc, lang);
    return sendTwilioXML(res, reply);
  }

  // 5) Fallback: no se entendió → mostrar menú en el idioma actual
  const fallback =
    lang === 'en'
      ? "I didn't understand your message.\n\n" +
        mainMenu(lang)
      : 'No entendí tu mensaje.\n\n' + mainMenu(lang);

  return sendTwilioXML(res, fallback);
});

// =========================
// Arrancar servidor
// =========================
app.listen(PORT, () => {
  console.log(`💬 DestapesPR bot escuchando en http://localhost:${PORT}`);
});