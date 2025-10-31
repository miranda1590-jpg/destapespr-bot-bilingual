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
const TAG = '[[BILINGUAL-V3.4]]';

// =====================
// TEXTOS BASE
// =====================
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
6 - Cita (coordinar cita directamente)

Comandos: "inicio", "menu" o "volver" para regresar al menú.
Para inglés, escribe "english" o "menu en".`;

const MENU_EN = `${TAG} Welcome to DestapesPR

Type the number or the word of the service you need:

1 - Unclog (drains or blocked pipes)
2 - Leak (water leaks)
3 - Camera (video inspection)
4 - Heater (gas or electric)
5 - Other (other service)
6 - Appointment (schedule directly)

Commands: "menu" or "back" to return to the menu.
For Spanish, type "espanol" or "menu es".`;

const OPCIONES = { '1': 'destape', '2': 'fuga', '3': 'camara', '4': 'calentador', '5': 'otro', '6': 'cita' };

const NOMBRES_SERVICIOS = {
  es: {
    destape: 'Destape',
    fuga: 'Fuga',
    camara: 'Cámara',
    calentador: 'Calentador',
    otro: 'Otro servicio',
    cita: 'Cita',
  },
  en: {
    destape: 'Unclog',
    fuga: 'Leak',
    camara: 'Camera Inspection',
    calentador: 'Heater',
    otro: 'Other Service',
    cita: 'Appointment',
  },
};

// — Formulario común (sin “schedule”)
const FORM_ES = `
Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
⏰ Horario disponible

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, 10am-1pm en Caguas"

(Escribe "volver" para regresar al menú)`;

const FORM_EN = `
Please send in a single message:
👤 Full name
📞 Contact number (US/PR)
⏰ Available time window

Example:
"My name is Ana Rivera, (939) 555-9999, 10am-1pm in Caguas"

(Type "back" to return to the menu)`;

// — Descripciones (solo cita mantiene el enlace)
const RESP_ES = {
  destape: `Opción: Destape 
Descripción: trabajamos fregaderos, inodoros, duchas y línea principal. También destapamos lavamanos, bañeras y desagües pluviales.${FORM_ES}`,
  fuga: `Opción: Fuga 
Descripción: localizamos y reparamos salideros, filtraciones y goteos. Orientación sobre humedad en paredes, techos o patios.${FORM_ES}`,
  camara: `Opción: Cámara 
Descripción: inspección con video para detectar roturas, raíces u obstrucciones; se puede documentar con evidencia.${FORM_ES}`,
  calentador: `Opción: Calentador 
Descripción: diagnóstico y corrección en calentadores eléctricos o de gas (termostato, resistencia, ignición/piloto, fugas).${FORM_ES}`,
  otro: `Opción: Otro servicio 
Descripción: cuéntanos tu necesidad (instalaciones, mantenimiento, cotizaciones, etc.).${FORM_ES}`,
  cita: `Opción: Cita 
Para coordinar tu cita ahora, envía tu nombre, número y horario disponible. También puedes hacerlo directamente en WhatsApp: 
📅 https://wa.me/17879220068?text=Quiero%20agendar%20una%20cita${CIERRE_ES}`,
};

const RESP_EN = {
  destape: `Option: Unclog 
Description: we handle sinks, toilets, showers, and the main line; also lavatories, bathtubs, and storm drains.${FORM_EN}`,
  fuga: `Option: Leak 
Description: we detect and repair water leaks, drips, and seepage; guidance for damp walls/ceilings/yards.${FORM_EN}`,
  camara: `Option: Camera Inspection 
Description: video inspection to find breaks, roots, or blockages; optional photo/video documentation.${FORM_EN}`,
  calentador: `Option: Heater 
Description: diagnosis and fix for electric/gas water heaters (thermostat, element, ignition/pilot, leaks).${FORM_EN}`,
  otro: `Option: Other 
Description: tell us your need (installations, maintenance, quotes, etc.).${FORM_EN}`,
  cita: `Option: Appointment 
To schedule your appointment now, send your name, number, and available time. Or click this link:
📅 https://wa.me/17879220068?text=I%20want%20to%20schedule%20an%20appointment${CIERRE_EN}`,
};

// =====================
// UTILIDADES Y DB
// =====================
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

function detectLanguage(bodyRaw) {
  const t = norm(bodyRaw);
  if (/(english|menu en|hi|hello|back)/.test(t)) return 'en';
  if (/(espanol|menu es|hola|buenas|volver|inicio|menu)/.test(t)) return 'es';
  if (/(unclog|leak|camera|heater|appointment)/.test(t)) return 'en';
  if (/(destape|fuga|camara|calentador|cita)/.test(t)) return 'es';
  return 'es';
}

function matchChoice(bodyRaw, lang) {
  const b = norm(bodyRaw);
  if (OPCIONES[b]) return OPCIONES[b];
  const words = {
    es: {
      destape: ['destape', 'tapon', 'tapada', 'fregadero', 'inodoro', 'principal', 'ducha'],
      fuga: ['fuga', 'salidero', 'goteo', 'humedad', 'filtracion'],
      camara: ['camara', 'cámara', 'video', 'inspeccion'],
      calentador: ['calentador', 'agua caliente', 'boiler', 'gas', 'electrico', 'eléctrico'],
      otro: ['otro', 'servicio', 'ayuda', 'cotizacion'],
      cita: ['cita', 'agendar', 'reservar', 'agenda'],
    },
    en: {
      destape: ['unclog', 'clog', 'blocked', 'drain', 'sink', 'toilet', 'main line'],
      fuga: ['leak', 'water leak', 'dripping', 'moisture', 'wet'],
      camara: ['camera', 'inspection', 'video', 'pipe inspection'],
      calentador: ['heater', 'hot water', 'gas heater', 'electric heater'],
      otro: ['other', 'service', 'help', 'quote', 'estimate'],
      cita: ['appointment', 'schedule', 'book', 'appt'],
    },
  }[lang];
  for (const [key, arr] of Object.entries(words)) {
    if (arr.some((k) => b.includes(k))) return key;
  }
  return null;
}

let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (from_number TEXT PRIMARY KEY);`);
  const cols = await db.all(`PRAGMA table_info(sessions)`);
  const have = new Set(cols.map((c) => c.name));
  const needed = [
    { name: 'last_choice', def: 'TEXT' },
    { name: 'awaiting_details', def: 'INTEGER DEFAULT 0' },
    { name: 'details', def: 'TEXT' },
    { name: 'last_active', def: 'INTEGER' },
    { name: 'lang', def: "TEXT DEFAULT 'es'" },
  ];
  for (const c of needed) {
    if (!have.has(c.name)) {
      await db.exec(`ALTER TABLE sessions ADD COLUMN ${c.name} ${c.def};`);
    }
  }
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

  let session = await getSession(from);
  if (!session) session = await upsertSession(from, { lang: detectLanguage(bodyRaw) });

  if (/(english|menu en)/.test(body)) session = await upsertSession(from, { lang: 'en' });
  if (/(espanol|menu es)/.test(body)) session = await upsertSession(from, { lang: 'es' });

  const lang = session.lang || detectLanguage(bodyRaw) || 'es';
  const isEN = lang === 'en';
  const MENU = isEN ? MENU_EN : MENU_ES;
  const RESP = isEN ? RESP_EN : RESP_ES;
  const CIERRE = isEN ? CIERRE_EN : CIERRE_ES;
  const NOMBRE_SERV = NOMBRES_SERVICIOS[lang];

  if (!body || ['menu', 'inicio', 'volver', 'start', 'back'].includes(body)) {
    await clearSession(from);
    await upsertSession(from, { lang });
    return sendTwilioXML(res, MENU);
  }

  const s0 = await getSession(from);
  if (s0?.awaiting_details) {
    if (['menu', 'inicio', 'volver', 'start', 'back'].includes(body)) {
      await clearSession(from);
      await upsertSession(from, { lang });
      return sendTwilioXML(res, MENU);
    }
    await upsertSession(from, { details: bodyRaw, awaiting_details: 0 });
    const resumen = isEN
      ? `✅ Received. I saved your details:\n"${bodyRaw}"\n\nService: *${NOMBRE_SERV[s0.last_choice] || 'n/a'}*${CIERRE}`
      : `✅ Recibido. Guardé tus datos:\n"${bodyRaw}"\n\nServicio: *${NOMBRE_SERV[s0.last_choice] || 'n/a'}*${CIERRE}`;
    return sendTwilioXML(res, resumen);
  }

  const choice = matchChoice(bodyRaw, lang);
  if (choice) {
    await upsertSession(from, { last_choice: choice, awaiting_details: 1, details: null, lang });
    return sendTwilioXML(res, RESP[choice]);
  }

  return sendTwilioXML(res, MENU);
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => console.log(`💬 DestapesPR Bot Bilingüe escuchando en http://localhost:${PORT}`));