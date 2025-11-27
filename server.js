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

// ===== DB SETUP =====
let db;

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
      last_service TEXT,
      awaiting_details INTEGER DEFAULT 0,
      last_details TEXT,
      last_active INTEGER
    );
  `);

  // Migración defensiva por si viene de versiones viejas
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const names = cols.map(c => c.name);
  const migrations = [];
  if (!names.includes('lang')) migrations.push(`ALTER TABLE sessions ADD COLUMN lang TEXT;`);
  if (!names.includes('last_service')) migrations.push(`ALTER TABLE sessions ADD COLUMN last_service TEXT;`);
  if (!names.includes('awaiting_details')) migrations.push(`ALTER TABLE sessions ADD COLUMN awaiting_details INTEGER DEFAULT 0;`);
  if (!names.includes('last_details')) migrations.push(`ALTER TABLE sessions ADD COLUMN last_details TEXT;`);
  for (const m of migrations) {
    await db.exec(m);
  }

  return db;
}

async function getSession(from) {
  await initDB();
  return db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}

async function saveSession(from, patch = {}) {
  await initDB();
  const prev = (await getSession(from)) || {};
  const now = Date.now();
  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    last_service: patch.last_service ?? prev.last_service ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    last_details: patch.last_details ?? prev.last_details ?? null,
    last_active: now
  };

  await db.run(
    `
    INSERT INTO sessions (from_number, lang, last_service, awaiting_details, last_details, last_active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      lang = excluded.lang,
      last_service = excluded.last_service,
      awaiting_details = excluded.awaiting_details,
      last_details = excluded.last_details,
      last_active = excluded.last_active
  `,
    [from, next.lang, next.last_service, next.awaiting_details, next.last_details, next.last_active]
  );

  return next;
}

async function clearSession(from) {
  await initDB();
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// ===== HELPERS =====
function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

// Detección simple ES / EN
function detectLang(bodyRaw, prevLang = 'es') {
  const t = norm(bodyRaw);

  if (/^(english|ingles|inglés)\b/.test(t)) return 'en';
  if (/^(espanol|español|spanish)\b/.test(t)) return 'es';

  if (/\b(drain|clog|leak|camera|heater|water|sink|kitchen|bathroom|appointment)\b/i.test(bodyRaw)) {
    return 'en';
  }

  if (/[áéíóúñ]/i.test(bodyRaw) || /\b(fregadero|inodoro|bañera|ducha|fuga|calentador|destape)\b/i.test(bodyRaw)) {
    return 'es';
  }

  return prevLang || 'es';
}

// ===== CLASIFICACIÓN DE SERVICIO =====
const SERVICE_KEYS = {
  destape: {
    numbers: ['1'],
    keywords: [
      'destape',
      'tapon',
      'tapado',
      'tapada',
      'clog',
      'clogged',
      'drain',
      'drains',
      'drain cleaning',
      'drenaje',
      'drenajes',
      'desague',
      'desagüe',
      'tuberia tapada',
      'tuberia',
      'tuberias',
      'linea principal',
      'línea principal',
      'main line',
      'toilet',
      'inodoro',
      'wc',
      'fregadero',
      'sink',
      'lavamanos',
      'lavabo',
      'bañera',
      'banera',
      'ducha',
      'shower',
      'kitchen line',
      'kitchen sink',
      'bathroom line'
    ]
  },
  fuga: {
    numbers: ['2'],
    keywords: [
      'fuga',
      'fugas',
      'goteo',
      'goteando',
      'salidero',
      'filtracion',
      'filtración',
      'humedad',
      'leak',
      'leaks',
      'water leak',
      'pipe leak',
      'gotea'
    ]
  },
  camara: {
    numbers: ['3'],
    keywords: [
      'camara',
      'cámara',
      'camera',
      'camera inspection',
      'inspection camera',
      'pipe inspection',
      'video inspeccion',
      'video inspección',
      'cctv',
      'inspeccion con camara',
      'inspeccion de tuberia'
    ]
  },
  calentador: {
    numbers: ['4'],
    keywords: [
      'calentador',
      'agua caliente',
      'no hay agua caliente',
      'heater',
      'water heater',
      'boiler',
      'tankless',
      'gas heater',
      'electric heater'
    ]
  },
  otro: {
    numbers: ['5'],
    keywords: [
      'otro',
      'otros',
      'other',
      'something else',
      'general plumbing',
      'servicio general',
      'consulta',
      'plomeria',
      'plumbing'
    ]
  },
  cita: {
    numbers: ['6'],
    keywords: [
      'cita',
      'appointment',
      'schedule',
      'agendar',
      'reservar',
      'book',
      'book a visit'
    ]
  }
};

function classifyService(bodyRaw) {
  const t = norm(bodyRaw);

  if (/^[1-6]$/.test(t)) {
    for (const [service, cfg] of Object.entries(SERVICE_KEYS)) {
      if (cfg.numbers.includes(t)) return service;
    }
  }

  for (const [service, cfg] of Object.entries(SERVICE_KEYS)) {
    if (cfg.keywords.some(k => t.includes(k))) return service;
  }

  return null;
}

// ===== TEXTOS =====
function buildMenu(lang) {
  const baseFooter =
    '📞 Teléfono / Phone: 787-922-0068\n' +
    '📘 Facebook: https://www.facebook.com/destapesPR/\n';

  if (lang === 'en') {
    return (
      '✅ Language set to English.\n\n' +
      '👋 DestapesPR – Customer service\n\n' +
      '🌐 Language / Idioma\n' +
      '• Type "english" to stay in English\n' +
      '• Escribe "español" para cambiar a español\n\n' +
      'Please select a number or type the service you need:\n\n' +
      '1️⃣ Drain cleaning (clogs / blocked drains)\n' +
      '2️⃣ Water leak (leaks / moisture)\n' +
      '3️⃣ Camera inspection (pipes)\n' +
      '4️⃣ Water heater (gas or electric)\n' +
      '5️⃣ Other plumbing service\n' +
      '6️⃣ Schedule an appointment\n\n' +
      'Commands:\n' +
      'Type "start", "menu" or "back" to return to this menu.\n' +
      'Type "spanish" or "español" to switch to Spanish.\n\n' +
      baseFooter +
      '\n— DestapesPR 🇵🇷 – Bilingual ES/EN'
    );
  }

  // Español
  return (
    '✅ Idioma establecido a español.\n\n' +
    '👋 DestapesPR – Servicio al cliente\n\n' +
    '🌐 Idioma / Language\n' +
    '• Escribe "español" para continuar en español\n' +
    '• Type "english" to switch to English\n\n' +
    'Por favor, selecciona un número o escribe el servicio que necesitas:\n\n' +
    '1️⃣ Destape (drenajes/tuberías tapadas)\n' +
    '2️⃣ Fuga de agua\n' +
    '3️⃣ Inspección con cámara\n' +
    '4️⃣ Calentador de agua\n' +
    '5️⃣ Otro servicio\n' +
    '6️⃣ Cita\n\n' +
    '🧾 Comandos:\n' +
    'Escribe "inicio", "menu" o "volver" para regresar a este menú.\n' +
    'Escribe "english" para cambiar a inglés.\n\n' +
    baseFooter +
    '\n— DestapesPR 🇵🇷 – Bot bilingüe ES/EN'
  );
}

function buildServicePrompt(lang, service) {
  const titles = {
    destape: lang === 'en' ? 'Drain cleaning' : 'Destape',
    fuga: lang === 'en' ? 'Water leak' : 'Fuga de agua',
    camara: lang === 'en' ? 'Camera inspection' : 'Inspección con cámara',
    calentador: lang === 'en' ? 'Water heater' : 'Calentador de agua',
    otro: lang === 'en' ? 'Other service' : 'Otro servicio',
    cita: lang === 'en' ? 'Appointment' : 'Cita'
  };

  if (lang === 'en') {
    return (
      `✅ Selected service: ${titles[service]}\n\n` +
      'Please send everything in a *single message*:\n' +
      '👤 Full name\n' +
      '📞 Contact number (US/PR)\n' +
      '📍 City / Area\n' +
      '📝 Short description of the issue\n\n' +
      'Example:\n' +
      `"I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"\n\n` +
      'We will review your information and contact you as soon as possible.\n' +
      'Thank you for choosing DestapesPR 🇵🇷'
    );
  }

  return (
    `✅ Servicio seleccionado: ${titles[service]}\n\n` +
    'Vamos a coordinar. Por favor envía *todo en un solo mensaje*:\n' +
    '👤 Nombre completo\n' +
    '📞 Número de contacto (787/939 o EE.UU.)\n' +
    '📍 Zona / municipio / sector\n' +
    '📝 Descripción breve del problema\n\n' +
    'Ejemplo:\n' +
    '"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n\n' +
    'Revisaremos tu información y nos comunicaremos lo antes posible.\n' +
    'Gracias por tu patrocinio.\n' +
    '— DestapesPR 🇵🇷'
  );
}

function buildFinalThanks(lang, service, detailsText) {
  const titles = {
    destape: lang === 'en' ? 'Drain cleaning' : 'Destape',
    fuga: lang === 'en' ? 'Water leak' : 'Fuga de agua',
    camara: lang === 'en' ? 'Camera inspection' : 'Inspección con cámara',
    calentador: lang === 'en' ? 'Water heater' : 'Calentador de agua',
    otro: lang === 'en' ? 'Other service' : 'Otro servicio',
    cita: lang === 'en' ? 'Appointment' : 'Cita'
  };

  if (lang === 'en') {
    return (
      `✅ Got it. I saved your details for *${titles[service] || 'service'}*:\n` +
      `"${detailsText}"\n\n` +
      'We will contact you shortly to coordinate.\n' +
      'Thank you for your business.\n' +
      '— DestapesPR 🇵🇷'
    );
  }

  return (
    `✅ Perfecto. Guardé tus datos para *${titles[service] || 'servicio'}*:\n` +
    `"${detailsText}"\n\n` +
    'Próximamente nos estaremos comunicando para coordinar.\n' +
    'Gracias por su patrocinio.\n' +
    '— DestapesPR 🇵🇷'
  );
}

// ===== TWILIO XML =====
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.send(xml);
}

// ===== WEBHOOK =====
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from =
      req.body.From ||
      req.body.from ||
      req.body.WaId ||
      '';
    const bodyRaw = (req.body.Body || req.body.body || '').toString().trim();
    const bodyNorm = norm(bodyRaw);

    if (!from) {
      return sendTwilioXML(res, 'Missing sender.');
    }

    let session = await getSession(from);
    let lang = detectLang(bodyRaw, session?.lang || 'es');

    const isMenuCmd =
      ['inicio', 'menu', 'menú', 'volver'].includes(bodyNorm) ||
      ['start', 'menu', 'back', 'help', 'hi', 'hello'].includes(bodyNorm);

    // Cambio explícito de idioma
    if (/^\s*(english|ingles|inglés)\s*$/i.test(bodyRaw)) {
      lang = 'en';
      session = await saveSession(from, { lang, awaiting_details: 0, last_service: null });
      return sendTwilioXML(res, buildMenu(lang));
    }
    if (/^\s*(espanol|español|spanish)\s*$/i.test(bodyRaw)) {
      lang = 'es';
      session = await saveSession(from, { lang, awaiting_details: 0, last_service: null });
      return sendTwilioXML(res, buildMenu(lang));
    }

    if (!bodyRaw || isMenuCmd) {
      await saveSession(from, { lang, awaiting_details: 0, last_service: null });
      return sendTwilioXML(res, buildMenu(lang));
    }

    // Si estamos esperando detalles
    if (session?.awaiting_details && session.last_service) {
      await saveSession(from, {
        lang,
        awaiting_details: 0,
        last_details: bodyRaw
      });
      const reply = buildFinalThanks(lang, session.last_service, bodyRaw);
      return sendTwilioXML(res, reply);
    }

    // Clasificar servicio
    const service = classifyService(bodyRaw);
    if (service) {
      await saveSession(from, {
        lang,
        last_service: service,
        awaiting_details: 1
      });
      const reply = buildServicePrompt(lang, service);
      return sendTwilioXML(res, reply);
    }

    // No se entendió → mensaje + menú
    const notUnderstood =
      lang === 'en'
        ? 'I did not understand your message. Returning to the main menu.\n\n'
        : 'No entendí tu mensaje. Regresando al menú principal.\n\n';
    const reply = notUnderstood + buildMenu(lang);
    return sendTwilioXML(res, reply);
  } catch (err) {
    console.error('Error in /webhook/whatsapp', err);
    return sendTwilioXML(res, 'Error interno. Intenta nuevamente más tarde.');
  }
});

// ===== HEALTH & VERSION =====
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

app.listen(PORT, () => {
  console.log(`💬 DestapesPR escuchando en http://localhost:${PORT}`);
});