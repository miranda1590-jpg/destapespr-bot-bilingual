import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;
const TAG = 'DestapesPR Bot 5 Pro 🇵🇷';

// === SQLite session handling ===
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas

async function initDB() {
  if (db) return db;
  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database
  });
  // Esquema básico. No usamos "lang" para evitar errores de migración.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
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
  const row = await db.get(
    'SELECT from_number, last_choice, awaiting_details, details, last_active FROM sessions WHERE from_number = ?',
    from
  );
  if (!row) {
    return {
      from_number: from,
      last_choice: null,
      awaiting_details: 0,
      details: null,
      last_active: Date.now()
    };
  }
  return row;
}

async function saveSession(sessionPatch) {
  const now = Date.now();
  const from = sessionPatch.from_number;
  const prev = await getSession(from);
  const next = {
    from_number: from,
    last_choice:
      sessionPatch.last_choice !== undefined
        ? sessionPatch.last_choice
        : prev.last_choice,
    awaiting_details:
      sessionPatch.awaiting_details !== undefined
        ? sessionPatch.awaiting_details
        : prev.awaiting_details,
    details:
      sessionPatch.details !== undefined
        ? sessionPatch.details
        : prev.details,
    last_active: now
  };
  await db.run(
    `
    INSERT INTO sessions (from_number, last_choice, awaiting_details, details, last_active)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      last_choice = excluded.last_choice,
      awaiting_details = excluded.awaiting_details,
      details = excluded.details,
      last_active = excluded.last_active
  `,
    [
      next.from_number,
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

// === Utility ===
function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\s\n\r\t]+/g, ' ')
    .trim();
}

function buildTwiml(message) {
  const safe = String(message)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

// === Main bilingual menu ===
const FB_LINK = 'https://www.facebook.com/destapesPR/';
const PHONE = '787-922-0068';

function buildMainMenu() {
  return `
👋 Bienvenido / Welcome — DestapesPR Bot 5 Pro 🇵🇷

📝 Puedes escribir directamente el servicio que necesitas en español o inglés  
(ejemplo: "destape", "fuga", "leak", "camera inspection", "water heater").  

📝 You can also type the service directly in English or Spanish  
(example: "destape", "leak", "camera inspection", "water heater").  

O escoger un número / Or choose a number:

1️⃣ Destape / Drain Cleaning  
2️⃣ Fugas / Leaks  
3️⃣ Inspección con Cámara / Camera Inspection  
4️⃣ Calentador (Gas / Eléctrico) / Water Heater (Gas / Electric)  
5️⃣ Otro Servicio / Other Service  
6️⃣ Cita / Appointment  

📞 Llamar / Call DestapesPR: ${PHONE}  
📘 Facebook: ${FB_LINK}

Comandos: "inicio", "menu", "volver"  
Commands: "start", "menu", "back"

— DestapesPR Bot 5 Pro 🇵🇷
`;
}

// === Service-specific prompts (bilingual) ===
function buildServicePrompt(choice) {
  switch (choice) {
    case 'destape':
      return `
🚿 Destape / Drain Cleaning

Por favor envía en un solo mensaje:  
👤 Nombre  
📞 Teléfono (787/939 o EE.UU.)  
📍 Pueblo / área  
📝 Qué está tapado (fregadero, inodoro, ducha, línea principal, etc.)

Please send in one single message:  
👤 Name  
📞 Phone (US or PR)  
📍 City / area  
📝 What is clogged (sink, toilet, shower, main line, etc.)

Ejemplo / Example:  
"Soy Ana Rivera, 939-555-9999, Caguas, fregadero tapado en la cocina"
`;
    case 'fuga':
      return `
💧 Fugas / Leaks

Envía en un solo mensaje:  
👤 Nombre  
📞 Teléfono  
📍 Pueblo / área  
📝 Dónde ves la fuga o humedad (pared, plafón, patio, baño, cocina, etc.)

Send in one single message:  
👤 Name  
📞 Phone  
📍 City / area  
📝 Where you see the leak or humidity (wall, ceiling, yard, bathroom, kitchen, etc.)
`;
    case 'camara':
      return `
📹 Inspección con Cámara / Camera Inspection

Envía en un solo mensaje:  
👤 Nombre  
📞 Teléfono  
📍 Pueblo / área  
📝 Dónde necesitas la inspección (baño, cocina, línea principal, otro)

Send in one single message:  
👤 Name  
📞 Phone  
📍 City / area  
📝 Where you need the camera inspection (bathroom, kitchen, main line, other)
`;
    case 'calentador':
      return `
🔥 Calentador / Water Heater

Envía en un solo mensaje:  
👤 Nombre  
📞 Teléfono  
📍 Pueblo / área  
📝 Tipo de calentador (gas / eléctrico, tanque / instantáneo) y problema

Send in one single message:  
👤 Name  
📞 Phone  
📍 City / area  
📝 Type of heater (gas / electric, tank / tankless) and the issue
`;
    case 'otro':
      return `
🛠️ Otro Servicio / Other Service

Envía en un solo mensaje:  
👤 Nombre  
📞 Teléfono  
📍 Pueblo / área  
📝 Explica brevemente el servicio que necesitas

Send in one single message:  
👤 Name  
📞 Phone  
📍 City / area  
📝 Brief description of the service you need
`;
    case 'cita':
      return `
📅 Cita / Appointment

Envía en un solo mensaje:  
👤 Nombre  
📞 Teléfono  
📍 Pueblo / área  
📆 Día(s) que te funcionan  
⏰ Horario aproximado (mañana / tarde)

Send in one single message:  
👤 Name  
📞 Phone  
📍 City / area  
📆 Day(s) that work for you  
⏰ Approximate time (morning / afternoon)
`;
    default:
      return buildMainMenu();
  }
}

// === Confirmation message when user sends details ===
function buildConfirmation(choice, rawText) {
  let label = '';
  switch (choice) {
    case 'destape':
      label = 'Destape / Drain Cleaning';
      break;
    case 'fuga':
      label = 'Fugas / Leaks';
      break;
    case 'camara':
      label = 'Inspección con Cámara / Camera Inspection';
      break;
    case 'calentador':
      label = 'Calentador / Water Heater';
      break;
    case 'cita':
      label = 'Cita / Appointment';
      break;
    default:
      label = 'Otro Servicio / Other Service';
  }

  return `
✅ Información recibida / Details received.

Servicio / Service: ${label}

Mensaje del cliente / Client message:
"${rawText}"

✅ Próximamente nos estaremos comunicando.  
✅ We will contact you shortly.

Gracias por su patrocinio.  
Thank you for your business.

— DestapesPR Bot 5 Pro 🇵🇷
`;
}

// === Keyword-based intent detection (ES/EN) ===
const KEYWORDS = {
  destape: [
    'destape',
    'tapada',
    'tapon',
    'tapado',
    'obstruccion',
    'obstruction',
    'clog',
    'clogged',
    'drain',
    'drain cleaning',
    'blocked'
  ],
  fuga: [
    'fuga',
    'filtracion',
    'filtración',
    'goteo',
    'goteando',
    'leak',
    'leaks',
    'leaking',
    'water leak'
  ],
  camara: [
    'camara',
    'cámara',
    'camera',
    'camera inspection',
    'video',
    'video inspection'
  ],
  calentador: [
    'calentador',
    'heater',
    'water heater',
    'boiler',
    'hot water'
  ],
  otro: [
    'otro',
    'other',
    'service',
    'servicio'
  ],
  cita: [
    'cita',
    'appointment',
    'schedule',
    'agendar',
    'agenda'
  ]
};

function detectChoice(body) {
  const txt = norm(body);
  if (!txt) return null;

  // numeric menu
  if (['1', '1️⃣'].includes(txt)) return 'destape';
  if (['2', '2️⃣'].includes(txt)) return 'fuga';
  if (['3', '3️⃣'].includes(txt)) return 'camara';
  if (['4', '4️⃣'].includes(txt)) return 'calentador';
  if (['5', '5️⃣'].includes(txt)) return 'otro';
  if (['6', '6️⃣'].includes(txt)) return 'cita';

  // keyword match
  for (const [choice, list] of Object.entries(KEYWORDS)) {
    if (list.some(k => txt.includes(k))) {
      return choice;
    }
  }
  return null;
}

// === Version + health ===
app.get('/__version', (req, res) => {
  res.json({
    ok: true,
    tag: TAG,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
});

app.get('/', (req, res) => {
  res.send(`${TAG} activo ✅`);
});

// === Main webhook ===
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from =
      req.body.From ||
      req.body.from ||
      req.body.WaId ||
      '';
    const bodyRaw =
      req.body.Body ||
      req.body.body ||
      '';
    const body = String(bodyRaw || '').trim();

    if (!from) {
      const xml = buildTwiml(
        'Error: no se pudo identificar el número / could not detect number.'
      );
      res.type('application/xml').send(xml);
      return;
    }

    let session = await getSession(from);

    const lower = norm(body);

    // comandos de menú / menu commands
    const isMenuCmd = ['inicio', 'menu', 'volver', 'start', 'back'].includes(lower);
    if (isMenuCmd || !body) {
      session = await saveSession({
        from_number: from,
        last_choice: null,
        awaiting_details: 0,
        details: null
      });
      const xml = buildTwiml(buildMainMenu());
      res.type('application/xml').send(xml);
      return;
    }

    // Si estamos esperando detalles, este mensaje son los detalles
    if (session.last_choice && session.awaiting_details) {
      session = await saveSession({
        from_number: from,
        details: body,
        awaiting_details: 0
      });
      const xml = buildTwiml(buildConfirmation(session.last_choice, body));
      res.type('application/xml').send(xml);
      return;
    }

    // Detectar servicio nuevo
    const choice = detectChoice(body);

    if (!choice) {
      // Texto raro → re-mostrar menú
      const xml = buildTwiml(buildMainMenu());
      res.type('application/xml').send(xml);
      return;
    }

    // Servicio reconocido → pedir detalles
    session = await saveSession({
      from_number: from,
      last_choice: choice,
      awaiting_details: 1,
      details: null
    });

    const prompt = buildServicePrompt(choice);
    const xml = buildTwiml(prompt);
    res.type('application/xml').send(xml);
  } catch (err) {
    console.error('Error in /webhook/whatsapp', err);
    const xml = buildTwiml(
      '❌ Error interno. Intenta de nuevo más tarde / Internal error. Please try again later.'
    );
    res.type('application/xml').send(xml);
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`💬 ${TAG} listening on http://localhost:${PORT}`);
});