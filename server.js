import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
app.use(express.urlencoded({ extended: true })); // Twilio envía form-encoded
app.use(express.json());
app.use(morgan('dev'));

// =====================
// CONFIG
// =====================
const PORT = process.env.PORT || 10000; // Render suele inyectar PORT=10000
const TAG = '[[BILINGUAL-V1]]';

const CIERRE_ES = `
✅ Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR`;
const CIERRE_EN = `
✅ We will contact you shortly.
Thank you for your business.
— DestapesPR`;

const MENU_ES = `${TAG} Bienvenido a DestapesPR

Escribe el número o la palabra del servicio que necesitas:

1 - Destape (drenajes o tuberías tapadas)
2 - Fuga (fugas de agua)
3 - Cámara (inspección con cámara)
4 - Calentador (gas o eléctrico)
5 - Otro (otro tipo de servicio)

Comandos: "inicio", "menu" o "volver" para regresar al menú.
Para inglés, escribe "english" o "menu en".`;

const MENU_EN = `${TAG} Welcome to DestapesPR

Type the number or the word of the service you need:

1 - Unclog (drains or blocked pipes)
2 - Leak (water leaks)
3 - Camera (video inspection)
4 - Heater (gas or electric)
5 - Other (other service)

Commands: "menu" or "back" to return to the menu.
For Spanish, type "espanol" or "menu es".`;

const OPCIONES = { '1': 'destape', '2': 'fuga', '3': 'camara', '4': 'calentador', '5': 'otro' };

const RESP_ES = {
  destape: `Perfecto. ¿En qué área estás (municipio o sector)? Luego cuéntame qué línea está tapada (fregadero, inodoro, principal, etc.).${CIERRE_ES}`,
  fuga: `Entendido. ¿Dónde notas la fuga o humedad? ¿Es dentro o fuera de la propiedad?${CIERRE_ES}`,
  camara: `Realizamos inspección con cámara. ¿En qué área la necesitas (baño, cocina, línea principal)?${CIERRE_ES}`,
  calentador: `Revisamos calentadores eléctricos o de gas. ¿Qué tipo tienes y qué problema notas?${CIERRE_ES}`,
  otro: `Cuéntame brevemente qué servicio necesitas y en qué área estás.${CIERRE_ES}`,
};

const RESP_EN = {
  destape: `Perfect. Which area are you in (city or neighborhood)? Also tell me which line is clogged (sink, toilet, main, etc.).${CIERRE_EN}`,
  fuga: `Got it. Where do you notice the leak or moisture? Is it inside or outside the property?${CIERRE_EN}`,
  camara: `We perform video inspections. In which area do you need it (bathroom, kitchen, main line)?${CIERRE_EN}`,
  calentador: `We check electric or gas water heaters. Which type do you have and what issue do you notice?${CIERRE_EN}`,
  otro: `Please tell me briefly what service you need and in which area you are.${CIERRE_EN}`,
};

// =====================
// UTILIDADES
// =====================
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

function detectLanguage(bodyRaw) {
  const t = norm(bodyRaw);
  if (/(^|\b)(hello|hi|hey|english|menu en|start|back)(\b|$)/.test(t)) return 'en';
  if (/(^|\b)(espanol|menu es|hola|buenas|inicio|volver|menu)(\b|$)/.test(t)) return 'es';
  // Heurística por palabras
  if (/(unclog|clog|leak|camera|heater|appointment)/.test(t)) return 'en';
  if (/(destape|fuga|camara|camar|calentador|cita)/.test(t)) return 'es';
  return 'es';
}

const KEYWORDS_ES = {
  destape: ['destape', 'tapon', 'tapones', 'tapada', 'obstruccion', 'drenaje', 'fregadero', 'inodoro', 'principal'],
  fuga: ['fuga', 'salidero', 'goteo', 'humedad', 'filtracion', 'charco'],
  camara: ['camara', 'cámara', 'inspeccion', 'video'],
  calentador: ['calentador', 'boiler', 'agua caliente', 'gas', 'electrico', 'eléctrico'],
  otro: ['otro', 'servicio', 'ayuda', 'cotizacion', 'presupuesto'],
};

const KEYWORDS_EN = {
  destape: ['unclog', 'clog', 'blocked', 'drain', 'sink', 'toilet', 'main line'],
  fuga: ['leak', 'water leak', 'dripping', 'moisture', 'wet', 'puddle'],
  camara: ['camera', 'inspection', 'video', 'pipe inspection'],
  calentador: ['heater', 'hot water', 'gas heater', 'electric heater'],
  otro: ['other', 'help', 'service', 'quote', 'estimate'],
};

function matchChoice(bodyRaw, lang) {
  const b = norm(bodyRaw);
  const keywords = lang === 'en' ? KEYWORDS_EN : KEYWORDS_ES;

  // Opción por número
  if (OPCIONES[b]) return OPCIONES[b];

  // Opción exacta por palabra clave "base"
  if (['destape', 'fuga', 'camara', 'calentador', 'otro'].includes(b)) return b;

  // Coincidencia por presencia de sinónimos
  for (const [key, arr] of Object.entries(keywords)) {
    if (arr.some((k) => b.includes(k))) return key;
  }
  return null;
}

// =====================
// SQLITE (con migración automática)
// =====================
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });

  // Crear tabla base (si no existe)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY
    );
  `);

  // Migrar columnas que falten
  const cols = await db.all(`PRAGMA table_info(sessions)`);
  const have = new Set(cols.map((c) => c.name));

  const needed = [
    { name: 'last_choice', def: "TEXT" },
    { name: 'awaiting_details', def: "INTEGER DEFAULT 0" },
    { name: 'details', def: "TEXT" },
    { name: 'last_active', def: "INTEGER" },
    { name: 'lang', def: "TEXT DEFAULT 'es'" },
  ];

  for (const c of needed) {
    if (!have.has(c.name)) {
      await db.exec(`ALTER TABLE sessions ADD COLUMN ${c.name} ${c.def};`);
    }
  }

  // Limpiar sesiones viejas
  await db.run('DELETE FROM sessions WHERE last_active IS NOT NULL AND last_active < ?', Date.now() - SESSION_TTL_MS);

  return db;
}

async function getSession(from) {
  return await db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}

async function upsertSession(from, patch) {
  const prev = (await getSession(from)) || {};
  const now = Date.now();
  const next = {
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    lang: patch.lang ?? prev.lang ?? 'es',
    last_active: now,
  };

  await db.run(
    `
    INSERT INTO sessions (from_number, last_choice, awaiting_details, details, last_active, lang)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      last_choice=excluded.last_choice,
      awaiting_details=excluded.awaiting_details,
      details=excluded.details,
      last_active=excluded.last_active,
      lang=excluded.lang
  `,
    [from, next.last_choice, next.awaiting_details, next.details, next.last_active, next.lang]
  );

  return next;
}

async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// =====================
// RESPUESTA TWILIO
// =====================
function sendTwilioXML(res, text) {
  const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.status(200).send(xml);
}

// =====================
// ENDPOINTS
// =====================
app.get('/', (_req, res) => res.send(`${TAG} Bot bilingüe activo ✅`));
app.get('/__version', (_req, res) => res.json({ ok: true, tag: TAG }));

app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from = (req.body.From || req.body.from || req.body.WaId || '').toString();
  const bodyRaw = (req.body.Body || req.body.body || '').toString();
  const body = norm(bodyRaw);

  // Cargar/crear sesión y decidir idioma
  let session = await getSession(from);
  if (!session) {
    session = await upsertSession(from, { lang: detectLanguage(bodyRaw) });
  }

  // Cambio explícito de idioma
  if (/(^|\b)(english|menu en)(\b|$)/.test(body)) {
    session = await upsertSession(from, { lang: 'en' });
  } else if (/(^|\b)(espanol|menu es)(\b|$)/.test(body)) {
    session = await upsertSession(from, { lang: 'es' });
  }

  const lang = session.lang || detectLanguage(bodyRaw) || 'es';
  const isEN = lang === 'en';
  const MENU = isEN ? MENU_EN : MENU_ES;
  const RESP = isEN ? RESP_EN : RESP_ES;

  // Volver al menú
  if (!body || ['menu', 'inicio', 'volver', 'start', 'back'].includes(body)) {
    await clearSession(from);
    await upsertSession(from, { lang });
    return sendTwilioXML(res, MENU);
  }

  // Detección de opción
  const choice = matchChoice(bodyRaw, lang);
  if (choice) {
    await upsertSession(from, { last_choice: choice, awaiting_details: 1, details: null, lang });
    const hint = isEN ? 'Type "menu" to return to the main menu' : 'Escribe "menu" para regresar al menú';
    return sendTwilioXML(res, `${RESP[choice]}\n\n(${hint})`);
  }

  // Si estaba esperando detalles
  const s = await getSession(from);
  if (s?.last_choice && s?.awaiting_details) {
    await upsertSession(from, { details: bodyRaw, awaiting_details: 0 });
    const reply = isEN
      ? `Thanks. I saved your details for *${s.last_choice}*:\n"${bodyRaw}"${CIERRE_EN}`
      : `Gracias. Guardé tus detalles para *${s.last_choice}*:\n"${bodyRaw}"${CIERRE_ES}`;
    return sendTwilioXML(res, reply);
  }

  // Fallback → menú
  return sendTwilioXML(res, MENU);
});

// =====================
// START
// =====================
app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bilingual Bot listening on http://localhost:${PORT}`);
});