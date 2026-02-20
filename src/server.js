/* DEPLOY_BUMP: auto */
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

const PORT                 = process.env.PORT                || 10000;
const TAG                  = process.env.TAG                 || 'DestapesPR Bot 🇵🇷';
const PHONE                = process.env.BRAND_PHONE         || process.env.PHONE || '+1 787-922-0068';
const FB_LINK              = process.env.BRAND_FB            || 'https://www.facebook.com/DestapesPR';
const APPS_SCRIPT_URL      = process.env.APPS_SCRIPT_URL     || '';
const APPS_SCRIPT_TOKEN    = process.env.APPS_SCRIPT_TOKEN   || '';
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN   || '';

const SESSION_TTL_MS   = 48 * 60 * 60 * 1000;
let db;

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

// Detección mejorada de saludos
function isHello(text) {
  const common = ['hola', 'hello', 'hi', 'hey', 'buenas', 'saludos', 'start', 'inicio', 'menu'];
  return common.includes(norm(text));
}

function menuText(lang) {
  if (lang === 'en') {
    return `👋 Welcome to DestapesPR.\n\nChoose a number:\n1️⃣ Drain cleaning\n2️⃣ Water leak\n3️⃣ Camera inspection\n4️⃣ Water heater\n5️⃣ Other\n6️⃣ Appointment\n\n💬 Commands: "menu", "back"\n🌐 Type "español" for Spanish\n\n📘 Facebook: ${FB_LINK}\n📞 Phone: ${PHONE}`;
  }
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número:\n1️⃣ Destape\n2️⃣ Fuga de agua\n3️⃣ Inspección con cámara\n4️⃣ Calentador\n5️⃣ Otro servicio\n6️⃣ Cita / coordinar visita\n\n💬 Comandos: "inicio", "menu"\n🌐 Escribe "english" para inglés\n\n📘 Facebook: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

function leadPrompt(service, lang) {
  const names = { destape: { es: 'Destape', en: 'Drain cleaning' }, fuga: { es: 'Fuga', en: 'Leak' }, camara: { es: 'Cámara', en: 'Camera' }, calentador: { es: 'Calentador', en: 'Heater' }, cita: { es: 'Cita', en: 'Appointment' } };
  const sName = names[service]?.[lang] || (lang === 'en' ? 'Service' : 'Servicio');
  if (lang === 'en') {
    return `✅ Service: ${sName}\nPlease send in ONE message:\n• 👤 Full name\n• 📞 Phone\n• 📍 City\n• 📝 Description\n\nExample: "My name is Ana Rivera, 939-555-9999, San Juan, clogged sink"`;
  }
  return `✅ Servicio: ${sName}\nEnvía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Teléfono\n• 📍 Municipio\n• 📝 Descripción\n\nEjemplo: "Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero tapado"`;
}const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  
  const key = from;
  let row = await db.get('SELECT v FROM sessions WHERE k=?', key);
  let session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu' };

  // Cambio de idioma y reconocimiento de saludos (hello, hi, etc.)
  if (lower.includes('english')) session.lang = 'en';
  if (lower.includes('español') || lower.includes('espanol')) session.lang = 'es';

  // Si el mensaje es un saludo o comando de inicio, reiniciamos al menú
  if (isHello(body)) {
    session.step = 'menu';
    await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${menuText(session.lang)}</Message></Response>`;
    return res.type('text/xml').send(twiml);
  }

  let responseMsg = "";
  if (session.step === 'menu') {
    const choices = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro', '6':'cita' };
    if (choices[body]) {
      session.service = choices[body];
      session.step = 'lead';
      responseMsg = leadPrompt(session.service, session.lang);
    } else {
      responseMsg = menuText(session.lang);
    }
  } else if (session.step === 'lead') {
    // Procesa datos del cliente (ejemplo: Ana Rivera)
    responseMsg = session.lang === 'en' ? "📅 Would you like to schedule now? (YES/NO)" : "📅 ¿Deseas agendar ahora? (SI/NO)";
    session.step = 'ask_schedule';
  } else {
    responseMsg = menuText(session.lang);
    session.step = 'menu';
  }

  await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
  const finalTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMsg}</Message></Response>`;
  res.type('text/xml').send(finalTwiml);
};

app.post('/webhook/whatsapp', handler);
initDB().then(() => app.listen(PORT, () => console.log(`${TAG} corrigiendo "hello" activo en puerto ${PORT}`)));
