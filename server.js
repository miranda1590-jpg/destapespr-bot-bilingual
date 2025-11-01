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
const TAG = '[[BILINGUAL-V4.0]]';

// =====================
// BRANDING (env o defaults)
// =====================
const BRAND_FB   = process.env.BRAND_FB   || 'https://facebook.com/DestapesPR';
const BRAND_WEB  = process.env.BRAND_WEB  || 'https://destapespr.com';
const BRAND_PHONE= process.env.BRAND_PHONE|| '+1 787-922-0068';

// =====================
// CIERRES con branding
// =====================
const CIERRE_ES = `
✅ Próximamente nos estaremos comunicando.
🙏 Gracias por su patrocinio.
🚿 — DestapesPR 💧
📱 Facebook: ${BRAND_FB}
🌐 Sitio web: ${BRAND_WEB}
📞 Teléfono directo: ${BRAND_PHONE}`;

const CIERRE_EN = `
✅ We will contact you shortly.
🙏 Thank you for your business.
🚿 — DestapesPR 💧
📱 Facebook: ${BRAND_FB}
🌐 Website: ${BRAND_WEB}
📞 Direct line: ${BRAND_PHONE}`;

// =====================
// MENÚS
// =====================
const MENU_ES = `${TAG} 👋 ¡Bienvenido a *DestapesPR* 🇵🇷💦

Selecciona el número o escribe la palabra del servicio que necesitas:

1️⃣ - 🚰 *Destape* (drenajes o tuberías tapadas)
2️⃣ - 💧 *Fuga* (fugas de agua o filtraciones)
3️⃣ - 🎥 *Cámara* (inspección con cámara)
4️⃣ - 🔥 *Calentador* (gas o eléctrico)
5️⃣ - 🧰 *Otro* (otro tipo de servicio)
6️⃣ - 📅 *Cita* (coordinar cita directamente)

💬 Comandos: “inicio”, “menu” o “volver” para regresar al menú.
🇺🇸 Para inglés, escribe “english” o “menu en”.`;

const MENU_EN = `${TAG} 👋 *Welcome to DestapesPR* 🇵🇷💦

Type the number or the word of the service you need:

1️⃣ - 🚰 *Unclog* (drains or blocked pipes)
2️⃣ - 💧 *Leak* (water leaks or moisture)
3️⃣ - 🎥 *Camera* (video inspection)
4️⃣ - 🔥 *Heater* (gas or electric)
5️⃣ - 🧰 *Other* (other type of service)
6️⃣ - 📅 *Appointment* (schedule directly)

💬 Commands: “menu” or “back” to return to the menu.
🇪🇸 For Spanish, type “espanol” or “menu es”.`;

const OPCIONES = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro', '6':'cita' };

const NOMBRES_SERVICIOS = {
  es: { destape:'Destape', fuga:'Fuga', camara:'Cámara', calentador:'Calentador', otro:'Otro servicio', cita:'Cita' },
  en: { destape:'Unclog',  fuga:'Leak', camara:'Camera Inspection', calentador:'Heater', otro:'Other Service', cita:'Appointment' },
};

// Formulario común (sin “schedule”)
const FORM_ES = `
✍️ Por favor envía en un solo mensaje:
👤 *Nombre completo*
📞 *Número de contacto* (787/939 o EE.UU.)
⏰ *Horario disponible*
📍 *Zona (municipio/sector)*

🧾 Ejemplo:
“Me llamo Ana Rivera, 939-555-9999, 10 am–1 pm en Caguas”

💡 Consejo: puedes enviar fotos o videos para ayudarnos a diagnosticar mejor.
(Escribe “volver” para regresar al menú)`;

const FORM_EN = `
✍️ Please send in a single message:
👤 *Full name*
📞 *Contact number* (US/PR)
⏰ *Available time window*
📍 *Area (city/sector)*

🧾 Example:
“My name is Ana Rivera, (939) 555-9999, 10 am–1 pm in Caguas”

💡 Tip: you can send photos or videos to help us diagnose faster.
(Type “back” to return to the menu)`;

// Descripciones (solo cita mantiene el enlace directo)
const RESP_ES = {
  destape: `🚰 *Servicio: Destape*  
💬 Trabajamos fregaderos, inodoros, duchas y líneas principales. También lavamanos, bañeras y desagües pluviales.${FORM_ES}`,
  fuga: `💧 *Servicio: Fuga*  
🔎 Localizamos y reparamos salideros, filtraciones y goteos. Humedades en paredes, techos o patios.${FORM_ES}`,
  camara: `🎥 *Servicio: Inspección con cámara*  
🔍 Detectamos roturas, raíces u obstrucciones; opcional documentación en foto/video.${FORM_ES}`,
  calentador: `🔥 *Servicio: Calentador*  
🛠️ Diagnóstico y reparación (eléctrico o gas: termostato, resistencia, ignición/piloto, fugas).${FORM_ES}`,
  otro: `🧰 *Otro servicio*  
💭 Cuéntanos brevemente tu necesidad (instalaciones, mantenimiento, cotizaciones, etc.).${FORM_ES}`,
  cita: `📅 *Cita*  
🗓️ Para coordinar tu cita ahora, envía tu nombre, número y horario disponible.${CIERRE_ES}`,
};

const RESP_EN = {
  destape: `🚰 *Service: Unclog*  
💬 We handle sinks, toilets, showers, and main lines; also lavatories, bathtubs, and storm drains.${FORM_EN}`,
  fuga: `💧 *Service: Leak*  
🔎 We find and repair leaks, drips, and moisture issues on walls/ceilings/yards.${FORM_EN}`,
  camara: `🎥 *Service: Camera Inspection*  
🔍 Video inspection to detect breaks, roots, or obstructions; optional media report.${FORM_EN}`,
  calentador: `🔥 *Service: Heater*  
🛠️ Diagnosis & repair (electric/gas: thermostat, element, ignition/pilot, leaks).${FORM_EN}`,
  otro: `🧰 *Other Service*  
💭 Briefly tell us what you need (installation, maintenance, quotes, etc.).${FORM_EN}`,
  cita: `📅 *Appointment*  
🗓️ To schedule now, send your name, number, and available time.${CIERRE_EN}`,
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
      destape: ['destape','tapon','tapada','fregadero','inodoro','principal','ducha','sanitario'],
      fuga: ['fuga','salidero','goteo','humedad','filtracion','filtración'],
      camara: ['camara','cámara','video','inspeccion','inspección'],
      calentador: ['calentador','agua caliente','boiler','gas','electrico','eléctrico'],
      otro: ['otro','servicio','ayuda','cotizacion','cotización'],
      cita: ['cita','agendar','reservar','agenda'],
    },
    en: {
      destape: ['unclog','clog','blocked','drain','sink','toilet','main line'],
      fuga: ['leak','water leak','dripping','moisture','wet'],
      camara: ['camera','inspection','video','pipe inspection'],
      calentador: ['heater','hot water','gas heater','electric heater'],
      otro: ['other','service','help','quote','estimate'],
      cita: ['appointment','schedule','book','appt'],
    },
  }[lang];
  for (const [key, arr] of Object.entries(words)) {
    if (arr.some(k => b.includes(k))) return key;
  }
  return null;
}

// Hora local PR sin librerías extra
function nowInPR() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Puerto_Rico', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [h, m] = fmt.format(new Date()).split(':').map(n => parseInt(n, 10));
  return { hour: h, minute: m };
}
function isBusinessHours() {
  const { hour } = nowInPR();          // 0..23 en PR
  return hour >= 7 && hour < 18;       // 07:00–17:59
}

// =====================
// DB (SQLite) con migración
// =====================
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (from_number TEXT PRIMARY KEY);`);
  const cols = await db.all(`PRAGMA table_info(sessions)`);
  const have = new Set(cols.map(c => c.name));
  const needed = [
    { name: 'last_choice',     def: 'TEXT' },
    { name: 'awaiting_details',def: 'INTEGER DEFAULT 0' },
    { name: 'details',         def: 'TEXT' },
    { name: 'last_active',     def: 'INTEGER' },
    { name: 'lang',            def: "TEXT DEFAULT 'es'" },
    { name: 'visits',          def: 'INTEGER DEFAULT 0' },
  ];
  for (const c of needed) {
    if (!have.has(c.name)) await db.exec(`ALTER TABLE sessions ADD COLUMN ${c.name} ${c.def};`);
  }
  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);
  return db;
}

async function getSession(from) {
  return await db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}
async function upsertSession(from, patch) {
  const prev = (await getSession(from)) || {};
  const now  = Date.now();
  const next = {
    last_choice:      patch.last_choice      ?? prev.last_choice      ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details:          patch.details          ?? prev.details          ?? null,
    lang:             patch.lang             ?? prev.lang             ?? 'es',
    visits:           patch.visits           ?? (prev.visits ?? 0),
    last_active: now,
  };
  await db.run(`
    INSERT INTO sessions (from_number, last_choice, awaiting_details, details, last_active, lang, visits)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      last_choice=excluded.last_choice,
      awaiting_details=excluded.awaiting_details,
      details=excluded.details,
      last_active=excluded.last_active,
      lang=excluded.lang,
      visits=excluded.visits
  `, [from, next.last_choice, next.awaiting_details, next.details, next.last_active, next.lang, next.visits]);
  return next;
}
async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

function sendTwilioXML(res, text) {
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const xml  = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type','application/xml');
  return res.status(200).send(xml);
}

// =====================
// ENDPOINTS
// =====================
app.get('/', (_req,res) => res.send(`${TAG} 🤖 DestapesPR Bot Bilingüe activo 🇵🇷✅`));
app.get('/__version', (_req,res) => res.json({ ok:true, tag:TAG, version:'4.0', updated:new Date().toISOString() }));

app.post('/webhook/whatsapp', async (req,res) => {
  await initDB();

  const from    = (req.body.From || req.body.from || req.body.WaId || '').toString();
  const bodyRaw = (req.body.Body || req.body.body || '').toString();
  const body    = norm(bodyRaw);

  // carga/inicializa sesión
  let session = await getSession(from);
  if (!session) session = await upsertSession(from, { lang: detectLanguage(bodyRaw), visits: 0 });

  // comandos de idioma
  if (/(english|menu en)/.test(body)) session = await upsertSession(from, { lang:'en' });
  if (/(espanol|menu es)/.test(body)) session = await upsertSession(from, { lang:'es' });

  const lang   = session.lang || detectLanguage(bodyRaw) || 'es';
  const isEN   = lang === 'en';
  const MENU   = isEN ? MENU_EN : MENU_ES;
  const RESP   = isEN ? RESP_EN : RESP_ES;
  const CIERRE = isEN ? CIERRE_EN : CIERRE_ES;
  const NOMBRE_SERV = NOMBRES_SERVICIOS[lang];

  // saludo especial para clientes frecuentes
  let greetFrequent = '';
  const visits = (session.visits ?? 0);
  if (visits > 0) {
    greetFrequent = isEN
      ? `👋 Welcome back! Thanks for trusting DestapesPR again.`
      : `👋 ¡Hola de nuevo! Gracias por confiar nuevamente en DestapesPR.`;
  }
  if (!isBusinessHours()) {
    const offMsg = isEN
      ? `🕓 Our hours are 7:00 a.m. – 6:00 p.m. (PR). We received your message and will reply when we open.`
      : `🕓 Nuestro horario es de 7:00 a.m. a 6:00 p.m. (PR). Recibimos tu mensaje y responderemos al abrir.`;
    // mostramos aviso fuera de horario junto al menú
    if (!body || ['menu','inicio','volver','start','back','hola','hello','buenas','hi'].includes(body)) {
      await clearSession(from);
      await upsertSession(from, { lang, visits: visits + 1 });
      const composed = greetFrequent ? `${greetFrequent}\n\n${offMsg}\n\n${MENU}` : `${offMsg}\n\n${MENU}`;
      return sendTwilioXML(res, composed);
    }
  }

  // volver al menú
  if (!body || ['menu','inicio','volver','start','back','hola','hello','buenas','hi'].includes(body)) {
    await clearSession(from);
    await upsertSession(from, { lang, visits: visits + 1 });
    const composed = greetFrequent ? `${greetFrequent}\n\n${MENU}` : MENU;
    return sendTwilioXML(res, composed);
  }

  // si está esperando detalles, guardar y cerrar
  const s0 = await getSession(from);
  if (s0?.awaiting_details) {
    if (['menu','inicio','volver','start','back'].includes(body)) {
      await clearSession(from);
      await upsertSession(from, { lang, visits: visits + 1 });
      return sendTwilioXML(res, MENU);
    }
    await upsertSession(from, { details: bodyRaw, awaiting_details: 0, visits: visits + 1 });
    const resumen = isEN
      ? `✅ Received. I saved your details:\n"${bodyRaw}"\n\nService: *${NOMBRE_SERV[s0.last_choice] || 'n/a'}*${CIERRE}`
      : `✅ Recibido. Guardé tus datos:\n"${bodyRaw}"\n\nServicio: *${NOMBRE_SERV[s0.last_choice] || 'n/a'}*${CIERRE}`;
    return sendTwilioXML(res, resumen);
  }

  // detectar elección por número/palabra/sinónimos
  const choice = matchChoice(bodyRaw, lang);
  if (choice) {
    await upsertSession(from, { last_choice: choice, awaiting_details: 1, details: null, lang, visits: visits + 1 });
    const composed = RESP[choice];
    return sendTwilioXML(res, composed);
  }

  // fallback → menú
  await upsertSession(from, { lang, visits: visits + 1 });
  return sendTwilioXML(res, MENU);
});

// =====================
// START
// =====================
app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bot Bilingüe escuchando en http://localhost:${PORT}`);
});