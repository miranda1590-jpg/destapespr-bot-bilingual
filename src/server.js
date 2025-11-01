import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import dayjs from 'dayjs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// =============================
// Config
// =============================
const PORT = process.env.PORT || 3000;
const TAG = 'Bilingual Bot v-4';    // Pie de marca
const FB_LINK = 'https://www.facebook.com/destapespr'; // opcional
const BRAND = `\n\n✅ Próximamente nos estaremos comunicando.\nGracias por su patrocinio.\n— DestapesPR\n\n${TAG} • 🇵🇷`;

// =============================
// Helpers
// =============================
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

function looksEnglish(text) {
  const t = norm(text);
  // si el usuario escribe "english" o más de 3 palabras inglesas típicas…
  if (/^english$|^eng$/i.test(text)) return true;
  const hits = ['hello','hi','i need','schedule','appointment','leak','clog','camera','heater','other'];
  return hits.some(w => t.includes(w));
}

// Teléfonos PR/USA
const PHONE_RE = /\b(?:(?:\+?1[-.\s]?)?(?:\(?\s*(?:787|939|2\d{2}|3\d{2}|4\d{2}|5\d{2}|6\d{2}|7\d{2}|8\d{2}|9\d{2})\s*\)?)[-.\s]?\d{3}[-.\s]?\d{4})\b/;

// =============================
// SQLite: sesiones
// =============================
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

async function initDB() {
  if (db) return db;
  db = await open({ filename: './sessions.db', driver: sqlite3.Database });
  // migración segura
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number   TEXT PRIMARY KEY,
      lang          TEXT,
      last_choice   TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details_name  TEXT,
      details_phone TEXT,
      details_area  TEXT,
      details_time  TEXT,
      last_active   INTEGER
    );
  `);
  // purga
  await db.run('DELETE FROM sessions WHERE last_active < ?', Date.now() - SESSION_TTL_MS);
  return db;
}
async function getSession(from) {
  return db.get('SELECT * FROM sessions WHERE from_number=?', from);
}
async function upsertSession(from, patch = {}) {
  const prev = (await getSession(from)) || {};
  const now  = Date.now();
  const next = {
    lang: patch.lang ?? prev.lang ?? 'es',
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details_name:  patch.details_name  ?? prev.details_name  ?? null,
    details_phone: patch.details_phone ?? prev.details_phone ?? null,
    details_area:  patch.details_area  ?? prev.details_area  ?? null,
    details_time:  patch.details_time  ?? prev.details_time  ?? null,
    last_active: now
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
async function clearSession(from) {
  await db.run('DELETE FROM sessions WHERE from_number=?', from);
}

// =============================
// Textos ES/EN
// =============================
const MENU_ES =
`🇵🇷 *Bienvenido a DestapesPR* 💧

Escribe el número o la palabra del servicio:

1 – Destape (drenajes/tuberías tapadas)
2 – Fuga (fugas de agua/filtraciones)
3 – Cámara (inspección con cámara)
4 – Calentador (gas o eléctrico)
5 – Otro (consulta general)
6 – Cita (programar/coordinar)

Comandos: "inicio", "menu", "volver"
Para inglés: escribe "english"

— DestapesPR | ${TAG}`;

const MENU_EN =
`🇵🇷 *Welcome to DestapesPR* 💧

Type the number or the word of the service:

1 – Unclog (drains/blocked lines)
2 – Leak (water leaks/filtration)
3 – Camera (pipe inspection)
4 – Water heater (gas/electric)
5 – Other (general inquiry)
6 – Schedule (book an appointment)

Commands: "start", "menu", "back"
For Spanish: type "español"

— DestapesPR | ${TAG}`;

const FORM_ES =
`*Vamos a coordinar*. Por favor envía en *un solo mensaje*:
👤 *Nombre* completo
📞 *Número* (787/939 o EE. UU.)
📍 *Zona* (municipio/sector) y *línea* (fregadero, inodoro, principal, etc.)
⏰ *Horario* disponible

*Ejemplo:*
"Me llamo Ana Rivera, 939-555-9999, Caguas, inodoro, 10am–1pm"`;

const FORM_EN =
`*Let's coordinate*. Please send *in one single message*:
👤 *Full name*
📞 *Phone* (US/PR)
📍 *Area* (city/sector) and *line* (kitchen sink, toilet, main, etc.)
⏰ *Available time*

*Example:*
"My name is Ana Rivera, +1 939-555-9999, Caguas, toilet, 10am–1pm"`;

// Opción → descripción + formulario (sin links de cita)
const SERVICE_TEXT = {
  es: {
    destape: `🛠️ *Destape* — drenajes y tuberías tapadas.\n${FORM_ES}${BRAND}`,
    fuga:    `💦 *Fuga* — localizamos y reparamos fugas/filtraciones.\n${FORM_ES}${BRAND}`,
    camara:  `📹 *Cámara* — inspección con video para diagnosticar tuberías.\n${FORM_ES}${BRAND}`,
    calentador: `🔥 *Calentador* — eléctrico o gas (instalación/diagnóstico).\n${FORM_ES}${BRAND}`,
    otro:    `📝 *Otro* — cuéntame tu necesidad.\n${FORM_ES}${BRAND}`,
    cita:    `📅 *Cita* — para coordinar por WhatsApp, envía tus datos.\n${FORM_ES}${BRAND}`
  },
  en: {
    destape: `🛠️ *Unclog* — blocked drains/lines.\n${FORM_EN}${BRAND}`,
    fuga:    `💦 *Leak* — find and fix water leaks.\n${FORM_EN}${BRAND}`,
    camara:  `📹 *Camera* — video inspection.\n${FORM_EN}${BRAND}`,
    calentador: `🔥 *Water heater* — electric/gas (install/diagnose).\n${FORM_EN}${BRAND}`,
    otro:    `📝 *Other* — tell me your need.\n${FORM_EN}${BRAND}`,
    cita:    `📅 *Schedule* — to book via WhatsApp, send your details.\n${FORM_EN}${BRAND}`
  }
};

const CHOICE_MAP = {
  '1': 'destape', 'destape':'destape', 'unclog':'destape',
  '2': 'fuga', 'fuga':'fuga', 'leak':'fuga',
  '3': 'camara', 'cámara':'camara', 'camera':'camara',
  '4': 'calentador', 'heater':'calentador', 'water heater':'calentador',
  '5': 'otro', 'other':'otro',
  '6': 'cita', 'schedule':'cita', 'appointment':'cita'
};

// =============================
// Parsing del mensaje de datos
// =============================
function parseDetails(raw) {
  const text = raw.trim();
  const phoneMatch = text.match(PHONE_RE);
  const phone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g,'') : null;

  // heurística simple:
  //  - nombre: todo lo previo al teléfono (si existe), si no, primeras 3–6 palabras
  //  - horario: ventana con am/pm o rango con "-" o "–"
  const timeMatch = text.match(/\b(\d{1,2}\s?(?:am|pm)|\d{1,2}:\d{2}\s?(?:am|pm))\s?[-–]\s?(\d{1,2}\s?(?:am|pm)|\d{1,2}:\d{2}\s?(?:am|pm))\b/i);
  const time = timeMatch ? timeMatch[0] : null;

  let name = null, area = null;

  if (phone) {
    const [before, after] = text.split(phoneMatch[0]);
    // nombre en "before"
    name = before.replace(/^\s*me llamo|^soy|^my name is/i,'').replace(/[,;:]/g,' ').trim();
    // área en "after"
    area = (after || '').replace(/[,;]?\s*(en|in)\s+/i,' ').trim();
  } else {
    // sin teléfono: toma primeras 5 palabras como nombre aproximado
    const words = text.split(/\s+/);
    name = words.slice(0, Math.min(6, words.length)).join(' ');
    area = text;
  }

  // limpieza básica
  name = name ? name.replace(/["“”]/g,'').trim() : null;
  area = area ? area.replace(/["“”]/g,'').trim() : null;

  // validación mínima
  const ok = Boolean(name && (phone || /939|787|\+1/.test(text)) && area);
  return { ok, name, phone, area, time };
}

// =============================
// Twilio XML response
// =============================
function twiml(text) {
  const safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

// =============================
// Rutas utilitarias
// =============================
app.get('/__version', (_req,res)=> res.json({ ok:true, tag: TAG, ts: dayjs().toISOString() }));
app.get('/health', (_req,res)=> res.json({ ok:true }));

// =============================
// Webhook WhatsApp
// =============================
app.post('/webhook/whatsapp', async (req, res) => {
  await initDB();

  const from = String(req.body.From || req.body.from || req.body.WaId || '').trim();
  const bodyRaw = String(req.body.Body || req.body.body || '').trim();
  const body = norm(bodyRaw);

  // Comandos reset
  if (!body || ['inicio','menu','volver','start','menu','back'].includes(body)) {
    await clearSession(from);
    const lang = looksEnglish(bodyRaw) ? 'en' : 'es';
    const menu = lang === 'en' ? MENU_EN : MENU_ES;
    return res.type('application/xml').send(twiml(menu));
  }

  // Selección de idioma
  if (/^english$/i.test(bodyRaw) || looksEnglish(bodyRaw)) {
    await upsertSession(from, { lang: 'en' });
  } else if (/espanol|español/.test(body)) {
    await upsertSession(from, { lang: 'es' });
  }

  const sess0 = (await getSession(from)) || { lang: looksEnglish(bodyRaw) ? 'en' : 'es' };
  const lang = sess0.lang || (looksEnglish(bodyRaw) ? 'en' : 'es');

  // ¿Seleccionó opción?
  const choice = CHOICE_MAP[body] || null;
  if (choice) {
    await upsertSession(from, { lang, last_choice: choice, awaiting_details: 1, details_name:null, details_phone:null, details_area:null, details_time:null });
    const txt = SERVICE_TEXT[lang][choice];
    return res.type('application/xml').send(twiml(txt));
  }

  // Si está esperando detalles, intentar parseo
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

      const svcLabel = {
        es: { destape:'destape', fuga:'fuga', camara:'cámara', calentador:'calentador', otro:'otro', cita:'cita' },
        en: { destape:'unclog',  fuga:'leak',  camara:'camera',  calentador:'water heater', other:'other', cita:'schedule' }
      };
      const map = svcLabel[lang] || svcLabel.es;
      const label = map[sess.last_choice] || sess.last_choice;

      const confirm =
        (lang === 'en'
          ? `✅ *Received*. I saved your details:\n"${det.name}, ${det.phone || ''}, ${det.area}${det.time ? ', ' + det.time : ''}"\n\n*Service:* ${label}${BRAND}`
          : `✅ *Recibido*. Guardé tus datos:\n"${det.name}, ${det.phone || ''}, ${det.area}${det.time ? ', ' + det.time : ''}"\n\n*Servicio:* ${label}${BRAND}`);

      return res.type('application/xml').send(twiml(confirm));
    }

    // Faltan campos → volver a pedir en mismo idioma y NO cambiar estado
    const askAgain =
      lang === 'en'
        ? `⚠️ I couldn't read all fields. Please send *in one message*:\n${FORM_EN}${BRAND}`
        : `⚠️ No pude leer todos los campos. Por favor envía *en un solo mensaje*:\n${FORM_ES}${BRAND}`;

    return res.type('application/xml').send(twiml(askAgain));
  }

  // Caso por defecto: menú
  const menu = lang === 'en' ? MENU_EN : MENU_ES;
  return res.type('application/xml').send(twiml(menu));
});

// =============================
// Boot
// =============================
app.get('/', (_req,res)=> res.send('DestapesPR Bilingual Bot OK'));
app.listen(PORT, () => console.log(`💬 DestapesPR Bilingual Bot escuchando en http://localhost:${PORT}`));