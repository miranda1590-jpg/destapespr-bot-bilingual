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
const FB_LINK              = process.env.BRAND_FB            || 'https://facebook.com/DestapesPR';
const APPS_SCRIPT_URL      = process.env.APPS_SCRIPT_URL     || '';
const APPS_SCRIPT_TOKEN    = process.env.APPS_SCRIPT_TOKEN   || '';
const ADMIN_WHATSAPP       = process.env.ADMIN_ALERT_TO      || '';
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID  || '';
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN   || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_PHONE_NUMBER || '';
const VALIDATE_TWILIO_SIG  = process.env.VALIDATE_TWILIO_SIGNATURE !== 'false';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
let db;

function log(level, msg, meta = {}) {
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${msg}`, Object.keys(meta).length ? meta : '');
}

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

// --- DETECCIÓN AUTOMÁTICA DE IDIOMA Y SALUDOS ---
function detectLanguage(text, currentLang) {
  const lower = norm(text);
  if (['hello', 'hi', 'hey', 'good morning', 'english'].some(w => lower.includes(w))) return 'en';
  if (['hola', 'buenas', 'saludos', 'español', 'espanol'].some(w => lower.includes(w))) return 'es';
  return currentLang;
}

function isHello(text) {
  const lower = norm(text);
  return ['hola', 'hello', 'hi', 'hey', 'buenas', 'saludos', 'start', 'inicio', 'menu', 'volver', 'back'].includes(lower);
}

// --- TEXTOS ESTÉTICOS BILINGÜES ---
function menuText(lang) {
  if (lang === 'en') {
    return `👋 Welcome to DestapesPR.\n\nChoose a number or type what you need:\n1️⃣ Drain cleaning (clogged pipes)\n2️⃣ Water leak (drips / leaks)\n3️⃣ Camera inspection (video)\n4️⃣ Water heater (gas/electric/solar)\n5️⃣ Other plumbing service\n6️⃣ Appointment / schedule a visit\n\n💬 Commands: "start", "menu" or "back"\n🌐 Type "español" to switch language\n\n📘 Facebook: ${FB_LINK}\n📞 Phone: ${PHONE}`;
  }
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número o escribe lo que necesitas:\n1️⃣ Destape (drenajes o tuberías tapadas)\n2️⃣ Fuga de agua (goteos / filtraciones)\n3️⃣ Inspección con cámara (video)\n4️⃣ Calentador (gas/eléctrico/solar)\n5️⃣ Otro servicio de plomería\n6️⃣ Cita / coordinar visita\n\n💬 Comandos: "inicio", "menu" o "volver"\n🌐 Escribe "english" para cambiar idioma\n\n📘 Facebook: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

// EL NUEVO MENÚ DE CALENTADORES
function heaterMenuText(lang) {
  if (lang === 'en') {
    return `🔥 Please select the type of water heater:\n\n1️⃣ Solar\n2️⃣ Gas\n3️⃣ Tankless / Electric (Line)\n\nReply with a number (1-3) or type "menu" to return.`;
  }
  return `🔥 Por favor selecciona el tipo de calentador:\n\n1️⃣ Solar\n2️⃣ De gas\n3️⃣ Eléctrico / De línea\n\nResponde con un número (1-3) o escribe "menu" para regresar.`;
}

function leadPrompt(service, lang) {
  const names = { destape: { es: 'Destape', en: 'Drain cleaning' }, fuga: { es: 'Fuga de agua', en: 'Water leak' }, camara: { es: 'Inspección con cámara', en: 'Camera inspection' }, calentador: { es: 'Calentador', en: 'Water heater' }, cita: { es: 'Cita', en: 'Appointment' }, otro: { es: 'Otro', en: 'Other' } };
  const sName = names[service]?.[lang] || names['otro'][lang];
  
  if (lang === 'en') {
    return `✅ Service: ${sName}\n\nPlease send EVERYTHING in ONE message:\n• 👤 Full name\n• 📞 Contact number\n• 📍 City / area / sector\n• 📝 Short description of the problem\n\nExample:\n"My name is Ana Rivera, 939-555-9999, San Juan, clogged kitchen sink"\n\n🚨 Emergency? Call NOW for immediate assistance: ${PHONE}`;
  }
  return `✅ Servicio: ${sName}\n\nPor favor envía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Número de contacto\n• 📍 Municipio / zona / sector\n• 📝 Descripción breve del problema\n\nEjemplo:\n"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n\n🚨 ¿Emergencia? Llama AHORA para atención inmediata: ${PHONE}`;
}

function askSchedule(lang) {
  return lang === 'en' ? `📅 Do you want to schedule an appointment now?\n\nReply YES or NO\n\n🚨 Emergency? Call now: ${PHONE}` : `📅 ¿Quieres agendar una cita ahora?\n\nResponde SI o NO\n\n🚨 ¿Emergencia? Llama ahora: ${PHONE}`;
}

function formatSlots(lang, slots) { 
  const lines = [lang === 'en' ? `📅 Available slots:` : `📅 Horarios disponibles:`, '']; 
  for (let i = 0; i < slots.length; i++) { 
    lines.push(`${i + 1}️⃣ ${slots[i].ymd} — ${lang === 'en' ? slots[i].slot_en : slots[i].slot_es}`); 
  } 
  lines.push('', lang === 'en' ? `Reply with a number (1-${slots.length}) or type "menu" to cancel.` : `Responde con un número (1-${slots.length}) o escribe "menu" para cancelar.`); 
  return lines.join('\n'); 
}

// --- COMUNICACIÓN Y ALERTAS ---
async function sendWhatsApp(to, text) {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    await fetch(url, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: to, From: TWILIO_WHATSAPP_FROM, Body: text }) });
  } catch (e) { log('error', 'Error enviando WA', { e: e.message }); }
}

async function alertAdmin(type, session, from) {
  if (!ADMIN_WHATSAPP) return;
  const templates = {
    new_lead: () => `🆕 *NUEVO LEAD*\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nNombre: ${session.name || 'N/A'}\nTel: ${session.phone || 'N/A'}\nPueblo: ${session.city || 'N/A'}\nWA: ${from}\nDetalle: ${session.details || 'N/A'}`,
    booked: () => `📅 *CITA AGENDADA*\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nNombre: ${session.name || 'N/A'}\nTel: ${session.phone || 'N/A'}\nPueblo: ${session.city || 'N/A'}\nCuando: ${session.appointment_start || 'N/A'}`
  };
  if (templates[type]) await sendWhatsApp(ADMIN_WHATSAPP, templates[type]());
}

async function appsPost(action, payload = {}, extraData = {}) {
  const bodyData = { action, token: APPS_SCRIPT_TOKEN, p: payload, ...extraData };
  try {
    const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyData) });
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) { return { ok: false, error: e.message }; }
}

function parseLead(body) {
  const parts = body.split(',').map(p => p.trim());
  if (parts.length >= 4) return { name: parts[0], phone: parts[1], city: parts[2], details: parts.slice(3).join(', ') };
  if (parts.length === 3) return { name: parts[0], phone: parts[1], city: parts[2], details: body };
  return { name: body.substring(0, 30), phone: '', city: '', details: body };
}// --- HANDLER PRINCIPAL ---
const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  const key = from;
  
  let row = await db.get('SELECT v FROM sessions WHERE k=?', key);
  let session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu', case_id: `DP-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 8)}-${Math.floor(1000+Math.random()*9000)}` };

  // Detecta idioma automáticamente y valida comandos de inicio
  session.lang = detectLanguage(body, session.lang);

  if (isHello(body)) {
    session.step = 'menu';
    await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${menuText(session.lang)}</Message></Response>`);
  }

  let responseMsg = "";

  if (session.step === 'menu') {
    const choices = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro', '6':'cita' };
    const serviceLabels = { 'destape':'Drain cleaning', 'fuga':'Water leak', 'camara':'Camera inspection', 'calentador':'Water heater', 'otro':'Other', 'cita':'Appointment' };
    const serviceLabelsEs = { 'destape':'Destape', 'fuga':'Fuga de agua', 'camara':'Inspección con cámara', 'calentador':'Calentador', 'otro':'Otro', 'cita':'Cita' };

    if (choices[body]) {
      session.service = choices[body];
      session.service_label = session.lang === 'en' ? serviceLabels[session.service] : serviceLabelsEs[session.service];
      
      // Si elige calentador (4), pasa al sub-menú de calentadores
      if (session.service === 'calentador') {
        session.step = 'heater_type';
        responseMsg = heaterMenuText(session.lang);
      } else {
        session.step = 'lead';
        responseMsg = leadPrompt(session.service, session.lang);
      }
    } else {
      responseMsg = menuText(session.lang);
    }
  } 
  else if (session.step === 'heater_type') {
    const heaterTypes = { '1': 'Solar', '2': 'Gas', '3': 'Línea / Eléctrico' };
    const heaterTypesEn = { '1': 'Solar', '2': 'Gas', '3': 'Tankless / Electric' };
    
    if (heaterTypes[body]) {
      session.heater_type = session.lang === 'en' ? heaterTypesEn[body] : heaterTypes[body];
      // Añade el tipo de calentador al nombre del servicio (Ej. "Calentador (Solar)")
      session.service_label = `${session.service_label} (${session.heater_type})`;
      session.step = 'lead';
      // Pasamos 'calentador' modificado para que leadPrompt muestre el nombre completo en el título
      responseMsg = leadPrompt(session.service, session.lang).replace("✅ Servicio: Calentador", `✅ Servicio: Calentador (${session.heater_type})`).replace("✅ Service: Water heater", `✅ Service: Water heater (${session.heater_type})`);
    } else {
      responseMsg = heaterMenuText(session.lang);
    }
  }
  else if (session.step === 'lead') {
    // Evita bloqueos: Toma la info, la extrae como pueda, y SIEMPRE avanza
    const extracted = parseLead(body);
    session.name = extracted.name || "Cliente";
    session.phone = extracted.phone || from.replace('whatsapp:', '');
    session.city = extracted.city || "No especificado";
    session.details = extracted.details || body;
    
    // Subir a Google Sheets CRM
    appsPost('lead', { case_id: session.case_id, from_number: from, lang: session.lang, service: session.service, service_label: session.service_label, name: session.name, phone: session.phone, city: session.city, details: session.details, status: 'Nuevo' }).catch(()=>{});
    
    // Alerta al Administrador
    await alertAdmin('new_lead', session, from);

    session.step = 'ask_schedule';
    responseMsg = askSchedule(session.lang);
  }
  else if (session.step === 'ask_schedule') {
    if (['si', 'sí', 'yes', 'y', 's'].includes(lower)) {
      const avail = await appsPost('availability', {}, { limit: 6, days_ahead: 14 });
      if (avail && avail.slots && avail.slots.length > 0) {
        session.slots = avail.slots;
        session.step = 'pick_slot';
        responseMsg = formatSlots(session.lang, avail.slots);
      } else {
        responseMsg = session.lang === 'en' ? "⚠️ No available slots right now. We will contact you soon." : "⚠️ No hay horarios disponibles ahora. Te contactamos pronto.";
        session.step = 'menu';
      }
    } else {
      responseMsg = session.lang === 'en' ? `✅ Perfect! Your info was saved.\n\nCase: ${session.case_id}\nWe will contact you soon. Type "menu" to return.` : `✅ ¡Listo! Tu información fue guardada.\n\nCaso: ${session.case_id}\nTe contactaremos pronto. Escribe "menu" para regresar.`;
      session.step = 'menu';
    }
  }
  else if (session.step === 'pick_slot') {
    const slots = session.slots || [];
    const n = Number(body);

    if (!n || n < 1 || n > slots.length) {
      responseMsg = session.lang === 'en' ? `Please reply with a number between 1 and ${slots.length}.\n\n${formatSlots(session.lang, slots)}` : `Por favor responde con un número entre 1 y ${slots.length}.\n\n${formatSlots(session.lang, slots)}`;
    } else {
      const chosen = slots[n - 1];
      const slotLabel = session.lang === 'en' ? chosen.slot_en : chosen.slot_es;
      
      const bookRes = await appsPost('book', { case_id: session.case_id, name: session.name, phone: session.phone, city: session.city, from_number: from, service_label: session.service_label, details: session.details, start_iso: chosen.start_iso, end_iso: chosen.end_iso });
      
      if (bookRes && bookRes.ok) {
        session.appointment_start = chosen.start_iso;
        await alertAdmin('booked', session, from);
        responseMsg = session.lang === 'en' ? `✅ Appointment confirmed!\n\nCase: ${session.case_id}\nWhen: ${chosen.ymd} — ${slotLabel}\n\nWe will contact you soon. Type "menu" to return.` : `✅ ¡Cita confirmada!\n\nCaso: ${session.case_id}\nCuándo: ${chosen.ymd} — ${slotLabel}\n\nTe estaremos contactando. Escribe "menu" para regresar.`;
      } else {
        responseMsg = session.lang === 'en' ? `❌ We couldn't book that slot. Try again or call: ${PHONE}` : `❌ No pudimos reservar ese horario. Intenta de nuevo o llámanos: ${PHONE}`;
      }
      session.step = 'menu';
    }
  }

  await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message></Response>`);
};

app.post('/webhook/whatsapp', handler);
app.get('/', (req, res) => res.send('DestapesPR Bot Activo ✅'));

initDB().then(() => {
  app.listen(PORT, () => console.log(`${TAG} Bilingüe, CRM, Calendar y Submenú de Calentadores activo 🚀`));
});
