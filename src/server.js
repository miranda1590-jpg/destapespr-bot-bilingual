// server.js – DestapesPR Bot 5 Pro (bilingüe)

require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;
const TAG = 'DestapesPR Bot 5 Pro 🇵🇷';

// ================== CONFIG BÁSICA ==================
const DESTAPESPR_PHONE = '+17879220068';
const DESTAPESPR_PHONE_HUMAN = '787-922-0068';
const FACEBOOK_URL = 'https://www.facebook.com/destapesPR/';

// Footer ES / EN
const FOOTER_ES = `
✅ Próximamente nos estaremos comunicando.
🙏 Gracias por su patrocinio.
— DestapesPR

📞 Llámanos: ${DESTAPESPR_PHONE_HUMAN}
📘 Facebook: ${FACEBOOK_URL}
🤖 ${TAG}`;

const FOOTER_EN = `
✅ We will contact you shortly.
🙏 Thank you for your business.
— DestapesPR

📞 Call us: ${DESTAPESPR_PHONE}
📘 Facebook: ${FACEBOOK_URL}
🤖 ${TAG}`;

// Comandos (primero, bien visibles)
const COMMANDS_ES = `🧭 *Comandos*:
• Escribe *"inicio"* o *"menu"* para ver el menú.
• Escribe *"volver"* para regresar.
• Escribe *"english"* o *"español"* para cambiar de idioma.`;

const COMMANDS_EN = `🧭 *Commands*:
• Type *"start"* or *"menu"* to see the menu.
• Type *"back"* to go back.
• Type *"english"* or *"español"* to switch language.`;

// Menú principal ES / EN (números emoji)
function buildMainMenu(lang = 'es') {
  if (lang === 'en') {
    return (
`${TAG}

${COMMANDS_EN}

📋 *Main menu*:
1️⃣ Clog / drain cleaning
2️⃣ Leak (water leaks, damp spots)
3️⃣ Camera inspection
4️⃣ Water heater (gas or electric)
5️⃣ Other plumbing service
6️⃣ Appointment / Schedule

💡 Send the *number* or the *word* of the option you need.`
    );
  }

  // Español
  return (
`${TAG}

${COMMANDS_ES}

📋 *Menú principal*:
1️⃣ Destape (drenajes o tuberías tapadas)
2️⃣ Fuga (fugas de agua, humedad)
3️⃣ Cámara (inspección con cámara)
4️⃣ Calentador (gas o eléctrico)
5️⃣ Otro servicio de plomería
6️⃣ Cita / Schedule appointment

💡 Envía el *número* o la *palabra* de la opción que necesitas.`
  );
}

// Instrucciones para que el cliente envíe sus datos (sin disponibilidad/horario)
const DETAILS_PROMPT_ES = `
Por favor envía en un solo mensaje:
👤 *Nombre completo*
📞 *Número de contacto* (787/939 o EE.UU.)
📍 *Zona* (municipio/sector)
🛠️ *Breve descripción del problema*

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, Cayey, fregadero tapado"`;

const DETAILS_PROMPT_EN = `
Please send everything in *one message*:
👤 *Full name*
📞 *Contact number* (US/Puerto Rico)
📍 *Area* (city/neighborhood)
🛠️ *Short description of the issue*

Example:
"My name is Ana Rivera, +1 939-555-9999, Cayey, clogged kitchen sink"`;

// Servicios para mostrar en el resumen final
const SERVICE_LABEL = {
  es: {
    destape: 'destape',
    fuga: 'fuga',
    camara: 'inspección con cámara',
    calentador: 'calentador',
    otro: 'otro servicio',
    cita: 'cita / appointment'
  },
  en: {
    destape: 'clog / drain cleaning',
    fuga: 'leak',
    camara: 'camera inspection',
    calentador: 'water heater',
    otro: 'other service',
    cita: 'appointment'
  }
};

// ================== HELPERS TEXTO / IDIOMA ==================
function norm(str) {
  return (str || '')
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function detectLangFromText(text) {
  const t = norm(text);
  if (!t) return null;

  const hasEs = /(destape|fuga|camara|calentador|cita|hola|buenas|gracias|inodoro|fregadero|tuberia|tubería|baño)/.test(t);
  const hasEn = /(clog|leak|heater|appointment|hi|hello|thanks|toilet|sink|drain|plumbing)/.test(t);

  if (hasEs && !hasEn) return 'es';
  if (hasEn && !hasEs) return 'en';
  return null;
}

function isLangSwitch(textNorm) {
  if (!textNorm) return null;
  if (textNorm.includes('english') || textNorm.includes('ingles')) return 'en';
  if (textNorm.includes('espanol') || textNorm.includes('español') || textNorm.includes('spanish')) return 'es';
  return null;
}

function isMenuCommand(textNorm) {
  if (!textNorm) return null;
  if (['inicio', 'menu', 'menú'].includes(textNorm)) return 'menu';
  if (['volver', 'atras', 'atrás'].includes(textNorm)) return 'back';
  if (['start', 'menu', 'main menu'].includes(textNorm)) return 'menu';
  if (['back'].includes(textNorm)) return 'back';
  return null;
}

// ================== MATCH SERVICIOS ==================
const KEYWORDS = {
  destape: [
    'destape', 'tapon', 'tapones', 'tapada', 'trancada', 'obstruccion', 'obstrucciones',
    'clog', 'clogged', 'blocked', 'blockage',
    'drenaje', 'desague', 'desagüe', 'drain',
    'fregadero', 'sink', 'lavaplatos',
    'inodoro', 'toilet', 'sanitario',
    'ducha', 'shower', 'lavamanos', 'lavabo',
    'banera', 'bañera', 'tina',
    'principal', 'linea principal', 'main line'
  ],
  fuga: [
    'fuga', 'fugas', 'salidero', 'goteo', 'goteando',
    'humedad', 'mojado', 'filtracion', 'filtración',
    'leak', 'leaking', 'leaks',
    'damp', 'wet', 'water stain', 'water stains'
  ],
  camara: [
    'camara', 'cámara', 'inspeccion', 'inspección',
    'video inspeccion', 'video inspección', 'endoscopia',
    'ver tuberia', 'ver tubería', 'camera', 'inspection', 'scope'
  ],
  calentador: [
    'calentador', 'boiler', 'heater',
    'agua caliente', 'hot water',
    'termo', 'termotanque',
    'gas', 'electrico', 'eléctrico',
    'resistencia', 'piloto', 'ignicion', 'ignición'
  ],
  otro: [
    'otro', 'otros', 'servicio', 'ayuda',
    'consulta', 'cotizacion', 'cotización',
    'presupuesto', 'evaluacion', 'evaluación',
    'repair', 'fix', 'service', 'plumbing'
  ],
  cita: [
    'cita', 'citas', 'agendar', 'agenda', 'agendame', 'agéndame',
    'appointment', 'schedule', 'booking', 'book'
  ]
};

function matchService(textNorm) {
  if (!textNorm) return null;

  // Primero si es número de menú
  if (['1', 'uno', '1️⃣'].includes(textNorm)) return 'destape';
  if (['2', 'dos', '2️⃣'].includes(textNorm)) return 'fuga';
  if (['3', 'tres', '3️⃣'].includes(textNorm)) return 'camara';
  if (['4', 'cuatro', '4️⃣'].includes(textNorm)) return 'calentador';
  if (['5', 'cinco', '5️⃣'].includes(textNorm)) return 'otro';
  if (['6', 'seis', '6️⃣'].includes(textNorm)) return 'cita';

  // Palabras directas (destape, leak, heater, etc.)
  for (const [key, words] of Object.entries(KEYWORDS)) {
    if (words.some(w => textNorm.includes(norm(w)))) {
      return key;
    }
  }
  return null;
}

// ================== SQLITE ==================
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h

async function initDB() {
  if (db) return db;

  db = await open({
    filename: './sessions.db',
    driver: sqlite3.Database
  });

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

  // Migración defensiva: asegurar columna lang
  const pragma = await db.all('PRAGMA table_info(sessions)');
  const cols = pragma.map(c => c.name);
  if (!cols.includes('lang')) {
    await db.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es';`);
  }

  // Limpieza de sesiones viejas
  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);

  return db;
}

async function getSession(from) {
  if (!db) await initDB();
  return db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}

async function upsertSession(from, patch) {
  if (!db) await initDB();
  const prev = (await getSession(from)) || {};
  const now = Date.now();

  const next = {
    lang: patch.lang || prev.lang || 'es',
    last_choice: patch.last_choice !== undefined ? patch.last_choice : (prev.last_choice || null),
    awaiting_details: patch.awaiting_details !== undefined ? patch.awaiting_details : (prev.awaiting_details || 0),
    details: patch.details !== undefined ? patch.details : (prev.details || null),
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
  if (!db) await initDB();
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// ================== TWILIO XML ==================
function sendTwilioXML(res, text) {
  const safe = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.status(200).send(xml);
}

// ================== ENDPOINTS DIAG ==================
app.get('/__version', (req, res) => {
  res.json({ ok: true, tag: TAG, tz: 'America/Puerto_Rico' });
});

app.get('/', (req, res) => {
  res.send(`${TAG} activo ✅`);
});

// ================== WEBHOOK PRINCIPAL ==================
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    await initDB();

    const from =
      (req.body.From || req.body.from || req.body.WaId || '').toString();
    const bodyRaw =
      (req.body.Body || req.body.body || '').toString();

    const textNorm = norm(bodyRaw);

    // 1) Cargar / crear sesión
    let session = await getSession(from);
    if (!session) {
      const langGuess = detectLangFromText(bodyRaw) || 'es';
      session = await upsertSession(from, {
        lang: langGuess,
        awaiting_details: 0
      });
    }

    let lang = session.lang || 'es';

    // 2) Cambio de idioma (siempre prioridad)
    const langSwitch = isLangSwitch(textNorm);
    if (langSwitch) {
      lang = langSwitch;
      session = await upsertSession(from, { lang, awaiting_details: 0 });

      if (lang === 'en') {
        const msg = `🌐 Language switched to *English*.

${buildMainMenu('en')}

${FOOTER_EN}`;
        return sendTwilioXML(res, msg);
      } else {
        const msg = `🌐 Idioma cambiado a *español*.

${buildMainMenu('es')}

${FOOTER_ES}`;
        return sendTwilioXML(res, msg);
      }
    }

    // 3) Comandos de menú (inicio/menu/volver/start/back)
    const cmd = isMenuCommand(textNorm);
    if (cmd === 'menu' || cmd === 'back') {
      await upsertSession(from, { awaiting_details: 0, last_choice: null });
      const msg = `${buildMainMenu(lang)}\n\n${lang === 'en' ? FOOTER_EN : FOOTER_ES}`;
      return sendTwilioXML(res, msg);
    }

    // 4) Si estamos esperando detalles, eso va primero para que no confunda con palabras clave
    if (session.awaiting_details) {
      // Guardar texto como detalles y cerrar ciclo
      const serviceKey = session.last_choice || 'otro';
      await upsertSession(from, {
        details: bodyRaw,
        awaiting_details: 0
      });

      const label = (SERVICE_LABEL[lang] && SERVICE_LABEL[lang][serviceKey]) ||
        SERVICE_LABEL[lang].otro;

      if (lang === 'en') {
        const reply =
`✅ Received. I saved your details for *${label}*:
"${bodyRaw}"

We will review your info and contact you at ${DESTAPESPR_PHONE} or via WhatsApp.

Type *"menu"* or *"start"* to see the menu again, or *"english"/"español"* to switch language.
${FOOTER_EN}`;
        return sendTwilioXML(res, reply);
      } else {
        const reply =
`✅ Recibido. Guardé tus datos para *${label}*:
"${bodyRaw}"

Revisaremos tu información y nos comunicaremos contigo al ${DESTAPESPR_PHONE_HUMAN} o por WhatsApp.

Escribe *"inicio"* o *"menu"* para ver el menú otra vez, o *"english/español"* para cambiar de idioma.
${FOOTER_ES}`;
        return sendTwilioXML(res, reply);
      }
    }

    // 5) Detectar servicio (número o palabra)
    const service = matchService(textNorm);
    if (service) {
      session = await upsertSession(from, {
        last_choice: service,
        awaiting_details: 1
      });

      // Mensaje por servicio
      let headerMsg = '';
      if (lang === 'en') {
        if (service === 'destape') {
          headerMsg = `🚿 *Clog / drain cleaning*  
We work on sinks, toilets, showers, and main lines.`;
        } else if (service === 'fuga') {
          headerMsg = `💧 *Leak / damp spots*  
We help with leaks, damp walls, or suspicious water usage.`;
        } else if (service === 'camara') {
          headerMsg = `📹 *Camera inspection*  
We inspect your lines to locate hidden problems.`;
        } else if (service === 'calentador') {
          headerMsg = `🔥 *Water heater (gas or electric)*  
Tell me what type you have and the issue.`;
        } else if (service === 'cita') {
          headerMsg = `📅 *Appointment / Schedule*  
We will use your details to coordinate the best time.`;
        } else {
          headerMsg = `🛠️ *Other plumbing service*  
Tell me what you need help with.`;
        }

        const reply =
`${headerMsg}

${DETAILS_PROMPT_EN}

Type *"back"* to return to the menu, or *"english/español"* to change language.`;
        return sendTwilioXML(res, reply);
      } else {
        // Español
        if (service === 'destape') {
          headerMsg = `🚿 *Destape de tuberías*  
Trabajamos fregaderos, inodoros, duchas y línea principal.`;
        } else if (service === 'fuga') {
          headerMsg = `💧 *Fugas de agua / humedad*  
Te ayudamos con filtraciones, humedad en paredes o consumo extraño de agua.`;
        } else if (service === 'camara') {
          headerMsg = `📹 *Inspección con cámara*  
Inspeccionamos tu tubería para encontrar problemas ocultos.`;
        } else if (service === 'calentador') {
          headerMsg = `🔥 *Calentador (gas o eléctrico)*  
Cuéntame qué tipo de calentador tienes y qué problema presenta.`;
        } else if (service === 'cita') {
          headerMsg = `📅 *Cita / Schedule appointment*  
Usaremos tus datos para coordinar el mejor horario disponible.`;
        } else {
          headerMsg = `🛠️ *Otro servicio de plomería*  
Cuéntame brevemente qué necesitas.`;
        }

        const reply =
`${headerMsg}

${DETAILS_PROMPT_ES}

Escribe *"volver"* para regresar al menú, o *"english/español"* para cambiar de idioma.`;
        return sendTwilioXML(res, reply);
      }
    }

    // 6) Si no entendimos nada: mostrar menú según idioma
    // Podríamos intentar detectar idioma del mensaje para mejorar
    const guess = detectLangFromText(bodyRaw);
    if (guess && guess !== lang) {
      lang = guess;
      await upsertSession(from, { lang });
    }

    const fallback =
`${lang === 'en'
  ? `I didn’t understand your message.`
  : `No entendí tu mensaje.`}

${buildMainMenu(lang)}

${lang === 'en' ? FOOTER_EN : FOOTER_ES}`;

    return sendTwilioXML(res, fallback);
  } catch (err) {
    console.error('Error en webhook /webhook/whatsapp:', err);
    const msg =
`⚠️ Ocurrió un error interno / An internal error occurred.
Intenta de nuevo en unos minutos, por favor.`;
    return sendTwilioXML(res, msg);
  }
});

// ================== START ==================
app.listen(PORT, () => {
  console.log(`💬 ${TAG} escuchando en http://localhost:${PORT}`);
});