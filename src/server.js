/* DEPLOY_BUMP: final_v1_full */
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

const PORT                 = process.env.PORT                || 10000;
const TAG                  = 'DestapesPR Bot 🇵🇷';
const PHONE                = '+1 787-922-0068';
const FB_LINK              = 'https://facebook.com/DestapesPR';
const APPS_SCRIPT_URL      = process.env.APPS_SCRIPT_URL     || '';
const APPS_SCRIPT_TOKEN    = process.env.APPS_SCRIPT_TOKEN   || '';

let db;
async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

async function appsPost(action, payload = {}, extraData = {}) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: APPS_SCRIPT_TOKEN, p: payload, ...extraData })
    });
    return await res.json();
  } catch (e) { return { ok: false, error: e.message }; }
}

function menuText(lang) {
  if (lang === 'en') return `👋 Welcome to DestapesPR.\n\nChoose a number:\n1️⃣ Drain cleaning\n2️⃣ Water leak\n3️⃣ Camera inspection\n4️⃣ Water heater\n5️⃣ Other\n6️⃣ Appointment\n\n🌐 Type "español" for Spanish\n📘 FB: ${FB_LINK}\n📞 Tel: ${PHONE}`;
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número:\n1️⃣ Destape\n2️⃣ Fuga de agua\n3️⃣ Inspección con cámara\n4️⃣ Calentador\n5️⃣ Otro servicio\n6️⃣ Cita\n\n🌐 Escribe "english" para inglés\n📘 FB: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

function leadPrompt(service, lang) {
  if (lang === 'en') return `✅ Service: ${service}\nPlease send EVERYTHING in ONE message:\n• 👤 Full name\n• 📞 Contact number\n• 📍 City\n• 📝 Description\n\nExample: "My name is Ana Rivera, 939-555-9999, San Juan, clogged sink"`;
  return `✅ Servicio: ${service}\nEnvía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Número de contacto\n• 📍 Municipio\n• 📝 Descripción\n\nEjemplo: "Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero tapado"`;
}
const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  const key = from;

  let row = await db.get('SELECT v FROM sessions WHERE k=?', key);
  let session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu' };

  if (lower.includes('english')) session.lang = 'en';
  if (lower.includes('español') || lower.includes('espanol')) session.lang = 'es';

  if (['hola', 'hello', 'hi', 'menu'].includes(lower)) {
    session.step = 'menu';
    await saveSession(key, session);
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${menuText(session.lang)}</Message></Response>`);
  }

  let msg = "";
  if (session.step === 'menu') {
    const choices = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro', '6':'cita' };
    if (choices[body]) {
      session.service = choices[body];
      session.step = 'lead';
      msg = leadPrompt(session.service, session.lang);
    } else { msg = menuText(session.lang); }
  } 
  else if (session.step === 'lead') {
    session.step = 'ask_schedule';
    msg = session.lang === 'en' ? "📅 Do you want to schedule an appointment now?\n\nReply YES or NO" : "📅 ¿Quieres agendar una cita ahora?\n\nResponde SI o NO";
  } 
  else if (session.step === 'ask_schedule') {
    if (['si', 'yes', 's'].includes(lower)) {
      // LLAMADA REAL A GOOGLE
      const resp = await appsPost('availability', {}, { limit: 6, days_ahead: 14 });
      if (resp?.ok && resp.slots?.length > 0) {
        session.slots = resp.slots;
        session.step = 'pick_slot';
        let list = session.lang === 'en' ? "📅 Available slots:\n" : "📅 Horarios disponibles:\n";
        resp.slots.forEach((s, i) => { list += `\n${i+1}️⃣ ${s.ymd} — ${session.lang === 'en' ? s.slot_en : s.slot_es}`; });
        msg = list + (session.lang === 'en' ? "\n\nReply with a number (1-6)" : "\n\nResponde con un número (1-6)");
      } else {
        msg = session.lang === 'en' ? "⚠️ No slots available right now. We'll call you." : "⚠️ No hay horarios disponibles ahora. Te llamaremos.";
        session.step = 'menu';
      }
    } else {
      msg = session.lang === 'en' ? "✅ Done! We'll contact you soon." : "✅ ¡Listo! Te contactaremos pronto.";
      session.step = 'menu';
    }
  }
  else if (session.step === 'pick_slot') {
    const n = parseInt(body);
    if (n > 0 && session.slots && session.slots[n-1]) {
      const slot = session.slots[n-1];
      await appsPost('book', { name: "Cliente WA", from_number: from, start_iso: slot.start_iso, end_iso: slot.end_iso });
      msg = session.lang === 'en' ? `✅ Confirmed! See you on ${slot.ymd}` : `✅ ¡Confirmado! Nos vemos el ${slot.ymd}`;
      session.step = 'menu';
    } else {
      msg = session.lang === 'en' ? "Invalid option. Please choose 1-6." : "Opción inválida. Elige 1-6.";
    }
  }

  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`);
  await saveSession(key, session);
};

async function saveSession(key, session) {
  await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
}

app.post('/webhook/whatsapp', handler);
initDB().then(() => app.listen(PORT, () => console.log(`${TAG} Corregido y conectado`)));
