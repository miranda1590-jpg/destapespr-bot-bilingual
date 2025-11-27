// server.js - DestapesPR Bot 5 Pro 🇵🇷 (Bilingüe Formato A)

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
const FB_LINK = 'https://www.facebook.com/destapesPR/';
const PHONE = '787-922-0068';
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h

// =========================
//   SQLITE: SESIONES
// =========================
let db;

async function initDB() {
  if (db) return db;
  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database
  });

  // Crear tabla si no existe (versión nueva con lang)
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

  // Migración suave: asegurarnos de que tenga columna lang
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const hasLang = cols.some(c => c.name === 'lang');
  if (!hasLang) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es';`);
  }

  // Limpiar sesiones viejas
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
    [from, next.lang, next.last_choice, next.awaiting_details, next.details, next.last_active]
  );

  return next;
}

async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// =========================
//   TEXTOS BILINGÜES
// =========================

function mainMenuText() {
  return (
    `${TAG}\n\n` +
    `Bienvenido(a) a DestapesPR / Welcome to DestapesPR 👋\n\n` +
    `📝 Puedes escribir directamente el servicio que necesitas en español o inglés.\n` +
    `You can type the service you need in Spanish or English.\n` +
    `Ejemplos / Examples: "destape", "fuga", "camera inspection", "water heater".\n\n` +
    `Menú de servicios / Service menu:\n` +
    `1️⃣ Destape (drenajes tapados) / Drain cleaning (clogs)\n` +
    `2️⃣ Fuga de agua / Water leak\n` +
    `3️⃣ Inspección con cámara / Camera inspection\n` +
    `4️⃣ Calentador de agua / Water heater\n` +
    `5️⃣ Otro servicio / Other service\n` +
    `6️⃣ Cita / Schedule appointment\n\n` +
    `Comandos / Commands:\n` +
    `- "inicio", "menu", "volver" → mostrar el menú\n` +
    `- "start", "menu", "back" → show the menu\n\n` +
    `Facebook: ${FB_LINK}\n` +
    `📞 Teléfono directo / Direct phone: ${PHONE}\n\n` +
    `🤖 DestapesPR Bot 5 Pro Bilingual`
  );
}

const SERVICE_LABELS = {
  destape: 'Destape / Drain cleaning',
  fuga: 'Fuga de agua / Water leak',
  camara: 'Inspección con cámara / Camera inspection',
  calentador: 'Calentador de agua / Water heater',
  otro: 'Otro servicio / Other service',
  cita: 'Cita / Schedule appointment'
};

function servicePrompt(choice) {
  switch (choice) {
    case 'destape':
      return (
        `🌀 Destape / Drain cleaning\n\n` +
        `Por favor describe brevemente el problema:\n` +
        `Please briefly describe the problem:\n\n` +
        `• Zona (municipio o sector) / Area (city or neighborhood)\n` +
        `• Drenaje afectado (fregadero, inodoro, ducha, principal, etc.) / Affected drain (sink, toilet, shower, main line, etc.)\n` +
        `• Tipo de propiedad (casa, apartamento, negocio, Airbnb, etc.) / Property type (house, apartment, business, Airbnb, etc.)\n\n` +
        `Luego envía en un solo mensaje / Then send in a single message:\n` +
        `👤 Nombre completo / Full name\n` +
        `📞 Número de contacto (787/939 o EE.UU.) / Contact number (787/939 or US)\n` +
        `📍 Pueblo o área / City or area\n\n` +
        `Ejemplo / Example:\n` +
        `"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n` +
        `"My name is Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"\n\n` +
        `Cuando envíes tu mensaje, guardaremos tus datos y nos pondremos en contacto contigo.\n` +
        `Once you send your message, we will save your details and contact you.\n\n` +
        `Comandos / Commands: "inicio" / "start", "menu", "volver" / "back".`
      );
    case 'fuga':
      return (
        `💧 Fuga de agua / Water leak\n\n` +
        `Describe dónde ves la fuga o humedad:\n` +
        `Describe where you see the leak or moisture:\n\n` +
        `• Área (baño, cocina, patio, techo, etc.) / Area (bathroom, kitchen, patio, roof, etc.)\n` +
        `• Si es visible o está oculta / If it is visible or hidden\n` +
        `• Hace cuánto tiempo notas el problema / How long you’ve noticed it\n\n` +
        `Luego envía en un solo mensaje / Then send in a single message:\n` +
        `👤 Nombre completo / Full name\n` +
        `📞 Número de contacto (787/939 o EE.UU.) / Contact number (787/939 or US)\n` +
        `📍 Pueblo o área / City or area\n\n` +
        `Ejemplo / Example:\n` +
        `"Me llamo Luis, 787-123-4567, San Juan, fuga visible en la cocina debajo del fregadero"\n` +
        `"My name is Luis, 787-123-4567, San Juan, visible leak under the kitchen sink"\n\n` +
        `Comandos / Commands: "inicio" / "start", "menu", "volver" / "back".`
      );
    case 'camara':
      return (
        `📹 Inspección con cámara / Camera inspection\n\n` +
        `Cuéntanos dónde necesitas la inspección:\n` +
        `Tell us where you need the inspection:\n\n` +
        `• Área (baño, cocina, línea principal, etc.) / Area (bathroom, kitchen, main line, etc.)\n` +
        `• Motivo (tapas recurrentes, malos olores, filtraciones, etc.) / Reason (recurring clogs, bad odors, leaks, etc.)\n\n` +
        `Luego envía en un solo mensaje / Then send in a single message:\n` +
        `👤 Nombre completo / Full name\n` +
        `📞 Número de contacto (787/939 o EE.UU.) / Contact number (787/939 or US)\n` +
        `📍 Pueblo o área / City or area\n\n` +
        `Ejemplo / Example:\n` +
        `"Soy Carlos, 939-000-1111, Bayamón, inspección con cámara en línea principal por tapas constantes"\n` +
        `"I’m Carlos, 939-000-1111, Bayamón, camera inspection on main line due to constant clogs"\n\n` +
        `Comandos / Commands: "inicio" / "start", "menu", "volver" / "back".`
      );
    case 'calentador':
      return (
        `🔥 Calentador de agua / Water heater\n\n` +
        `Por favor detalla tu calentador y el problema:\n` +
        `Please describe your heater and the issue:\n\n` +
        `• Tipo (gas o eléctrico) / Type (gas or electric)\n` +
        `• Marca aproximada si la conoces / Brand if known\n` +
        `• Síntoma (no calienta, prende y se apaga, fuga, etc.) / Symptom (no hot water, turns off, leak, etc.)\n\n` +
        `Luego envía en un solo mensaje / Then send in a single message:\n` +
        `👤 Nombre completo / Full name\n` +
        `📞 Número de contacto (787/939 o EE.UU.) / Contact number (787/939 or US)\n` +
        `📍 Pueblo o área / City or area\n\n` +
        `Ejemplo / Example:\n` +
        `"Me llamo Brenda, 787-555-8888, Cidra, calentador eléctrico no calienta"\n` +
        `"My name is Brenda, 787-555-8888, Cidra, electric water heater not heating"\n\n` +
        `Comandos / Commands: "inicio" / "start", "menu", "volver" / "back".`
      );
    case 'otro':
      return (
        `🛠️ Otro servicio / Other service\n\n` +
        `Cuéntanos qué necesitas:\n` +
        `Tell us what you need:\n\n` +
        `Por ejemplo / For example:\n` +
        `• Instalación o reparación de sanitario / Toilet installation or repair\n` +
        `• Línea sanitaria / Sewer line\n` +
        `• Bomba, cisterna, etc. / Pump, cistern, etc.\n\n` +
        `Luego envía en un solo mensaje / Then send in a single message:\n` +
        `👤 Nombre completo / Full name\n` +
        `📞 Número de contacto (787/939 o EE.UU.) / Contact number (787/939 or US)\n` +
        `📍 Pueblo o área / City or area\n\n` +
        `Ejemplo / Example:\n` +
        `"Soy Juan, 787-000-2222, Guaynabo, necesito cotización para instalación de inodoro nuevo"\n` +
        `"I’m Juan, 787-000-2222, Guaynabo, need a quote to install a new toilet"\n\n` +
        `Comandos / Commands: "inicio" / "start", "menu", "volver" / "back".`
      );
    case 'cita':
      return (
        `📅 Cita / Schedule appointment\n\n` +
        `Envía en un solo mensaje / Send in a single message:\n` +
        `👤 Nombre completo / Full name\n` +
        `📞 Número de contacto (787/939 o EE.UU.) / Contact number (787/939 or US)\n` +
        `📍 Pueblo o área / City or area\n` +
        `🛠️ Servicio que necesitas / Service you need\n` +
        `📆 Día(s) que te funcionan / Day(s) that work for you\n` +
        `⏰ Horario aproximado / Preferred time range\n\n` +
        `Ejemplo / Example:\n` +
        `"Me llamo Ana, 939-555-9999, Caguas, destape de fregadero, puedo lunes o martes por la mañana"\n` +
        `"My name is Ana, 939-555-9999, Caguas, kitchen sink clog, I’m available Monday or Tuesday morning"\n\n` +
        `Comandos / Commands: "inicio" / "start", "menu", "volver" / "back".`
      );
    default:
      return mainMenuText();
  }
}

function confirmationText(choice, userText) {
  const service = SERVICE_LABELS[choice] || 'Servicio / Service';

  return (
    `✅ Gracias, guardé tu información / Thank you, I saved your information.\n\n` +
    `Resumen / Summary:\n` +
    `Servicio / Service: ${service}\n` +
    `Detalles / Details:\n` +
    `"${userText}"\n\n` +
    `Próximamente nos estaremos comunicando. Gracias por su patrocinio.\n` +
    `We will contact you shortly. Thank you for your business.\n\n` +
    `📞 Teléfono directo / Direct phone: ${PHONE}\n` +
    `📎 Facebook: ${FB_LINK}\n\n` +
    `🤖 DestapesPR Bot 5 Pro Bilingual`
  );
}

// =========================
//   MATCHING DE OPCIONES
// =========================

function norm(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

const KEYWORDS = {
  destape: [
    'destape',
    'tapado',
    'tapada',
    'tapados',
    'tapadas',
    'tapon',
    'tapon',
    'obstruccion',
    'drain',
    'clog',
    'clogged',
    'drain cleaning',
    'destapar',
    'drenaje',
    'desague',
    'fregadero',
    'sink',
    'toilet',
    'inodoro'
  ],
  fuga: [
    'fuga',
    'fugas',
    'leak',
    'leakage',
    'leaking',
    'salidero',
    'goteo',
    'goteando',
    'humedad',
    'moisture'
  ],
  camara: [
    'camara',
    'cámara',
    'camera inspection',
    'camera',
    'video inspection',
    'inspeccion',
    'inspección',
    'ver tuberia',
    'ver tuberia',
    'line inspection'
  ],
  calentador: [
    'calentador',
    'water heater',
    'heater',
    'boiler',
    'agua caliente',
    'hot water',
    'no calienta',
    'no hot water'
  ],
  otro: [
    'otro',
    'servicio',
    'other',
    'another',
    'plomeria',
    'plumbing'
  ],
  cita: [
    'cita',
    'appointment',
    'schedule',
    'agendar',
    'reservar',
    'booking'
  ]
};

const OPTION_BY_NUMBER = {
  '1': 'destape',
  '2': 'fuga',
  '3': 'camara',
  '4': 'calentador',
  '5': 'otro',
  '6': 'cita'
};

function detectChoice(raw) {
  const n = norm(raw);

  // Si solamente es número 1-6
  if (OPTION_BY_NUMBER[n]) return OPTION_BY_NUMBER[n];

  // Revisar keywords por idioma/servicio
  for (const [choice, arr] of Object.entries(KEYWORDS)) {
    if (arr.some(k => n.includes(k))) {
      return choice;
    }
  }

  return null;
}

// =========================
//   UTILIDADES RESPUESTA
// =========================

function buildTwilioXML(text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

function isTwilio(req) {
  return typeof req.body.Body === 'string' || typeof req.body.WaId === 'string';
}

// =========================
//   RUTAS
// =========================

app.get('/', (_req, res) => {
  res.send(`${TAG} activo / active ✅`);
});

app.get('/__version', (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: 'America/Puerto_Rico' });
});

// WEBHOOK PRINCIPAL
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from =
      req.body.From ||
      req.body.from ||
      req.body.WaId ||
      '';
    const bodyRaw = (req.body.Body || req.body.body || '').toString();
    const body = norm(bodyRaw);

    // Comandos globales → siempre resetean al menú
    const isMenuCmd = ['inicio', 'menu', 'start', 'back', 'volver'].includes(body);
    if (!body || isMenuCmd) {
      await clearSession(from);
      const reply = mainMenuText();
      if (isTwilio(req)) {
        return res
          .status(200)
          .type('application/xml')
          .send(buildTwilioXML(reply));
      }
      return res.json({ ok: true, reply });
    }

    // Obtener sesión actual
    const session = await getSession(from);

    // 1) Si está esperando detalles → guardar y confirmar
    if (session && session.awaiting_details) {
      const choice = session.last_choice || detectChoice(bodyRaw) || 'otro';
      await saveSession(from, {
        details: bodyRaw,
        awaiting_details: 0
      });

      const reply = confirmationText(choice, bodyRaw);
      if (isTwilio(req)) {
        return res
          .status(200)
          .type('application/xml')
          .send(buildTwilioXML(reply));
      }
      return res.json({ ok: true, reply });
    }

    // 2) Detectar elección por número o palabra (ES/EN)
    const choice = detectChoice(bodyRaw);
    if (choice) {
      await saveSession(from, {
        last_choice: choice,
        awaiting_details: 1
      });

      const reply = servicePrompt(choice);
      if (isTwilio(req)) {
        return res
          .status(200)
          .type('application/xml')
          .send(buildTwilioXML(reply));
      }
      return res.json({ ok: true, reply });
    }

    // 3) Si no se entiende → mostrar menú bilingüe
    const fallback = (
      `No logré entender tu mensaje / I could not understand your message.\n\n` +
      mainMenuText()
    );

    if (isTwilio(req)) {
      return res
        .status(200)
        .type('application/xml')
        .send(buildTwilioXML(fallback));
    }

    return res.json({ ok: true, reply: fallback });
  } catch (err) {
    console.error('Error in /webhook/whatsapp', err);
    const msg =
      'Ocurrió un error procesando tu mensaje. / An error occurred while processing your message.';
    if (isTwilio(req)) {
      return res
        .status(200)
        .type('application/xml')
        .send(buildTwilioXML(msg));
    }
    return res.status(500).json({ ok: false, error: 'internal', msg });
  }
});

// =========================
//   INICIAR SERVIDOR
// =========================
app.listen(PORT, () => {
  console.log(`💬 ${TAG} listening on http://localhost:${PORT}`);
});