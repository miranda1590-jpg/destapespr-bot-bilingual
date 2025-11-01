// src/server.js
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// =====================
// App
// =====================
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;

// =====================
// Branding, enlaces, contacto
// =====================
const FB_URL = 'https://www.facebook.com/profile.php?id=61569602833762';
const PHONE_HUMAN = '+1 (787) 922-0068';
const PHONE_TEL = 'tel:+17879220068';

// Footers por idioma (siempre al final)
const FOOTER_ES = `
📞 *Llámanos:* ${PHONE_HUMAN}
📘 *Facebook:* ${FB_URL}
— DestapesPR | Bilingual Bot V-4 🇵🇷💧`;

const FOOTER_EN = `
📞 *Call us:* ${PHONE_HUMAN}
📘 *Facebook:* ${FB_URL}
— DestapesPR | Bilingual Bot V-4 🇵🇷💧`;

// Link de cita SOLO en la opción 6
const LINK_CITA = 'https://wa.me/17879220068?text=Quiero%20agendar%20una%20cita';

// =====================
// Helpers
// =====================
const twiml = (text) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message></Response>`;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

const looksEnglish = (s) => {
  const t = norm(s);
  const enHits = ['the','please','service','leak','camera','heater','schedule','english','pipe','clog','unclog']
    .filter(w => t.includes(w)).length;
  const esHits = ['destape','fuga','camara','calentador','cita','agendar','hola','gracias','linea']
    .filter(w => t.includes(w)).length;
  return enHits > esHits;
};

// =====================
// SQLite (sessions)
// =====================
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details_name TEXT,
      details_phone TEXT,
      details_area TEXT,
      details_time TEXT,
      last_active INTEGER
    );
  `);

  // Migración defensiva
  const cols = (await db.all(`PRAGMA table_info(sessions)`)).map(r => r.name);
  const want = ['lang','last_choice','awaiting_details','details_name','details_phone','details_area','details_time','last_active'];
  for (const c of want) {
    if (!cols.includes(c)) {
      await db.exec(`ALTER TABLE sessions ADD COLUMN ${c} ${c.includes('awaiting') ? 'INTEGER DEFAULT 0' : 'TEXT'}`);
    }
  }

  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);
  return db;
}
async function getSession(from) { return db.get('SELECT * FROM sessions WHERE from_number = ?', from); }
async function upsertSession(from, patch) {
  const prev = (await getSession(from)) || {};
  const next = {
    lang: patch.lang ?? prev.lang ?? null,
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details_name: patch.details_name ?? prev.details_name ?? null,
    details_phone: patch.details_phone ?? prev.details_phone ?? null,
    details_area: patch.details_area ?? prev.details_area ?? null,
    details_time: patch.details_time ?? prev.details_time ?? null,
    last_active: Date.now()
  };
  await db.run(`
    INSERT INTO sessions (from_number, lang, last_choice, awaiting_details, details_name, details_phone, details_area, details_time, last_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      lang=excluded.lang,
      last_choice=excluded.last_choice,
      awaiting_details=excluded.awaiting_details,
      details_name=excluded.details_name,
      details_phone=excluded.details_phone,
      details_area=excluded.details_area,
      details_time=excluded.details_time,
      last_active=excluded.last_active
  `, [from, next.lang, next.last_choice, next.awaiting_details, next.details_name, next.details_phone, next.details_area, next.details_time, next.last_active]);
  return next;
}
async function clearSession(from) { await db.run('DELETE FROM sessions WHERE from_number = ?', from); }

// =====================
// Menús y textos
// =====================
const MENU_ES = `🇵🇷 *Bienvenido a DestapesPR* 💧

Escribe el número o la palabra del servicio que necesitas:

1 – *Destape* (drenajes/tuberías tapadas)
2 – *Fuga* (fugas de agua/filtraciones)
3 – *Cámara* (inspección con cámara)
4 – *Calentador* (gas o eléctrico)
5 – *Otro* (consulta general)
6 – *Cita* (agendar/coordinar)

Comandos: "inicio", "menu", "volver"
Para inglés: escribe "english"${FOOTER_ES}
`;

const MENU_EN = `🇵🇷 *Welcome to DestapesPR* 💧

Type the number or the word of the service you need:

1 – *Unclog* (drains/pipes)
2 – *Leak* (water leaks/filtration)
3 – *Camera* (inspection)
4 – *Heater* (gas or electric)
5 – *Other* (general question)
6 – *Schedule* (book an appointment)

Commands: "start", "menu", "back"
For Spanish: type "español"${FOOTER_EN}
`;

// Formulario ES/EN
const FORM_ES = `
*Por favor envía en un solo mensaje:*
• 👤 *Nombre completo*
• 📞 *Número (787/939 o EE. UU.)*
• 📍 *Zona (municipio/sector)*
• 🛠️ *Qué línea o equipo* (fregadero, inodoro, principal, calentador, etc.)
• ⏰ *Horario disponible*

*Ejemplo:*
"Me llamo Ana Rivera, 939-555-9999, Caguas, inodoro, 10am-1pm"`;

const FORM_EN = `
*Please send in one message:*
• 👤 *Full name*
• 📞 *Phone (USA or 787/939)*
• 📍 *Area (city/sector)*
• 🛠️ *Line or fixture* (sink, toilet, main line, heater, etc.)
• ⏰ *Available time*

*Example:*
"My name is Ana Rivera, 939-555-9999, Caguas, toilet, 10am-1pm"`;

// Textos por servicio (sin link de cita en 1–5; solo 6)
const SERVICE_TEXT = {
  es: {
    destape: `🧰 *Destape*\nVamos a coordinar. ${FORM_ES}\n\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.${FOOTER_ES}`,
    fuga: `💧 *Fuga*\nVamos a coordinar. ${FORM_ES}\n\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.${FOOTER_ES}`,
    camara: `📹 *Inspección con cámara*\nPor favor envía:\n${FORM_ES}\n\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.${FOOTER_ES}`,
    calentador: `🔥 *Calentador (gas o eléctrico)*\nPor favor envía:\n${FORM_ES}\n\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.${FOOTER_ES}`,
    otro: `📝 *Consulta general*\nCuéntame brevemente y añade:\n${FORM_ES}\n\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.${FOOTER_ES}`,
    cita: `📅 *Cita*\nAbrir para coordinar: ${LINK_CITA}\n\nSi prefieres, también puedes enviarnos:\n${FORM_ES}\n\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.${FOOTER_ES}`
  },
  en: {
    destape: `🧰 *Unclog*\nLet’s coordinate. ${FORM_EN}\n\n✅ We will contact you shortly.\nThank you for your business.${FOOTER_EN}`,
    leak: `💧 *Leak*\nLet’s coordinate. ${FORM_EN}\n\n✅ We will contact you shortly.\nThank you for your business.${FOOTER_EN}`,
    camara: `📹 *Camera inspection*\nPlease send:\n${FORM_EN}\n\n✅ We will contact you shortly.\nThank you for your business.${FOOTER_EN}`,
    heater: `🔥 *Water heater (gas/electric)*\nPlease send:\n${FORM_EN}\n\n✅ We will contact you shortly.\nThank you for your business.${FOOTER_EN}`,
    other: `📝 *General question*\nTell me briefly and add:\n${FORM_EN}\n\n✅ We will contact you shortly.\nThank you for your business.${FOOTER_EN}`,
    cita: `📅 *Schedule*\nOpen to coordinate: ${LINK_CITA}\n\nIf you prefer, you can also send:\n${FORM_EN}\n\n✅ We will contact you shortly.\nThank you for your business.${FOOTER_EN}`
  }
};

// Map de opciones
const CHOICE_MAP = {
  '1':'destape', destape:'destape', tapon:'destape', tapada:'destape', obstruccion:'destape', unclog:'destape', clog:'destape',
  '2':'fuga', fuga:'fuga', filtracion:'fuga', leak:'fuga',
  '3':'camara', camara:'camara', camera:'camara', inspection:'camara',
  '4':'calentador', calentador:'calentador', heater:'calentador',
  '5':'otro', otro:'otro', other:'otro',
  '6':'cita', cita:'cita', schedule:'cita', appointment:'cita'
};

// Parser detalles
const PHONE_RE = /(?:\+1[\s\-\.]?)?(?:(?:787|939)|(?:2\d{2}|3\d{2}|4\d{2}|5\d{2}|6\d{2}|7\d{2}|8\d{2}|9\d{2}))[\s\-\.]?\d{3}[\s\-\.]?\d{4}/;
const TIME_RE  = /\b(\d{1,2}\s?(?:am|pm)|\d{1,2}\s?-\s?\d{1,2}\s?(?:am|pm)|\d{1,2}[:.]\d{2}\s?(?:am|pm)|\d{1,2}\s?to\s?\d{1,2}\s?(?:am|pm))\b/i;

function parseDetails(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, msg: 'empty' };

  const phoneMatch = raw.match(PHONE_RE);
  const phone = phoneMatch ? phoneMatch[0].replace(/\D/g,'') : null;

  const timeMatch = raw.match(TIME_RE);
  const time = timeMatch ? timeMatch[0] : null;

  const parts = raw.split(/[,|\n]/).map(s => s.trim()).filter(Boolean);

  let name = null;
  for (const p of parts) {
    if (p.split(/\s+/).length >= 2 && !/\d{3,}/.test(p)) { name = p; break; }
  }

  let area = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (!p) continue;
    if (!PHONE_RE.test(p) && !TIME_RE.test(p)) { area = p; break; }
  }

  if (!name || !phone || !area) {
    return { ok: false, name: name || null, phone: phone || null, area: area || null, time: time || null };
  }
  return { ok: true, name, phone, area, time };
}

// Labels
const LABELS = {
  es: { service: 'Servicio', received: '✅ *Recibido*. Guardé tus datos:', closing: '✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.' },
  en: { service: 'Service',  received: '✅ *Received*. I saved your details:', closing: '✅ We will contact you shortly.\nThank you for your business.' }
};
const SERVICE_LABEL = {
  es: { destape:'destape', fuga:'fuga', camara:'cámara', calentador:'calentador', otro:'otro', cita:'cita' },
  en: { destape:'unclog',  fuga:'leak',  camara:'camera',  calentador:'heater',   otro:'other', cita:'schedule' }
};

// =====================
// Endpoints
// =====================
app.get('/__version', (_req, res) => {
  res.json({ ok: true, tag: 'BILINGUAL-V4', fb: FB_URL, phone: PHONE_HUMAN });
});

app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from = String(req.body.From || req.body.from || req.body.WaId || '').trim();
  const bodyRaw = String(req.body.Body || req.body.body || '').trim();
  const body = norm(bodyRaw);

  // Reset / menú
  if (!body || ['inicio','menu','volver','start','back'].includes(body)) {
    await clearSession(from);
    const lang = looksEnglish(bodyRaw) ? 'en' : 'es';
    const msg = lang === 'en' ? MENU_EN : MENU_ES;
    return res.type('application/xml').send(twiml(msg));
  }

  // Auto idioma
  if (/^english$/i.test(bodyRaw) || looksEnglish(bodyRaw)) {
    await upsertSession(from, { lang: 'en' });
  } else if (/espanol|español/.test(body)) {
    await upsertSession(from, { lang: 'es' });
  }

  const base = (await getSession(from)) || {};
  const lang = base.lang || (looksEnglish(bodyRaw) ? 'en' : 'es');

  // Si esperamos detalles, NO detectar keywords
  const sess = await getSession(from);
  if (sess?.awaiting_details && sess?.last_choice) {
    const det = parseDetails(bodyRaw);
    if (det.ok) {
      await upsertSession(from, {
        awaiting_details: 0,
        details_name: det.name,
        details_phone: det.phone,
        details_area: det.area,
        details_time: det.time ?? null
      });

      const labels = LABELS[lang] || LABELS.es;
      const svcMap = SERVICE_LABEL[lang] || SERVICE_LABEL.es;
      const svcName = svcMap[sess.last_choice] || sess.last_choice;

      const footer = lang === 'en' ? FOOTER_EN : FOOTER_ES;

      const confirm =
        `${labels.received}\n` +
        `"${det.name}, ${det.phone || ''}, ${det.area}${det.time ? ', ' + det.time : ''}"\n\n` +
        `*${labels.service}:* ${svcName}\n\n` +
        `${labels.closing}${footer}`;

      return res.type('application/xml').send(twiml(confirm));
    }

    const ask =
      lang === 'en'
        ? `⚠️ I couldn't read all fields. Please send the info again.\n${FORM_EN}${FOOTER_EN}`
        : `⚠️ No pude leer todos los campos. Por favor envíalos nuevamente.\n${FORM_ES}${FOOTER_ES}`;

    return res.type('application/xml').send(twiml(ask));
  }

  // Procesar elección (solo si NO esperamos detalles)
  const choice = CHOICE_MAP[body] || null;
  if (choice) {
    await upsertSession(from, {
      lang,
      last_choice: choice,
      awaiting_details: 1,
      details_name: null,
      details_phone: null,
      details_area: null,
      details_time: null
    });

    let txt;
    if (lang === 'en') {
      const key = (choice === 'fuga') ? 'leak'
               : (choice === 'calentador') ? 'heater'
               : (choice === 'camara') ? 'camara'
               : (choice === 'otro') ? 'other'
               : (choice === 'cita') ? 'cita'
               : 'destape';
      txt = SERVICE_TEXT.en[key];
    } else {
      txt = SERVICE_TEXT.es[choice];
    }

    return res.type('application/xml').send(twiml(txt));
  }

  // Por defecto → menú actual
  const menu = lang === 'en' ? MENU_EN : MENU_ES;
  return res.type('application/xml').send(twiml(menu));
});

// Health & root
app.get('/', (_req, res) => res.send('DestapesPR Bilingual Bot activo ✅'));

// Start
app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bilingual Bot escuchando en http://localhost:${PORT}`);
});