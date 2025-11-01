// server.js — DestapesPR | Bilingual Bot V-4 🤖🇵🇷
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// ====== Config ======
const PORT = Number(process.env.PORT || 10000);
const TZ = process.env.TZ || 'America/Puerto_Rico';

// Footer de marca para TODAS las respuestas
const FOOTER = '\n\n— DestapesPR | Bilingual Bot V-4 🤖🇵🇷';

// Utilidad para asegurar footer en cada respuesta
function withFooter(text) {
  const t = String(text ?? '');
  return t.endsWith(FOOTER) ? t : t + FOOTER;
}

// Normalización básica
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

// ====== App ======
const app = express();
app.use(express.urlencoded({ extended: true })); // Twilio manda form-encoded
app.use(express.json());
app.use(morgan('dev'));

// ====== SQLite (sessions) ======
let db;

async function initDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });

  // Tabla base
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      visits INTEGER DEFAULT 0,
      last_active INTEGER
    );
  `);

  // Migraciones defensivas (añadir columnas si faltan)
  const pragma = await db.get(`PRAGMA table_info(sessions);`);
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const names = new Set(cols.map(c => c.name));
  const addCol = async (name, def) => {
    if (!names.has(name)) {
      await db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${def};`);
    }
  };
  await addCol('lang', 'TEXT');
  await addCol('last_choice', 'TEXT');
  await addCol('awaiting_details', 'INTEGER DEFAULT 0');
  await addCol('details', 'TEXT');
  await addCol('visits', 'INTEGER DEFAULT 0');
  await addCol('last_active', 'INTEGER');

  return db;
}

async function getSession(from) {
  return db.get('SELECT * FROM sessions WHERE from_number = ?', from);
}

async function upsertSession(from, patch = {}) {
  const prev = (await getSession(from)) || {};
  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    visits: (patch.visits ?? prev.visits ?? 0),
    last_active: Date.now()
  };

  await db.run(
    `
    INSERT INTO sessions (from_number, lang, last_choice, awaiting_details, details, visits, last_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      lang=excluded.lang,
      last_choice=excluded.last_choice,
      awaiting_details=excluded.awaiting_details,
      details=excluded.details,
      visits=excluded.visits,
      last_active=excluded.last_active
    `,
    [from, next.lang, next.last_choice, next.awaiting_details, next.details, next.visits, next.last_active]
  );
  return next;
}

async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number = ?', from);
}

// ====== Idiomas y contenido ======
const MENU_ES = `🇵🇷 *Bienvenido a DestapesPR* 💧

Escribe el *número* o la *palabra* del servicio:
1 – Destape (drenajes/tuberías tapadas)
2 – Fuga (fugas de agua/filtraciones)
3 – Cámara (inspección con cámara)
4 – Calentador (gas o eléctrico)
5 – Otro (consulta general)

Comandos: "inicio", "menu", "volver"
Para inglés: escribe "english"
`;

const MENU_EN = `🇵🇷 *Welcome to DestapesPR* 💧

Type the *number* or *word* of your service:
1 – Unclog (drains/blocked lines)
2 – Leak (water leaks/dampness)
3 – Camera (camera inspection)
4 – Heater (gas or electric)
5 – Other (general inquiry)

Commands: "start", "menu", "back"
For Spanish: type "espanol"
`;

// Mensajes por servicio (ES)
const SERVICE_ES = {
  destape: `🛠️ *Destape*  
Vamos a coordinar. Por favor envía en *un solo mensaje*:
👤 Nombre completo  
📞 Número (787/939 o EE. UU.)  
📍 Zona (municipio/sector)  
📝 Qué línea está tapada (fregadero, inodoro, principal, etc.)  
⏰ Horario disponible

*Ejemplo:*  
"Me llamo Ana Rivera, 939-555-9999, Caguas, inodoro, 10am-1pm"`,
  fuga: `💧 *Fuga*  
Para continuar envía en *un solo mensaje*:  
👤 Nombre completo  
📞 Número (787/939 o EE. UU.)  
📍 Zona (municipio/sector)  
📝 Dónde notas la fuga o humedad (dentro/fuera)  
⏰ Horario disponible`,
  camara: `🎥 *Inspección con cámara*  
Por favor envía:  
👤 Nombre completo  
📞 Número (787/939 o EE. UU.)  
📍 Zona (municipio/sector)  
📝 Área a inspeccionar (baño, cocina, línea principal)  
⏰ Horario disponible`,
  calentador: `🔥 *Calentador (gas/eléctrico)*  
Indica en *un solo mensaje*:  
👤 Nombre completo  
📞 Número (787/939 o EE. UU.)  
📍 Zona (municipio/sector)  
📝 Tipo de calentador y problema  
⏰ Horario disponible`,
  otro: `🧰 *Otro servicio / Consulta*  
Envíanos:  
👤 Nombre completo  
📞 Número (787/939 o EE. UU.)  
📍 Zona (municipio/sector)  
📝 Descripción breve del servicio  
⏰ Horario disponible`
};

// Mensajes por servicio (EN)
const SERVICE_EN = {
  destape: `🛠️ *Unclog*  
Please send *one message* with:  
👤 Full name  
📞 Phone (+1 / 787 / 939)  
📍 Area (city/sector)  
📝 Which line is blocked (sink, toilet, main, etc.)  
⏰ Available time`,
  fuga: `💧 *Leak*  
Please send:  
👤 Full name  
📞 Phone (+1 / 787 / 939)  
📍 Area (city/sector)  
📝 Where you see the leak/dampness (inside/outside)  
⏰ Available time`,
  camara: `🎥 *Camera inspection*  
Please send:  
👤 Full name  
📞 Phone (+1 / 787 / 939)  
📍 Area (city/sector)  
📝 Area to inspect (bathroom, kitchen, main line)  
⏰ Available time`,
  calentador: `🔥 *Heater (gas/electric)*  
Please send:  
👤 Full name  
📞 Phone (+1 / 787 / 939)  
📍 Area (city/sector)  
📝 Heater type and issue  
⏰ Available time`,
  otro: `🧰 *Other service / Question*  
Please send:  
👤 Full name  
📞 Phone (+1 / 787 / 939)  
📍 Area (city/sector)  
📝 Brief description  
⏰ Available time`
};

// Cierre (ES/EN)
const CLOSE_ES = `✅ Próximamente nos estaremos comunicando.  
Gracias por su patrocinio.`;
const CLOSE_EN = `✅ We will contact you shortly.  
Thank you for your business.`;

// Detección simple de idioma
function detectLang(s, sessionLang = 'es') {
  const b = norm(s);
  if (/\benglish\b|\benglish please\b|\ben\b/.test(b)) return 'en';
  if (/\bespanol\b|\bespañol\b|\bes\b/.test(b)) return 'es';
  // Heurística por palabras clave
  const esHits = /(destape|fuga|camara|c[áa]mara|calentador|municipio|sector|cita|volver|menu|inicio)/.test(b);
  const enHits = /(unclog|leak|camera|heater|city|sector|appointment|back|menu|start)/.test(b);
  if (enHits && !esHits) return 'en';
  if (esHits && !enHits) return 'es';
  return sessionLang || 'es';
}

// Matching de opción (número/palabra/sinónimos)
const MAP_NUM = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro' };
const KEYWORDS = {
  es: {
    destape: ['destape','tapon','tapada','obstruccion','drenaje','fregadero','inodoro','principal'],
    fuga: ['fuga','salidero','humedad','filtracion','goteo'],
    camara: ['camara','cámara','inspeccion','video'],
    calentador: ['calentador','boiler','agua caliente','gas','electrico','eléctrico'],
    otro: ['otro','consulta','presupuesto','cotizacion','cotización','servicio']
  },
  en: {
    destape: ['unclog','clog','blocked','drain','sink','toilet','main'],
    fuga: ['leak','leaking','damp','water leak'],
    camara: ['camera','inspection','scope','video'],
    calentador: ['heater','boiler','water heater','gas','electric'],
    otro: ['other','question','quote','estimate','service']
  }
};

function matchChoice(bodyRaw, lang) {
  const b = norm(bodyRaw);
  if (MAP_NUM[b]) return MAP_NUM[b];
  const dict = KEYWORDS[lang] || KEYWORDS.es;
  for (const [choice, arr] of Object.entries(dict)) {
    if (arr.some(k => b.includes(k))) return choice;
  }
  return null;
}

// ====== Endpoints ======
app.get('/__version', (_req, res) => {
  res.json({ ok:true, tag:'V4-PR-FOOTER', tz: TZ });
});

app.get('/', (_req, res) => {
  res.send('DestapesPR Bot 🇵🇷 OK' + FOOTER);
});

// ====== Webhook ======
app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from = (req.body.From || req.body.from || req.body.WaId || '').toString();
  const bodyRaw = (req.body.Body || req.body.body || '').toString();
  const body = norm(bodyRaw);

  // Cargar/crear sesión
  let s = (await getSession(from)) || { lang: 'es', visits: 0 };
  let lang = detectLang(bodyRaw, s.lang);

  // Comandos globales
  const goMenu = (lang === 'en')
    ? withFooter(MENU_EN)
    : withFooter(MENU_ES);

  if (!body || ['inicio','menu','volver','start','menu','back','hola','hello','hi'].includes(body)) {
    await upsertSession(from, { lang, last_choice: null, awaiting_details: 0, details: null, visits: (s.visits ?? 0) + 1 });
    return sendTwilioXML(res, goMenu);
  }

  // Cambios explícitos de idioma
  if (['english','en'].includes(body)) {
    lang = 'en';
    await upsertSession(from, { lang, last_choice: null, awaiting_details: 0, details: null });
    return sendTwilioXML(res, withFooter(MENU_EN));
  }
  if (['espanol','español','es'].includes(body)) {
    lang = 'es';
    await upsertSession(from, { lang, last_choice: null, awaiting_details: 0, details: null });
    return sendTwilioXML(res, withFooter(MENU_ES));
  }

  // Si envía una opción válida → pedimos datos en un solo mensaje
  const choice = matchChoice(bodyRaw, lang);
  if (choice) {
    const reply = (lang === 'en') ? SERVICE_EN[choice] : SERVICE_ES[choice];
    await upsertSession(from, { lang, last_choice: choice, awaiting_details: 1, details: null });
    const closing = (lang === 'en') ? CLOSE_EN : CLOSE_ES;
    return sendTwilioXML(res, withFooter(`${reply}\n\n${closing}\n\n(${lang==='en'?'Type "back" to return to the menu':'Escribe "volver" para regresar al menú'})`));
  }

  // Si estamos esperando detalles → guardamos y confirmamos
  s = await getSession(from);
  if (s?.awaiting_details && s?.last_choice) {
    await upsertSession(from, { details: bodyRaw, awaiting_details: 0 });

    if (lang === 'en') {
      const reply = `✅ *Received.* I saved your details:\n"${bodyRaw}"\n\n*Service:* ${serviceLabel('en', s.last_choice)}\n\n(${ 'Type "back" to return to the menu' })\n\n${CLOSE_EN}`;
      return sendTwilioXML(res, withFooter(reply));
    } else {
      const reply = `✅ *Recibido.* Guardé tus detalles:\n"${bodyRaw}"\n\n*Servicio:* ${serviceLabel('es', s.last_choice)}\n\n(${ 'Escribe "volver" para regresar al menú' })\n\n${CLOSE_ES}`;
      return sendTwilioXML(res, withFooter(reply));
    }
  }

  // Fallback → menú
  return sendTwilioXML(res, goMenu);
});

function serviceLabel(lang, key) {
  const mapES = { destape:'Destape', fuga:'Fuga', camara:'Cámara', calentador:'Calentador', otro:'Otro' };
  const mapEN = { destape:'Unclog', fuga:'Leak', camara:'Camera', calentador:'Heater', otro:'Other' };
  return (lang === 'en' ? mapEN : mapES)[key] ?? key;
}

function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set('Content-Type', 'application/xml');
  return res.status(200).send(xml);
}

// ====== Start ======
app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bilingual Bot V-4 listening on http://localhost:${PORT}`);
});