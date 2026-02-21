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
const PHONE                = process.env.BRAND_PHONE         || '+1 787-922-0068';
const FB_LINK              = process.env.BRAND_FB            || 'https://www.facebook.com/DestapesPR';
const APPS_SCRIPT_URL      = process.env.APPS_SCRIPT_URL     || '';
const APPS_SCRIPT_TOKEN    = process.env.APPS_SCRIPT_TOKEN   || '';
const ADMIN_WHATSAPP       = process.env.ADMIN_ALERT_TO      || '';
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID  || '';
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN   || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_PHONE_NUMBER || '';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
let db;

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

function menuText(lang) {
  if (lang === 'en') {
    return `👋 Welcome to DestapesPR.\n\nSelect a number:\n1️⃣ Drain cleaning\n2️⃣ Water leak\n3️⃣ Camera inspection\n4️⃣ Water heater\n5️⃣ Other service\n6️⃣ Appointment\n\n💬 Commands: "menu", "start"\n🌐 Type "español" for Spanish\n\n📘 Facebook: ${FB_LINK}\n📞 Phone: ${PHONE}`;
  }
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número:\n1️⃣ Destape\n2️⃣ Fuga de agua\n3️⃣ Inspección con cámara\n4️⃣ Calentador\n5️⃣ Otro servicio\n6️⃣ Cita / coordinar visita\n\n💬 Comandos: "inicio", "menu"\n🌐 Escribe "english" para inglés\n\n📘 Facebook: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

function leadPrompt(service, lang) {
  const names = { destape: { es: 'Destape', en: 'Drain cleaning' }, fuga: { es: 'Fuga de agua', en: 'Water leak' }, camara: { es: 'Cámara', en: 'Camera' }, calentador: { es: 'Calentador', en: 'Heater' }, cita: { es: 'Cita', en: 'Appointment' } };
  const sName = names[service]?.[lang] || (lang === 'en' ? 'Service' : 'Servicio');
  if (lang === 'en') {
    return `✅ Service: ${sName}\nPlease send in ONE message:\n• 👤 Name\n• 📞 Phone\n• 📍 City\n• 📝 Problem\n\nExample: "Ana Rivera, 939-555-9999, San Juan, clogged sink"`;
  }
  return `✅ Servicio: ${sName}\nEnvía TODO en UN solo mensaje:\n• 👤 Nombre\n• 📞 Teléfono\n• 📍 Municipio\n• 📝 Descripción\n\nEjemplo: "Ana Rivera, 939-555-9999, Caguas, fregadero tapado"`;
}

async function sendWhatsApp(to, text) {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: TWILIO_WHATSAPP_FROM, Body: text })
    });
  } catch (e) { console.error("Error sending WA:", e); }
}const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  
  const key = from;
  let row = await db.get('SELECT v FROM sessions WHERE k=?', key);
  let session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu' };

  if (lower.includes('english')) session.lang = 'en';
  if (lower.includes('español') || lower.includes('espanol')) session.lang = 'es';

  // Si el cliente saluda o pide el menú, reseteamos
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
      session.step = 'lead';
      responseMsg = leadPrompt(session.service, session.lang);
    } else {
      responseMsg = menuText(session.lang);
    }
  } 
  else if (session.step === 'lead') {
    // EL ARREGLO: Guardamos lo que sea que mande como "detalles" para asegurar que avance
    session.details = body;
    session.case_id = `DP-${Date.now().toString().slice(-4)}`;
    
    // Avanzamos al siguiente paso obligatoriamente
    session.step = 'ask_schedule';
    
    // Intentar subir al CRM y alertar (sin bloquear el flujo)
    try {
        const adminMsg = `🆕 *NUEVO LEAD*\nServicio: ${session.service}\nWA: ${from}\nDatos: ${body}`;
        if (ADMIN_WHATSAPP) await sendWhatsApp(ADMIN_WHATSAPP, adminMsg);
    } catch(e) {}

    responseMsg = session.lang === 'en' 
      ? `📅 Thank you! Would you like to schedule an appointment now? (Reply YES or NO)` 
      : `📅 ¡Gracias! ¿Te gustaría agendar una cita ahora mismo? (Responde SI o NO)`;
  }
  else if (session.step === 'ask_schedule') {
    if (['si', 'sí', 'yes', 'y', 's'].includes(lower)) {
      responseMsg = session.lang === 'en' ? "📅 Checking availability..." : "📅 Consultando disponibilidad...";
      // Aquí iría la lógica de slots de tu Google Calendar
    } else {
      responseMsg = session.lang === 'en' ? "✅ No problem! We will contact you soon." : "✅ ¡No hay problema! Te contactaremos pronto.";
      session.step = 'menu';
    }
  }

  await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMsg}</Message></Response>`);
};

app.post('/webhook/whatsapp', handler);
initDB().then(() => app.listen(PORT, () => console.log(`Bot DestapesPR funcionando 🚀`)));
