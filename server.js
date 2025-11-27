// DestapesPR Bot 5 Pro 🇵🇷 – BILINGUAL

import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();

// ----- CONFIG BÁSICA -----
const TAG = 'DestapesPR Bot 5 Pro 🇵🇷';
const TZ = 'America/Puerto_Rico';
const PORT = process.env.PORT || 10000;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas
const FACEBOOK_URL = 'https://www.facebook.com/destapesPR/';
const PHONE_DISPLAY = '787-922-0068';

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

// ----- SQLITE -----
sqlite3.verbose();
let db;

async function getDB() {
  if (db) return db;
  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number   TEXT PRIMARY KEY,
      lang          TEXT DEFAULT 'es',
      last_choice   TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details       TEXT,
      last_active   INTEGER
    );
  `);
  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);
  return db;
}

async function getSession(from_number) {
  const dbi = await getDB();
  return dbi.get('SELECT * FROM sessions WHERE from_number = ?', from_number);
}

async function saveSession(from_number, patch) {
  const dbi = await getDB();
  const prev = (await getSession(from_number)) || {};
  const now = Date.now();
  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details:
      patch.awaiting_details !== undefined
        ? patch.awaiting_details
        : prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    last_active: now,
  };

  await dbi.run(
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
      from_number,
      next.lang,
      next.last_choice,
      next.awaiting_details,
      next.details,
      next.last_active,
    ],
  );

  return next;
}

async function clearSession(from_number) {
  const dbi = await getDB();
  await dbi.run('DELETE FROM sessions WHERE from_number = ?', from_number);
}

// ----- UTILIDAD: normalizar texto -----
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Detección MUY simple de idioma
function detectLang(bodyNorm) {
  if (!bodyNorm) return 'es';
  const hasEnglishWords = /\b(hello|hi|good morning|good afternoon|good evening|toilet|sink|clog|drain|appointment|schedule)\b/.test(
    bodyNorm,
  );
  const hasSpanishWords = /\b(hola|buenas|inodoro|fregadero|destape|tapon|tapon|tuberia|cita|servicio)\b/.test(
    bodyNorm,
  );
  if (hasEnglishWords && !hasSpanishWords) return 'en';
  if (hasSpanishWords && !hasEnglishWords) return 'es';
  return 'es';
}

// ----- TEXTOS: MENÚS Y RESPUESTAS -----

const COMMANDS_LINE_ES =
  'Comandos: escribe "inicio", "menu" o "volver" para regresar al menú.\nPara cambiar el idioma, escribe "english" o "español".';
const COMMANDS_LINE_EN =
  'Commands: type "start", "menu" or "back" to return to the menu.\nTo switch language, type "english" or "español".';

const FOOTER_ES = `📞 Teléfono directo: ${PHONE_DISPLAY}
📘 Más info y fotos: ${FACEBOOK_URL}

${COMMANDS_LINE_ES}

DestapesPR Bot 5 Pro 🇵🇷`;
const FOOTER_EN = `📞 Direct phone: ${PHONE_DISPLAY}
📘 More info & photos: ${FACEBOOK_URL}

${COMMANDS_LINE_EN}

DestapesPR Bot 5 Pro 🇵🇷`;

// Menú principal según idioma
function buildMainMenu(lang) {
  if (lang === 'en') {
    return [
      '👋 Welcome to DestapesPR!',
      '',
      'Please type the number or word of the service you need:',
      '',
      '1️⃣ Clog / Drain cleaning',
      '2️⃣ Leak (water leaks)',
      '3️⃣ Camera inspection',
      '4️⃣ Water heater (gas or electric)',
      '5️⃣ Other service',
      '6️⃣ Appointment / Schedule',
      '',
      FOOTER_EN,
    ].join('\n');
  }

  // Español por defecto
  return [
    '👋 Bienvenido a DestapesPR.',
    '',
    'Escribe el número o la palabra del servicio que necesitas:',
    '',
    '1️⃣ Destape (drenajes o tuberías tapadas)',
    '2️⃣ Fuga (fugas de agua)',
    '3️⃣ Cámara (inspección con cámara)',
    '4️⃣ Calentador (gas o eléctrico)',
    '5️⃣ Otro servicio',
    '6️⃣ Cita / Schedule',
    '',
    FOOTER_ES,
  ].join('\n');
}

function buildServicePrompt(choice, lang) {
  const isEn = lang === 'en';

  if (choice === 'destape') {
    return isEn
      ? [
          '🚿 Clog / Drain service selected.',
          '',
          'Tell me in one message:',
          '👤 Full name',
          '📞 Contact number (787/939 or US)',
          '📍 Area (city/sector)',
          '📝 What is clogged? (toilet, sink, main line, etc.)',
          '',
          'Example:',
          `"My name is Ana Rivera, 939-555-9999, clogged toilet in Caguas"`,
          '',
          FOOTER_EN,
        ].join('\n')
      : [
          '🚿 Servicio de destape seleccionado.',
          '',
          'Envíame en un solo mensaje:',
          '👤 Nombre completo',
          '📞 Número de contacto (787/939 o EE.UU.)',
          '📍 Zona (municipio/sector)',
          '📝 Qué está tapado (inodoro, fregadero, línea principal, etc.)',
          '',
          'Ejemplo:',
          `"Me llamo Ana Rivera, 939-555-9999, inodoro tapado en Caguas"`,
          '',
          FOOTER_ES,
        ].join('\n');
  }

  if (choice === 'fuga') {
    return isEn
      ? [
          '💧 Leak service selected.',
          '',
          'Tell me in one message:',
          '👤 Full name',
          '📞 Contact number (787/939 or US)',
          '📍 Area (city/sector)',
          '📝 Where do you see the leak or dampness? (bathroom, kitchen, ceiling, exterior, etc.)',
          '',
          'Example:',
          `"My name is Carlos López, 787-555-0000, leak in bathroom ceiling in Bayamón"`,
          '',
          FOOTER_EN,
        ].join('\n')
      : [
          '💧 Servicio de fuga seleccionado.',
          '',
          'Envíame en un solo mensaje:',
          '👤 Nombre completo',
          '📞 Número de contacto (787/939 o EE.UU.)',
          '📍 Zona (municipio/sector)',
          '📝 Dónde ves la fuga o humedad (baño, cocina, techo, exterior, etc.)',
          '',
          'Ejemplo:',
          `"Me llamo Carlos López, 787-555-0000, fuga en techo de baño en Bayamón"`,
          '',
          FOOTER_ES,
        ].join('\n');
  }

  if (choice === 'camara') {
    return isEn
      ? [
          '📹 Camera inspection service selected.',
          '',
          'Tell me in one message:',
          '👤 Full name',
          '📞 Contact number (787/939 or US)',
          '📍 Area (city/sector)',
          '📝 Where do you need the inspection? (bathroom, kitchen, main line, etc.)',
          '',
          'Example:',
          `"My name is Luis Pérez, 939-555-1111, camera inspection in main line of house in Ponce"`,
          '',
          FOOTER_EN,
        ].join('\n')
      : [
          '📹 Servicio de inspección con cámara seleccionado.',
          '',
          'Envíame en un solo mensaje:',
          '👤 Nombre completo',
          '📞 Número de contacto (787/939 o EE.UU.)',
          '📍 Zona (municipio/sector)',
          '📝 Dónde necesitas la inspección (baño, cocina, línea principal, etc.)',
          '',
          'Ejemplo:',
          `"Me llamo Luis Pérez, 939-555-1111, inspección con cámara en línea principal de la casa en Ponce"`,
          '',
          FOOTER_ES,
        ].join('\n');
  }

  if (choice === 'calentador') {
    return isEn
      ? [
          '🔥 Water heater service selected.',
          '',
          'Tell me in one message:',
          '👤 Full name',
          '📞 Contact number (787/939 or US)',
          '📍 Area (city/sector)',
          '📝 Type of heater (gas or electric) and what is happening (no hot water, leaks, etc.)',
          '',
          'Example:',
          `"My name is José Torres, 787-555-2222, electric heater, no hot water, in Cayey"`,
          '',
          FOOTER_EN,
        ].join('\n')
      : [
          '🔥 Servicio de calentador seleccionado.',
          '',
          'Envíame en un solo mensaje:',
          '👤 Nombre completo',
          '📞 Número de contacto (787/939 o EE.UU.)',
          '📍 Zona (municipio/sector)',
          '📝 Tipo de calentador (gas o eléctrico) y qué está pasando (no calienta, fuga, etc.)',
          '',
          'Ejemplo:',
          `"Me llamo José Torres, 787-555-2222, calentador eléctrico, no calienta, en Cayey"`,
          '',
          FOOTER_ES,
        ].join('\n');
  }

  if (choice === 'otro') {
    return isEn
      ? [
          '🛠 Other plumbing service selected.',
          '',
          'Tell me in one message:',
          '👤 Full name',
          '📞 Contact number (787/939 or US)',
          '📍 Area (city/sector)',
          '📝 Brief description of the service you need',
          '',
          'Example:',
          `"My name is Marta Díaz, 939-555-3333, need quote for new bathroom installation in Cidra"`,
          '',
          FOOTER_EN,
        ].join('\n')
      : [
          '🛠 Otro servicio seleccionado.',
          '',
          'Envíame en un solo mensaje:',
          '👤 Nombre completo',
          '📞 Número de contacto (787/939 o EE.UU.)',
          '📍 Zona (municipio/sector)',
          '📝 Descripción breve del servicio que necesitas',
          '',
          'Ejemplo:',
          `"Me llamo Marta Díaz, 939-555-3333, necesito cotización para instalación de baño nuevo en Cidra"`,
          '',
          FOOTER_ES,
        ].join('\n');
  }

  if (choice === 'cita') {
    return isEn
      ? [
          '📅 Appointment / Schedule selected.',
          '',
          'Tell me in one message:',
          '👤 Full name',
          '📞 Contact number (787/939 or US)',
          '📍 Area (city/sector)',
          '📝 Service you need (clog, leak, camera, heater, other)',
          '',
          'Example:',
          `"My name is Ana Rivera, 939-555-9999, clog in kitchen sink in Caguas"`,
          '',
          FOOTER_EN,
        ].join('\n')
      : [
          '📅 Opción de cita seleccionada.',
          '',
          'Envíame en un solo mensaje:',
          '👤 Nombre completo',
          '📞 Número de contacto (787/939 o EE.UU.)',
          '📍 Zona (municipio/sector)',
          '📝 Servicio que necesitas (destape, fuga, cámara, calentador, otro)',
          '',
          'Ejemplo:',
          `"Me llamo Ana Rivera, 939-555-9999, destape de fregadero de cocina en Caguas"`,
          '',
          FOOTER_ES,
        ].join('\n');
  }

  return buildMainMenu(lang);
}

function buildConfirmMessage(lang, choice, detailsText) {
  const isEn = lang === 'en';
  const choiceLabel =
    choice === 'destape'
      ? isEn
        ? 'clog / drain'
        : 'destape'
      : choice === 'fuga'
      ? isEn
        ? 'leak'
        : 'fuga'
      : choice === 'camara'
      ? isEn
        ? 'camera inspection'
        : 'inspección con cámara'
      : choice === 'calentador'
      ? isEn
        ? 'water heater'
        : 'calentador'
      : choice === 'otro'
      ? isEn
        ? 'other service'
        : 'otro servicio'
      : choice === 'cita'
      ? isEn
        ? 'appointment'
        : 'cita'
      : '';

  const header = isEn ? '✅ Received. I saved your details:' : '✅ Recibido. Guardé tus datos:';
  const serviceLine = choiceLabel
    ? isEn
      ? `Service: ${choiceLabel}`
      : `Servicio: ${choiceLabel}`
    : '';

  const thanksLines = isEn
    ? [
        '',
        '✅ We will contact you shortly.',
        'Thank you for your business.',
        '— DestapesPR',
      ]
    : [
        '',
        '✅ Próximamente nos estaremos comunicando.',
        'Gracias por su patrocinio.',
        '— DestapesPR',
      ];

  const commandsAndFooter = isEn ? FOOTER_EN : FOOTER_ES;

  return [
    header,
    `"${detailsText}"`,
    serviceLine ? '\n' + serviceLine : '',
    ...thanksLines,
    '',
    commandsAndFooter,
  ]
    .filter(Boolean)
    .join('\n');
}

// ----- MATCHING OPCIONES -----
function detectChoice(bodyNorm) {
  if (!bodyNorm) return null;
  if (['1', '1️⃣', 'uno'].includes(bodyNorm)) return 'destape';
  if (['2', '2️⃣', 'dos'].includes(bodyNorm)) return 'fuga';
  if (['3', '3️⃣', 'tres'].includes(bodyNorm)) return 'camara';
  if (['4', '4️⃣', 'cuatro'].includes(bodyNorm)) return 'calentador';
  if (['5', '5️⃣', 'cinco'].includes(bodyNorm)) return 'otro';
  if (['6', '6️⃣', 'seis', 'cita', 'schedule', 'appointment'].includes(bodyNorm)) return 'cita';

  if (bodyNorm.includes('destape') || bodyNorm.includes('tap')) return 'destape';
  if (bodyNorm.includes('fuga') || bodyNorm.includes('leak')) return 'fuga';
  if (bodyNorm.includes('camara') || bodyNorm.includes('camera')) return 'camara';
  if (bodyNorm.includes('calentador') || bodyNorm.includes('heater')) return 'calentador';
  if (bodyNorm.includes('cita') || bodyNorm.includes('schedule') || bodyNorm.includes('appointment'))
    return 'cita';

  if (bodyNorm.includes('otro') || bodyNorm.includes('other')) return 'otro';

  return null;
}

// ----- RESPUESTA TWILIO XML -----
function sendTwilioXML(res, text) {
  const safe = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  return res.status(200).send(xml);
}

// ----- ENDPOINTS DE DIAGNÓSTICO -----
app.get('/__version', (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: TZ });
});

app.get('/health', async (_req, res) => {
  try {
    await getDB();
    res.json({ ok: true, tag: TAG, tz: TZ });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'db_error' });
  }
});

// ----- WEBHOOK WHATSAPP (TWILIO) -----
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await getDB();

    const from =
      (req.body.From || req.body.from || req.body.WaId || '').toString().trim() || 'unknown';
    const bodyRaw = (req.body.Body || req.body.body || '').toString();
    const bodyNorm = normalize(bodyRaw);

    let session = (await getSession(from)) || { lang: 'es' };
    let lang = session.lang || 'es';

    // Cambio de idioma directo
    if (bodyNorm === 'english') {
      lang = 'en';
      session = await saveSession(from, { lang, awaiting_details: 0, last_choice: null });
      const msg = [
        '🌐 Language changed to English.',
        '',
        buildMainMenu(lang),
      ].join('\n');
      return sendTwilioXML(res, msg);
    }
    if (bodyNorm === 'espanol' || bodyNorm === 'español' || bodyNorm === 'spanish') {
      lang = 'es';
      session = await saveSession(from, { lang, awaiting_details: 0, last_choice: null });
      const msg = [
        '🌐 Idioma cambiado a español.',
        '',
        buildMainMenu(lang),
      ].join('\n');
      return sendTwilioXML(res, msg);
    }

    // Comandos de menú
    if (
      ['inicio', 'menu', 'volver'].includes(bodyNorm) ||
      ['start', 'menu', 'back'].includes(bodyNorm)
    ) {
      const autoLang = detectLang(bodyNorm);
      lang = autoLang || lang || 'es';
      await saveSession(from, { lang, awaiting_details: 0, last_choice: null, details: null });
      const menuText = buildMainMenu(lang);
      return sendTwilioXML(res, menuText);
    }

    // Si está esperando detalles
    if (session.last_choice && session.awaiting_details) {
      const confirmMsg = buildConfirmMessage(lang, session.last_choice, bodyRaw);
      await saveSession(from, {
        details: bodyRaw,
        awaiting_details: 0,
      });
      return sendTwilioXML(res, confirmMsg);
    }

    // Intentar detectar elección de servicio
    const choice = detectChoice(bodyNorm);
    if (choice) {
      // Ajustar idioma según contenido si no está claro
      const autoLang = detectLang(bodyNorm);
      lang = autoLang || lang || 'es';

      await saveSession(from, {
        lang,
        last_choice: choice,
        awaiting_details: 1,
        details: null,
      });

      const prompt = buildServicePrompt(choice, lang);
      return sendTwilioXML(res, prompt);
    }

    // Nada coincidió: mandar menú + explicación
    const autoLang = detectLang(bodyNorm);
    lang = autoLang || lang || 'es';

    const unknownEs = [
      'No entendí tu mensaje. Vamos a empezar desde el menú 👇',
      '',
      buildMainMenu('es'),
    ].join('\n');
    const unknownEn = [
      "I didn't understand your message. Let's start from the menu 👇",
      '',
      buildMainMenu('en'),
    ].join('\n');

    const reply = lang === 'en' ? unknownEn : unknownEs;
    await saveSession(from, {
      lang,
      last_choice: null,
      awaiting_details: 0,
      details: null,
    });

    return sendTwilioXML(res, reply);
  } catch (err) {
    console.error('Error in /webhook/whatsapp', err);
    const fallback =
      'Lo siento, hubo un error interno. Intenta de nuevo en unos minutos.\nSorry, there was an internal error. Please try again in a few minutes.';
    return sendTwilioXML(res, fallback);
  }
});

// ----- ROOT -----
app.get('/', (_req, res) => {
  res.send(`${TAG} activo en ${TZ}`);
});

// ----- START -----
app.listen(PORT, () => {
  console.log(`💬 ${TAG} listening on http://localhost:${PORT}`);
});