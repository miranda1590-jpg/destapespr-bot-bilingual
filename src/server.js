/* DEPLOY_BUMP: bilingual_final */
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fetch from 'node-fetch';
import crypto from 'crypto';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT = process.env.PORT || 10000;
const TAG = 'DestapesPR Bot 🇵🇷';
const PHONE = '+1 787-922-0068';
const FB_LINK = 'https://facebook.com/DestapesPR';
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || '';

let db;
async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

function menuText(lang) {
  if (lang === 'en') {
    return `👋 Welcome to DestapesPR.\n\nChoose a number or type what you need:\n1️⃣ Drain cleaning (clogged pipes)\n2️⃣ Water leak (drips / leaks)\n3️⃣ Camera inspection (video)\n4️⃣ Water heater (gas/electric/solar)\n5️⃣ Other plumbing service\n6️⃣ Appointment / schedule a visit\n\n💬 Commands: "start", "menu" or "back"\n🌐 Type "español" to switch language\n\n📘 Facebook: ${FB_LINK}\n📞 Phone: ${PHONE}`;
  }
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número o escribe lo que necesitas:\n1️⃣ Destape (drenajes o tuberías tapadas)\n2️⃣ Fuga de agua (goteos / filtraciones)\n3️⃣ Inspección con cámara (video)\n4️⃣ Calentador (gas/eléctrico/solar)\n5️⃣ Otro servicio de plomería\n6️⃣ Cita / coordinar visita\n\n💬 Comandos: "inicio", "menu" o "volver"\n🌐 Escribe "english" para cambiar idioma\n\n📘 Facebook: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

function leadPrompt(service, lang, heaterType) {
  const titles = { 
    destape: { es: 'Destape', en: 'Drain cleaning' }, 
    fuga: { es: 'Fuga de agua', en: 'Water leak' }, 
    calentador: { es: 'Calentador', en: 'Water heater' } 
  };
  const title = lang === 'en' ? `✅ Service: ${titles[service]?.en || 'Plumbing'}` : `✅ Servicio: ${titles[service]?.es || 'Plomería'}`;
  const typeLine = service === 'calentador' && heaterType ? (lang === 'en' ? `✅ Type: ${heaterType}` : `✅ Tipo: ${heaterType}`) : null;
  
  if (lang === 'en') {
    return [title, typeLine, `\nPlease send EVERYTHING in ONE message:\n• 👤 Full name\n• 📞 Contact number\n• 📍 City / area / sector\n• 📝 Short description of the problem\n\nExample:\n"My name is Ana Rivera, 939-555-9999, San Juan, clogged kitchen sink"\n\n🚨 Emergency? Call NOW for immediate assistance: ${PHONE}`].filter(Boolean).join('\n');
  }
  return [title, typeLine, `\nPor favor envía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Número de contacto\n• 📍 Municipio / zona / sector\n• 📝 Descripción breve del problema\n\nEjemplo:\n"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n\n🚨 ¿Emergencia? Llama AHORA para atención inmediata: ${PHONE}`].filter(Boolean).join('\n');
}const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  const key = from;

  let row = await db.get('SELECT v FROM sessions WHERE k=?', key);
  let session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu' };

  if (lower.includes('english')) session.lang = 'en';
  if (lower.includes('español') || lower.includes('espanol')) session.lang = 'es';

  if (['hola', 'hello', 'hi', 'menu', 'inicio'].includes(lower)) {
    session.step = 'menu';
    await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${menuText(session.lang)}</Message></Response>`);
  }

  let responseMsg = "";
  if (session.step === 'menu') {
    const choices = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro', '6':'cita' };
    if (choices[body]) {
      session.service = choices[body];
      session.step = session.service === 'calentador' ? 'heater_type' : 'lead';
      responseMsg = session.step === 'heater_type' ? (session.lang === 'en' ? "1️⃣ Solar\n2️⃣ Conventional\nReply 1 or 2" : "1️⃣ Solar\n2️⃣ Convencional\nResponde 1 o 2") : leadPrompt(session.service, session.lang);
    } else { responseMsg = menuText(session.lang); }
  } else if (session.step === 'lead') {
    responseMsg = session.lang === 'en' ? "📅 Do you want to schedule now? (YES/NO)" : "📅 ¿Deseas agendar ahora? (SI/NO)";
    session.step = 'ask_schedule';
  } else if (session.step === 'ask_schedule') {
    if (['si', 'yes', 's'].includes(lower)) {
      responseMsg = session.lang === 'en' ? "📅 Checking available slots..." : "📅 Consultando horarios disponibles...";
      session.step = 'menu';
    } else {
      responseMsg = session.lang === 'en' ? "✅ Thank you! We will contact you soon." : "✅ ¡Listo! Te contactaremos pronto.";
      session.step = 'menu';
    }
  }

  await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMsg}</Message></Response>`);
};

app.post('/webhook/whatsapp', handler);
initDB().then(() => app.listen(PORT, () => console.log(`${TAG} activo en puerto ${PORT}`)));

