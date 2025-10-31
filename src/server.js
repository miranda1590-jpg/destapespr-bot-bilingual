import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 3000;
const TAG = '[[BILINGUAL-V1]]';

// ======= CONFIGURACIÓN =======
const LINK_CITA = 'https://wa.me/17879220068?text=Quiero%20agendar%20una%20cita';
const CIERRE_ES = '\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.\n— DestapesPR';
const CIERRE_EN = '\n✅ We will contact you shortly.\nThank you for your business.\n— DestapesPR';

const MENU_ES = `${TAG} Bienvenido a DestapesPR

Escribe el número o la palabra del servicio que necesitas:

1 - Destape (drenajes o tuberías tapadas)
2 - Fuga (fugas de agua)
3 - Cámara (inspección con cámara)
4 - Calentador (gas o eléctrico)
5 - Otro (otro tipo de servicio)

Comandos: "inicio", "menu" o "volver" para regresar al menú.`;

const MENU_EN = `${TAG} Welcome to DestapesPR

Type the number or word of the service you need:

1 - Unclog (drains or blocked pipes)
2 - Leak (water leaks)
3 - Camera (video inspection)
4 - Heater (gas or electric)
5 - Other (other service)

Commands: "menu", "start" or "back" to return to the menu.`;

const OPCIONES = { '1': 'destape', '2': 'fuga', '3': 'camara', '4': 'calentador', '5': 'otro' };

// ======= RESPUESTAS =======
const RESPUESTAS_ES = {
  destape: `Perfecto. ¿En qué área estás (municipio o sector)? Luego cuéntame qué línea está tapada (fregadero, inodoro, principal, etc.).${CIERRE_ES}`,
  fuga: `Entendido. ¿Dónde notas la fuga o humedad? ¿Es dentro o fuera de la propiedad?${CIERRE_ES}`,
  camara: `Realizamos inspección con cámara. ¿En qué área la necesitas (baño, cocina, línea principal)?${CIERRE_ES}`,
  calentador: `Revisamos calentadores eléctricos o de gas. ¿Qué tipo tienes y qué problema notas?${CIERRE_ES}`,
  otro: `Cuéntame brevemente qué servicio necesitas y en qué área estás.${CIERRE_ES}`,
};

const RESPUESTAS_EN = {
  destape: `Perfect. In which area are you located (city or neighborhood)? Also tell me which line is clogged (sink, toilet, main line, etc.).${CIERRE_EN}`,
  fuga: `Got it. Where do you notice the leak or moisture? Is it inside or outside the property?${CIERRE_EN}`,
  camara: `We perform video inspections. In which area do you need it (bathroom, kitchen, main line)?${CIERRE_EN}`,
  calentador: `We check electric or gas water heaters. What type do you have and what issue do you notice?${CIERRE_EN}`,
  otro: `Please tell me briefly what service you need and in which area you are.${CIERRE_EN}`,
};

// ======= KEYWORDS =======
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

const KEYWORDS_ES = {
  destape: ['destape', 'tapon', 'tapones', 'tapada', 'obstruccion', 'drenaje', 'fregadero', 'inodoro', 'principal'],
  fuga: ['fuga', 'salidero', 'goteo', 'humedad', 'filtracion', 'charco'],
  camara: ['camara', 'cámara', 'inspeccion', 'video'],
  calentador: ['calentador', 'boiler', 'agua caliente', 'gas', 'electrico'],
  otro: ['otro', 'servicio', 'ayuda', 'cotizacion'],
};

const KEYWORDS_EN = {
  destape: ['unclog', 'clog', 'blocked', 'drain', 'sink', 'toilet', 'main line'],
  fuga: ['leak', 'water leak', 'dripping', 'moisture', 'wet', 'puddle'],
  camara: ['camera', 'inspection', 'video', 'pipe inspection'],
  calentador: ['heater', 'hot water', 'gas heater', 'electric heater'],
  otro: ['other', 'help', 'service', 'quote', 'estimate'],
};

function detectLanguage(bodyRaw) {
  const text = norm(bodyRaw);
  if (/(hi|hello|good morning|good evening|english|menu en)\b/.test(text)) return 'en';
  return 'es';
}

function matchChoice(bodyRaw, lang) {
  const b = norm(bodyRaw);
  const keywords = lang === 'en' ? KEYWORDS_EN : KEYWORDS_ES;
  const opciones = OPCIONES;
  if (opciones[b]) return opciones[b];
  if (Object.keys(keywords).includes(b)) return b;
  for (const [key, arr] of Object.entries(keywords)) {
    if (arr.some(k => b.includes(k))) return key;
  }
  return null;
}

// ======= DATABASE =======
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      last_active INTEGER,
      lang TEXT DEFAULT 'es'
    );
  `);
  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);
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
  await db.run(`
    INSERT INTO sessions (from_number, last_choice, awaiting_details, details, last_active, lang)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      last_choice=excluded.last_choice,
      awaiting_details=excluded.awaiting_details,
      details=excluded.details,
      last_active=excluded.last_active,
      lang=excluded.lang
  `, [from, next.last_choice, next.awaiting_details, next.details, next.last_active, next.lang]);
  return next;
}

async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// ======= RESPUESTA WHATSAPP =======
app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from = (req.body.From || req.body.from || '').toString();
  const bodyRaw = (req.body.Body || req.body.body || '').toString();
  const body = norm(bodyRaw);

  let session = await getSession(from);
  if (!session) {
    const lang = detectLanguage(bodyRaw);
    session = await upsertSession(from, { lang });
  }

  const lang = detectLanguage(bodyRaw) || session.lang || 'es';
  const isEnglish = lang === 'en';
  const RESPUESTAS = isEnglish ? RESPUESTAS_EN : RESPUESTAS_ES;
  const MENU = isEnglish ? MENU_EN : MENU_ES;

  if (!body || ['menu', 'inicio', 'volver', 'start', 'back'].includes(body)) {
    await clearSession(from);
    await upsertSession(from, { lang });
    return sendTwilioXML(res, MENU);
  }

  const detected = matchChoice(bodyRaw, lang);
  if (detected) {
    await upsertSession(from, { last_choice: detected, awaiting_details: 1, details: null, lang });
    return sendTwilioXML(res, `${RESPUESTAS[detected]}\n\n(${isEnglish ? 'Type' : 'Escribe'} "menu" ${isEnglish ? 'to return to the main menu' : 'para regresar al menú'})`);
  }

  const s = await getSession(from);
  if (s?.last_choice && s?.awaiting_details) {
    await upsertSession(from, { details: bodyRaw, awaiting_details: 0 });
    const reply = isEnglish
      ? `Thanks. I saved your details for *${s.last_choice}*:\n"${bodyRaw}"${CIERRE_EN}`
      : `Gracias. Guardé tus detalles para *${s.last_choice}*:\n"${bodyRaw}"${CIERRE_ES}`;
    return sendTwilioXML(res, reply);
  }

  return sendTwilioXML(res, MENU);
});

function sendTwilioXML(res, text) {
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.send(xml);
}

// ======= ENDPOINTS DE TEST =======
app.get('/', (_req, res) => res.send(`${TAG} Bot bilingüe activo ✅`));
app.get('/__version', (_req, res) => res.json({ ok: true, tag: TAG }));

app.listen(PORT, () => console.log(`💬 DestapesPR Bilingual Bot listening on http://localhost:${PORT}`));