// DestapesPR Bot 5 Pro 🇵🇷 – BILINGUAL (ES/EN)

import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();

// -----------------------------------------------------------------------------
// Configuración básica
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
const TAG = 'DestapesPR Bot 5 Pro 🇵🇷';
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

// -----------------------------------------------------------------------------
// SQLite: sesiones por número
// -----------------------------------------------------------------------------
let db = null;

async function getDB() {
  if (db) return db;

  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database,
  });

  // Crear tabla si no existe (estructura correcta)
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

  // Verificar si existe la columna "lang"
  const columns = await db.all(`PRAGMA table_info(sessions);`);
  const hasLang = columns.some((c) => c.name === 'lang');

  // Si la tabla es vieja (sin "lang"), la recreamos limpia
  if (!hasLang) {
    console.log("⚠️  Column 'lang' missing — rebuilding sessions table...");

    await db.exec(`DROP TABLE IF EXISTS sessions;`);

    await db.exec(`
      CREATE TABLE sessions (
        from_number TEXT PRIMARY KEY,
        lang TEXT DEFAULT 'es',
        last_choice TEXT,
        awaiting_details INTEGER DEFAULT 0,
        details TEXT,
        last_active INTEGER
      );
    `);

    console.log("✅ sessions table recreated with 'lang' column.");
  }

  // Limpiar sesiones viejas
  await db.run(
    'DELETE FROM sessions WHERE last_active < ?',
    Date.now() - SESSION_TTL_MS,
  );

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
      patch.awaiting_details ?? prev.awaiting_details ?? 0,
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

async function resetSession(from_number) {
  const dbi = await getDB();
  await dbi.run('DELETE FROM sessions WHERE from_number = ?', from_number);
}

// -----------------------------------------------------------------------------
// Utilidades de texto / idioma
// -----------------------------------------------------------------------------
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function detectLanguage(bodyRaw) {
  const s = normalize(bodyRaw);

  // Comandos explícitos
  if (s.includes('english')) return 'en';
  if (s.includes('espanol') || s.includes('español') || s.includes('spanish')) {
    return 'es';
  }

  // Heurística simple
  const hasSpanishWords = /(destape|fuga|fregadero|inodoro|banera|bañera|calentador|cita|servicio)/.test(
    s,
  );
  const hasEnglishWords = /(leak|clog|heater|appointment|service|schedule|bathroom|kitchen)/.test(
    s,
  );

  if (hasSpanishWords && !hasEnglishWords) return 'es';
  if (hasEnglishWords && !hasSpanishWords) return 'en';

  return 'es'; // por defecto español
}

// -----------------------------------------------------------------------------
// Textos del bot
// -----------------------------------------------------------------------------
const PHONE = '787-922-0068';
const FACEBOOK = 'https://www.facebook.com/destapesPR/';

const FOOTER_ES = `
✅ Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR

☎️ Teléfono directo: ${PHONE}
📘 Facebook: ${FACEBOOK}

🤖 DestapesPR Bot 5 Pro 🇵🇷`;

const FOOTER_EN = `
✅ We will contact you shortly.
Thank you for your business.
— DestapesPR

☎️ Direct phone: ${PHONE}
📘 Facebook: ${FACEBOOK}

🤖 DestapesPR Bot 5 Pro 🇵🇷`;

// 🔹 MENÚ PRINCIPAL – AHORA PRIMERO COMANDOS + FB (BILINGÜE)
function mainMenu(lang) {
  if (lang === 'en') {
    return `${TAG}

🔁 Commands / Comandos:
• "start", "menu" or "back" → main menu
• "inicio", "menu" o "volver" → menú principal
• To switch language / Cambiar idioma: type / escribe "english" o "español".

📘 Facebook: ${FACEBOOK}
☎️ Phone / Teléfono: ${PHONE}

🇵🇷 Welcome to DestapesPR (Puerto Rico).

Please type the number or the word of the service you need:

1️⃣ - Unclog / Drain cleaning
2️⃣ - Leak / Water leak
3️⃣ - Camera inspection
4️⃣ - Water heater (gas or electric)
5️⃣ - Other service
6️⃣ - Appointment / Schedule`;
  }

  return `${TAG}

🔁 Comandos / Commands:
• "inicio", "menu" o "volver" → menú principal
• "start", "menu" or "back" → main menu
• Cambiar idioma / To switch language: escribe / type "english" o "español".

📘 Facebook: ${FACEBOOK}
☎️ Teléfono: ${PHONE}

🇵🇷 Bienvenido a DestapesPR (Puerto Rico).

Escribe el número o la palabra del servicio que necesitas:

1️⃣ - Destape (drenajes o tuberías tapadas)
2️⃣ - Fuga (fugas de agua)
3️⃣ - Cámara (inspección con cámara)
4️⃣ - Calentador (gas o eléctrico)
5️⃣ - Otro servicio
6️⃣ - Cita / Appointment`;
}

function askDetails(lang, serviceKey) {
  const es = {
    destape: `Vamos a coordinar tu servicio de *destape*.

Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Municipio o sector
📝 Breve descripción (ej. "fregadero tapado", "inodoro no baja", "línea principal")`,
    fuga: `Vamos a coordinar tu servicio de *fuga de agua*.

Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Municipio o sector
📝 Dónde ves la fuga o humedad (ej. pared, techo, patio, baño)`,
    camara: `Vamos a coordinar tu servicio de *inspección con cámara*.

Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Municipio o sector
📝 Dónde necesitas la cámara (baño, cocina, línea principal, etc.)`,
    calentador: `Vamos a coordinar tu servicio de *calentador*.

Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Municipio o sector
📝 Tipo de calentador (gas o eléctrico) y problema que notas`,
    otro: `Vamos a coordinar tu servicio.

Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Municipio o sector
📝 Breve descripción del servicio que necesitas`,
    cita: `Vamos a coordinar tu cita.

Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Municipio o sector
📝 Servicio que necesitas`,
  };

  const en = {
    destape: `Let's coordinate your *drain unclog* service.

Please send in a single message:
👤 Full name
📞 Contact number (787/939 or U.S.)
📍 City / area
📝 Short description (e.g. "kitchen sink clogged", "toilet not flushing", "main line")`,
    fuga: `Let's coordinate your *water leak* service.

Please send in a single message:
👤 Full name
📞 Contact number (787/939 or U.S.)
📍 City / area
📝 Where you see the leak or moisture (wall, ceiling, yard, bathroom, etc.)`,
    camara: `Let's coordinate your *camera inspection*.

Please send in a single message:
👤 Full name
📞 Contact number (787/939 or U.S.)
📍 City / area
📝 Where you need the camera (bathroom, kitchen, main line, etc.)`,
    calentador: `Let's coordinate your *water heater* service.

Please send in a single message:
👤 Full name
📞 Contact number (787/939 or U.S.)
📍 City / area
📝 Type of heater (gas or electric) and the issue you notice`,
    otro: `Let's coordinate your service.

Please send in a single message:
👤 Full name
📞 Contact number (787/939 or U.S.)
📍 City / area
📝 Short description of the service you need`,
    cita: `Let's schedule your appointment.

Please send in a single message:
👤 Full name
📞 Contact number (787/939 or U.S.)
📍 City / area
📝 Service you need`,
  };

  const block = lang === 'en' ? en : es;

  return `${block[serviceKey]}

Ejemplo / Example:
"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero tapado"

(Escribe "menu" o "volver" / type "menu" or "back" to return to the menu.)`;
}

function confirmDetails(lang, serviceKey, bodyRaw) {
  const serviceLabelES = {
    destape: 'destape',
    fuga: 'fuga de agua',
    camara: 'inspección con cámara',
    calentador: 'calentador',
    otro: 'otro servicio',
    cita: 'cita',
  };

  const serviceLabelEN = {
    destape: 'unclog service',
    fuga: 'water leak service',
    camara: 'camera inspection',
    calentador: 'water heater service',
    otro: 'other service',
    cita: 'appointment',
  };

  if (lang === 'en') {
    return `✅ Received. I saved your details for *${serviceLabelEN[serviceKey] || 'service'}*:
"${bodyRaw}"

We will review your information and contact you soon.${FOOTER_EN}`;
  }

  return `✅ Recibido. Guardé tus datos para *${serviceLabelES[serviceKey] || 'servicio'}*:
"${bodyRaw}"

Estaremos revisando tu información y nos comunicaremos contigo en breve.${FOOTER_ES}`;
}

// -----------------------------------------------------------------------------
// Matching de opciones
// -----------------------------------------------------------------------------
const OPTION_KEYS = {
  '1': 'destape',
  '2': 'fuga',
  '3': 'camara',
  '4': 'calentador',
  '5': 'otro',
  '6': 'cita',
};

function detectChoice(bodyRaw) {
  const b = normalize(bodyRaw);

  if (OPTION_KEYS[b]) return OPTION_KEYS[b];

  if (/(destape|tapon|tapada|drenaje|desague|desagüe|fregadero|inodoro|sanitario|bañera|banera|principal|clog)/.test(
    b,
  )) {
    return 'destape';
  }

  if (/(fuga|goteo|salidero|humedad|filtracion|filtración|leak)/.test(b)) {
    return 'fuga';
  }

  if (/(camara|cámara|inspeccion|inspección|video|camera)/.test(b)) {
    return 'camara';
  }

  if (/(calentador|heater|boiler|agua caliente)/.test(b)) {
    return 'calentador';
  }

  if (/(cita|appointment|schedule)/.test(b)) {
    return 'cita';
  }

  if (/(otro|otros|other|service)/.test(b)) {
    return 'otro';
  }

  return null;
}

// -----------------------------------------------------------------------------
// Twilio helper
// -----------------------------------------------------------------------------
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml; charset=utf-8');
  return res.status(200).send(xml);
}

// -----------------------------------------------------------------------------
// Rutas de diagnóstico
// -----------------------------------------------------------------------------
app.get('/__version', (_req, res) => {
  res.json({
    ok: true,
    tag: TAG,
    tz: 'America/Puerto_Rico',
  });
});

app.get('/', (_req, res) => {
  res.send(`${TAG} – online ✅`);
});

// -----------------------------------------------------------------------------
// Webhook principal de WhatsApp
// -----------------------------------------------------------------------------
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await getDB();

    const from =
      req.body.From ||
      req.body.from ||
      req.body.WaId ||
      req.body.waId ||
      '';
    const bodyRaw =
      req.body.Body ||
      req.body.body ||
      '';

    const fromStr = String(from);
    const bodyStr = String(bodyRaw);
    const bodyNorm = normalize(bodyStr);

    let session = (await getSession(fromStr)) || {
      from_number: fromStr,
      lang: 'es',
      last_choice: null,
      awaiting_details: 0,
      details: null,
    };

    // 1) Cambios de idioma explícitos
    let lang = session.lang || 'es';
    const langDetectedCmd = detectLanguage(bodyStr);

    if (bodyNorm.includes('english')) {
      lang = 'en';
    } else if (bodyNorm.includes('espanol') || bodyNorm.includes('español') || bodyNorm.includes('spanish')) {
      lang = 'es';
    } else if (!session.lang) {
      lang = langDetectedCmd || 'es';
    }

    session = await saveSession(fromStr, { lang });

    // 2) Comandos de menú (en ambos idiomas)
    const isMenuCmd = [
      'menu',
      'inicio',
      'volver',
      'start',
      'back',
      'menú',
    ].includes(bodyNorm);

    if (!bodyNorm || isMenuCmd) {
      await saveSession(fromStr, {
        last_choice: null,
        awaiting_details: 0,
        details: null,
      });
      return sendTwilioXML(res, mainMenu(lang));
    }

    // 3) Si el usuario solo escribió "english" o "español"
    if (
      bodyNorm === 'english' ||
      bodyNorm === 'espanol' ||
      bodyNorm === 'español' ||
      bodyNorm === 'spanish'
    ) {
      const newLang =
        bodyNorm === 'english' ? 'en' : 'es';

      session = await saveSession(fromStr, { lang: newLang });

      const msg =
        newLang === 'en'
          ? `✅ Language changed to *English*.

${mainMenu('en')}`
          : `✅ Idioma cambiado a *español*.

${mainMenu('es')}`;

      return sendTwilioXML(res, msg);
    }

    // 4) Si estamos esperando detalles de un servicio
    if (session.last_choice && session.awaiting_details) {
      await saveSession(fromStr, {
        details: bodyStr,
        awaiting_details: 0,
      });

      const reply = confirmDetails(lang, session.last_choice, bodyStr);
      return sendTwilioXML(res, reply);
    }

    // 5) Detectar elección de servicio
    const choice = detectChoice(bodyStr);

    if (choice) {
      await saveSession(fromStr, {
        last_choice: choice,
        awaiting_details: 1,
        details: null,
      });

      const reply = askDetails(lang, choice);
      return sendTwilioXML(res, reply);
    }

    // 6) Fallback: reenviar menú
    const fallback =
      lang === 'en'
        ? `I didn't understand your message.

Please choose an option from the menu or type "menu" to see it again.`
        : `No entendí tu mensaje.

Por favor escoge una opción del menú o escribe "menu" para verlo nuevamente.`;

    return sendTwilioXML(res, `${fallback}\n\n${mainMenu(lang)}`);
  } catch (err) {
    console.error('Error in /webhook/whatsapp', err);
    const fallback =
      'Ocurrió un error temporal. Intenta de nuevo en unos momentos.';
    return sendTwilioXML(res, fallback);
  }
});

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`${TAG} listening on http://localhost:${PORT}`);
});