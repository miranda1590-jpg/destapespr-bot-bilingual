/* DEPLOY_BUMP: auto */
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
const TAG                  = process.env.TAG                 || 'DestapesPR Bot 🇵🇷';
const PHONE                = process.env.BRAND_PHONE         || '+1 787-922-0068';
const FB_LINK              = process.env.BRAND_FB            || 'https://facebook.com/DestapesPR';
const APPS_SCRIPT_URL      = process.env.APPS_SCRIPT_URL     || '';
const APPS_SCRIPT_TOKEN    = process.env.APPS_SCRIPT_TOKEN   || '';
const ADMIN_WHATSAPP       = process.env.ADMIN_ALERT_TO      || '';
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID  || '';
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN   || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_PHONE_NUMBER || '';

let db;

function log(level, msg, meta = {}) {
  console.log(`[${new Date().toISOString()}] ${level.toUpperCase()}: ${msg}`, Object.keys(meta).length ? meta : '');
}

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
  // NUEVO: Memoria interna para bloquear horarios de emergencia ya tomados
  await db.exec(`CREATE TABLE IF NOT EXISTS emergency_bookings (date_slot TEXT PRIMARY KEY, created_at INTEGER);`);
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

function detectLanguage(text, currentLang) {
  const lower = norm(text);
  if (['hello', 'hi', 'hey', 'english', 'emergency', 'urgent', 'price', 'cost', 'estimate', 'clog', 'leak', 'heater', 'camera', 'appointment'].some(w => lower.includes(w))) return 'en';
  if (['hola', 'buenas', 'saludos', 'español', 'espanol', 'emergencia', 'urgencia', 'urgente', 'precio', 'costo', 'destape', 'fuga', 'calentador', 'cita'].some(w => lower.includes(w))) return 'es';
  return currentLang;
}

function isHello(text) {
  const lower = norm(text);
  return ['hola', 'hello', 'hi', 'hey', 'buenas', 'saludos', 'start', 'inicio', 'menu', 'volver', 'back'].includes(lower);
}

function detectIntent(text) {
  const lower = norm(text);
  if (['emergencia', 'urgencia', 'emergency', 'urgent', 'urgente'].some(w => lower.includes(w))) return 'emergencia';
  if (['precio', 'costo', 'estimado', 'cuanto', 'sale', 'price', 'cost', 'estimate', 'how much'].some(w => lower.includes(w))) return 'precio';
  if (['destape', 'tapado', 'inodoro', 'fregadero', 'tuberia', 'clog', 'clogged', 'drain', 'toilet', 'sink'].some(w => lower.includes(w))) return 'destape';
  if (['fuga', 'goteo', 'rota', 'filtra', 'leak', 'leaking', 'broken'].some(w => lower.includes(w))) return 'fuga';
  if (['calentador', 'ducha', 'no calienta', 'heater', 'water heater'].some(w => lower.includes(w))) return 'calentador';
  if (['camara', 'inspeccion', 'video', 'camera', 'inspection'].some(w => lower.includes(w))) return 'camara';
  if (['cita', 'visita', 'appointment', 'schedule'].some(w => lower.includes(w))) return 'cita';
  return null;
}

// GENERADOR CON MEMORIA PARA NO REPETIR HORARIOS OCUPADOS
async function getEmergencySlots() {
  const prTime = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Puerto_Rico"}));
  const day = prTime.getDay(); 
  
  const yyyy = prTime.getFullYear();
  const mm = String(prTime.getMonth() + 1).padStart(2, '0');
  const dd = String(prTime.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const prOffset = "-04:00";

  let slots = [];
  if (day === 0) { 
    slots.push({ ymd: 'HOY', slot_en: '9:00 AM - 1:00 PM', slot_es: '9:00 AM - 1:00 PM', start_iso: `${dateStr}T09:00:00${prOffset}`, end_iso: `${dateStr}T13:00:00${prOffset}` });
    slots.push({ ymd: 'HOY', slot_en: '1:00 PM - 5:00 PM', slot_es: '1:00 PM - 5:00 PM', start_iso: `${dateStr}T13:00:00${prOffset}`, end_iso: `${dateStr}T17:00:00${prOffset}` });
    slots.push({ ymd: 'HOY', slot_en: '5:00 PM - 9:00 PM', slot_es: '5:00 PM - 9:00 PM', start_iso: `${dateStr}T17:00:00${prOffset}`, end_iso: `${dateStr}T21:00:00${prOffset}` });
  } else { 
    slots.push({ ymd: 'HOY', slot_en: '6:00 PM - 7:30 PM', slot_es: '6:00 PM - 7:30 PM', start_iso: `${dateStr}T18:00:00${prOffset}`, end_iso: `${dateStr}T19:30:00${prOffset}` });
    slots.push({ ymd: 'HOY', slot_en: '7:30 PM - 9:00 PM', slot_es: '7:30 PM - 9:00 PM', start_iso: `${dateStr}T19:30:00${prOffset}`, end_iso: `${dateStr}T21:00:00${prOffset}` });
  }

  // Verificar la base de datos local para eliminar los horarios que ya se tomaron
  try {
    const bookedRows = await db.all("SELECT date_slot FROM emergency_bookings");
    const bookedSet = new Set(bookedRows.map(r => r.date_slot));
    slots = slots.filter(s => !bookedSet.has(s.start_iso)); // Solo deja los que están libres
  } catch (e) {
    console.error("Error filtrando slots de emergencia:", e);
  }

  return slots;
}

function menuText(lang) {
  if (lang === 'en') {
    return `👋 Welcome to DestapesPR.\n\nChoose a number or type what you need:\n1️⃣ Drain cleaning (clogged pipes)\n2️⃣ Water leak (drips / leaks)\n3️⃣ Camera inspection (video)\n4️⃣ Water heater (gas/electric/solar)\n5️⃣ Other plumbing service\n6️⃣ Appointment / schedule a visit\n\n💬 Commands: "start", "menu" or "back"\n🌐 Type "español" to switch language\n\n📘 Facebook: ${FB_LINK}\n📞 Phone: ${PHONE}`;
  }
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número o escribe lo que necesitas:\n1️⃣ Destape (drenajes o tuberías tapadas)\n2️⃣ Fuga de agua (goteos / filtraciones)\n3️⃣ Inspección con cámara (video)\n4️⃣ Calentador (gas/eléctrico/solar)\n5️⃣ Otro servicio de plomería\n6️⃣ Cita / coordinar visita\n\n💬 Comandos: "inicio", "menu" o "volver"\n🌐 Escribe "english" para cambiar idioma\n\n📘 Facebook: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

function heaterMenuText(lang) {
  if (lang === 'en') {
    return `🔥 Please select the type of water heater:\n\n1️⃣ Solar\n2️⃣ Gas\n3️⃣ Tankless / Electric (Line)\n\nReply with a number (1-3) or type "menu" to return.`;
  }
  return `🔥 Por favor selecciona el tipo de calentador:\n\n1️⃣ Solar\n2️⃣ De gas\n3️⃣ Eléctrico / De línea\n\nResponde con un número (1-3) o escribe "menu" para regresar.`;
}

function leadPrompt(service, lang) {
  const names = { destape: { es: 'Destape', en: 'Drain cleaning' }, fuga: { es: 'Fuga de agua', en: 'Water leak' }, camara: { es: 'Inspección con cámara', en: 'Camera inspection' }, calentador: { es: 'Calentador', en: 'Water heater' }, cita: { es: 'Cita', en: 'Appointment' }, otro: { es: 'Otro', en: 'Other' }, precio: { es: 'Estimado / Visita', en: 'Estimate / Visit' }, emergencia: { es: 'Emergencia', en: 'Emergency' } };
  const sName = names[service]?.[lang] || names['otro'][lang];
  
  if (service === 'emergencia') {
    if (lang === 'en') {
      return `🚨 Service: ${sName}\n\n⚠️ Emergency services have an initial cost of $250.\n\nTo assist you immediately, please send EVERYTHING in ONE message:\n• 👤 Full name\n• 📞 Contact number\n• 📍 City / area / sector\n• 📝 Photos / Description of the emergency\n\n🚨 Emergency? Call NOW: ${PHONE}`;
    }
    return `🚨 Servicio: ${sName}\n\n⚠️ Las emergencias tienen un costo inicial de $250 dólares.\n\nPara atenderte lo más pronto posible, envía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Número de contacto\n• 📍 Municipio / zona / sector\n• 📝 Fotos / Descripción de la emergencia\n\n🚨 ¿Emergencia? Llama AHORA: ${PHONE}`;
  }

  if (service === 'precio') {
    if (lang === 'en') {
      return `✅ Service: ${sName}\n\n💵 For costs and estimates, please tell us the service needed and send photos of the area.\n\n🛠️ If you want us to visit you, the evaluation visit has a cost of $80 (which is deducted from the final cost of any service performed).\n\nTo schedule your visit, please send EVERYTHING in ONE message:\n• 👤 Full name\n• 📞 Contact number\n• 📍 City / area / sector\n• 📝 Photos / Description of the problem\n\n🚨 Emergency? Call NOW: ${PHONE}`;
    }
    return `✅ Servicio: ${sName}\n\n💵 Para costo y/o estimados de servicios, déjanos un mensaje con el servicio a estimar y fotos del área a trabajar.\n\n🛠️ Si deseas que lo visitemos, la visita tiene un costo de $80 dólares (que se deducen del costo de cualquier servicio que se realice).\n\nPara agendar tu visita, envía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Número de contacto\n• 📍 Municipio / zona / sector\n• 📝 Fotos / Descripción del problema\n\n🚨 ¿Emergencia? Llama AHORA: ${PHONE}`;
  }

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
}

const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  const key = from;
  
  let row = await db.get('SELECT v FROM sessions WHERE k=?', key);
  let session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu', case_id: `DP-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 8)}-${Math.floor(1000+Math.random()*9000)}` };

  session.lang = detectLanguage(body, session.lang);
  
  const intent = detectIntent(lower);
  const isAnswering = ['si', 'sí', 'yes', 'y', 's', '1', '2', '3', '4', '5', '6'].includes(lower);

  if (isHello(body) || (intent && session.step !== 'lead' && session.step !== 'heater_type' && session.step !== 'menu' && !isAnswering)) {
    if (intent && !isHello(body)) {
      session.step = 'menu';
    } else {
      session.step = 'menu';
      await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
      return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${menuText(session.lang)}</Message></Response>`);
    }
  }

  let responseMsg = "";

  if (session.step === 'menu') {
    const choices = { '1':'destape', '2':'fuga', '3':'camara', '4':'calentador', '5':'otro', '6':'cita' };
    const serviceLabels = { 'destape':'Drain cleaning', 'fuga':'Water leak', 'camara':'Camera inspection', 'calentador':'Water heater', 'otro':'Other', 'cita':'Appointment', 'precio':'Estimate / Visit ($80)', 'emergencia':'Emergency ($250)' };
    const serviceLabelsEs = { 'destape':'Destape', 'fuga':'Fuga de agua', 'camara':'Inspección con cámara', 'calentador':'Calentador', 'otro':'Otro', 'cita':'Cita', 'precio':'Estimado / Visita ($80)', 'emergencia':'Emergencia ($250)' };

    const selectedService = choices[body] || intent;

    if (selectedService) {
      session.service = selectedService;
      session.service_label = session.lang === 'en' ? serviceLabels[session.service] : serviceLabelsEs[session.service];
      
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
      session.service_label = `${session.service_label} (${session.heater_type})`;
      session.step = 'lead';
      responseMsg = leadPrompt(session.service, session.lang).replace("✅ Servicio: Calentador", `✅ Servicio: Calentador (${session.heater_type})`).replace("✅ Service: Water heater", `✅ Service: Water heater (${session.heater_type})`);
    } else {
      responseMsg = heaterMenuText(session.lang);
    }
  }
  else if (session.step === 'lead') {
    const extracted = parseLead(body);
    session.name = extracted.name || "Cliente";
    session.phone = extracted.phone || from.replace('whatsapp:', '');
    session.city = extracted.city || "No especificado";
    session.details = extracted.details || body;
    
    appsPost('lead', { 
      case_id: session.case_id, 
      created_at: new Date().toISOString(),
      from_number: from, 
      lang: session.lang, 
      service: session.service, 
      service_label: session.service_label, 
      name: session.name, 
      phone: session.phone, 
      city: session.city, 
      details: session.details, 
      status: 'Nuevo' 
    }).catch(()=>{});
    
    await alertAdmin('new_lead', session, from);

    if (session.service === 'emergencia') {
      const slots = await getEmergencySlots(); // Se conecta a la base de datos local
      if (slots.length > 0) {
        session.slots = slots;
        session.step = 'pick_slot';
        const msgIntro = session.lang === 'en' ? "🚨 Emergency received. Please select a time for TODAY:\n\n" : "🚨 Emergencia recibida. Por favor selecciona un horario para HOY:\n\n";
        responseMsg = msgIntro + formatSlots(session.lang, slots);
      } else {
        responseMsg = session.lang === 'en' ? "⚠️ All emergency slots for today are currently full. We will contact you ASAP." : "⚠️ Todos los espacios de emergencia para hoy están llenos. Te contactaremos lo antes posible.";
        session.step = 'menu';
      }
    } else {
      session.step = 'ask_schedule';
      responseMsg = askSchedule(session.lang);
    }
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
        
        // NUEVO: Memoriza el espacio de emergencia para que no se duplique
        if (session.service === 'emergencia') {
          await db.run('INSERT OR IGNORE INTO emergency_bookings (date_slot, created_at) VALUES (?, ?)', chosen.start_iso, Date.now());
        }

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
  app.listen(PORT, () => console.log(`${TAG} Bilingüe, CRM, Calendar, Submenú y NLP activo 🚀`));
});
