/* DEPLOY_BUMP: final_fix */
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fetch from 'node-fetch';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;
const PHONE = process.env.BRAND_PHONE || '+1 787-922-0068';
const FB_LINK = process.env.BRAND_FB || 'https://www.facebook.com/DestapesPR';

let db;
// Plan B: Memoria temporal si falla la DB
const memorySessions = new Map();

async function initDB() {
  try {
    db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
  } catch (err) {
    console.error("❌ Error al iniciar DB, usando memoria temporal");
  }
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

function menuText(lang) {
  if (lang === 'en') return `👋 Welcome to DestapesPR.\n\nChoose a number:\n1️⃣ Drain cleaning\n2️⃣ Water leak\n3️⃣ Camera inspection\n4️⃣ Water heater\n5️⃣ Other\n6️⃣ Appointment\n\n🌐 Type "español" for Spanish\n📘 FB: ${FB_LINK}\n📞 Tel: ${PHONE}`;
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número:\n1️⃣ Destape\n2️⃣ Fuga de agua\n3️⃣ Inspección con cámara\n4️⃣ Calentador\n5️⃣ Otro servicio\n6️⃣ Cita\n\n🌐 Escribe "english" para inglés\n📘 FB: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  const key = from;

  // Cargar sesión (DB o Memoria)
  let session;
  try {
    const row = await db.get('SELECT v FROM sessions WHERE k=?', key);
    session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu' };
  } catch {
    session = memorySessions.get(key) || { lang: 'es', step: 'menu' };
  }

  if (lower.includes('english')) session.lang = 'en';
  if (lower.includes('español') || lower.includes('espanol')) session.lang = 'es';

  // Saludos reinician el flujo
  if (['hola', 'hello', 'hi', 'menu', 'inicio'].includes(lower)) {
    session.step = 'menu';
    responseMsg(res, menuText(session.lang));
    return saveSession(key, session);
  }

  let msg = "";
  if (session.step === 'menu') {
    const choices = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro', '6':'cita' };
    if (choices[body]) {
      session.service = choices[body];
      session.step = 'lead';
      msg = session.lang === 'en' ? `✅ Service: ${session.service}\nPlease send: Name, Phone, City and Problem.` : `✅ Servicio: ${session.service}\nEnvía: Nombre, Teléfono, Municipio y Problema.`;
    } else {
      msg = menuText(session.lang);
    }
  } else if (session.step === 'lead') {
    session.step = 'ask_schedule';
    msg = session.lang === 'en' ? "📅 Schedule now? (YES/NO)" : "📅 ¿Deseas agendar ahora? (SI/NO)";
  } else if (session.step === 'ask_schedule') {
    if (['si', 'yes', 's'].includes(lower)) {
      msg = session.lang === 'en' ? "📅 Checking slots..." : "📅 Consultando horarios...";
      session.step = 'menu'; // Reinicio tras finalizar
    } else {
      msg = menuText(session.lang);
      session.step = 'menu';
    }
  }

  responseMsg(res, msg);
  await saveSession(key, session);
};

async function saveSession(key, session) {
  try {
    await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
  } catch {
    memorySessions.set(key, session);
  }
}

function responseMsg(res, msg) {
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`);
}

app.post('/webhook/whatsapp', handler);
initDB().then(() => app.listen(PORT, () => console.log(`Bot corregido en puerto ${PORT}`)));
