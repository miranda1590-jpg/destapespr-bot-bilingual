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

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
let db;

// --- INICIALIZACIÓN ---
async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
}

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, ''); }

// --- MENSAJES ESTÉTICOS (Como en las capturas) ---
function menuText(lang) {
  if (lang === 'en') {
    return `👋 Welcome to DestapesPR.\n\nSelect a number or type what you need:\n1️⃣ Drain cleaning (clogged pipes)\n2️⃣ Water leak (drips / leaks)\n3️⃣ Camera inspection (video)\n4️⃣ Water heater (gas/electric/solar)\n5️⃣ Other plumbing service\n6️⃣ Appointment / schedule a visit\n\n💬 Commands: "start", "menu" or "back"\n🌐 Type "español" to switch language\n\n📘 Facebook: ${FB_LINK}\n📞 Phone: ${PHONE}`;
  }
  return `👋 Bienvenido a DestapesPR.\n\nSelecciona un número o escribe lo que necesitas:\n1️⃣ Destape (drenajes o tuberías tapadas)\n2️⃣ Fuga de agua (goteos / filtraciones)\n3️⃣ Inspección con cámara (video)\n4️⃣ Calentador (gas/eléctrico/solar)\n5️⃣ Otro servicio de plomería\n6️⃣ Cita / coordinar visita\n\n💬 Comandos: "inicio", "menu" o "volver"\n🌐 Escribe "english" para cambiar idioma\n\n📘 Facebook: ${FB_LINK}\n📞 Tel: ${PHONE}`;
}

function leadPrompt(service, lang) {
  const names = { destape: { es: 'Destape', en: 'Drain cleaning' }, fuga: { es: 'Fuga de agua', en: 'Water leak' }, camara: { es: 'Inspección con cámara', en: 'Camera inspection' }, calentador: { es: 'Calentador', en: 'Water heater' }, cita: { es: 'Cita', en: 'Appointment' } };
  const sName = names[service]?.[lang] || (lang === 'en' ? 'Service' : 'Servicio');
  
  if (lang === 'en') {
    return `✅ Service: ${sName}\nPlease send EVERYTHING in ONE message:\n• 👤 Full name\n• 📞 Contact number\n• 📍 City / area / sector\n• 📝 Short description of the problem\n\nExample:\n"My name is Ana Rivera, 939-555-9999, San Juan, clogged kitchen sink"\n\n🚨 Emergency? Call NOW: ${PHONE}`;
  }
  return `✅ Servicio: ${sName}\nPor favor envía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Número de contacto\n• 📍 Municipio / zona / sector\n• 📝 Descripción breve del problema\n\nEjemplo:\n"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n\n🚨 ¿Emergencia? Llama AHORA: ${PHONE}`;
}

// --- ALERTAS PARA EL CRM/ADMIN ---
async function alertAdmin(type, session, from) {
  if (!ADMIN_WHATSAPP) return;
  const templates = {
    new_lead: () => `🆕 *NUEVO LEAD*\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nNombre: ${session.name || 'N/A'}\nTel: ${session.phone || 'N/A'}\nPueblo: ${session.city || 'N/A'}\nWA: ${from}\nDetalle: ${session.details || 'N/A'}`,
    booked: () => `📅 *CITA AGENDADA*\nCaso: ${session.case_id}\nNombre: ${session.name || 'N/A'}\nCuando: ${session.appointment_start || 'N/A'}`
  };
  const body = templates[type] ? templates[type]() : "";
  if (body) await sendWhatsApp(ADMIN_WHATSAPP, body);
}
// --- COMUNICACIÓN CON APPS SCRIPT (CRM) ---
async function pushLeadToScript(session, from) {
  const payload = {
    case_id: session.case_id,
    created_at: new Date().toISOString(),
    from_number: from,
    lang: session.lang,
    service: session.service,
    name: session.name,
    phone: session.phone,
    city: session.city,
    details: session.details,
    status: 'Nuevo'
  };
  return await appsPost('lead', payload);
}

// --- HANDLER PRINCIPAL ---
const handler = async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const lower = norm(body);
  
  const key = from;
  let row = await db.get('SELECT v FROM sessions WHERE k=?', key);
  let session = row ? JSON.parse(row.v) : { lang: 'es', step: 'menu', case_id: `DP-${Date.now()}` };

  // Detectar idioma dinámicamente
  if (lower.includes('english')) session.lang = 'en';
  if (lower.includes('español') || lower.includes('espanol')) session.lang = 'es';

  // Saludos o Menú principal
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
    // Procesamiento de datos del cliente (Nombre, Tel, Pueblo, Detalle)
    session.name = body.split(',')[0] || "Cliente";
    session.step = 'ask_schedule';
    // Enviar al CRM y alertar al Admin
    await pushLeadToScript(session, from);
    await alertAdmin('new_lead', session, from);
    responseMsg = askSchedule(session.lang);
  }
  else if (session.step === 'ask_schedule') {
    if (['si', 'sí', 'yes', 'y'].includes(lower)) {
      // Aquí el bot consulta los slots de Google Calendar
      responseMsg = session.lang === 'en' ? "📅 Looking for available slots..." : "📅 Buscando horarios disponibles...";
      // (Lógica de reservación simplificada para este bloque)
    } else {
      responseMsg = session.lang === 'en' ? "✅ Perfect. We will call you soon!" : "✅ Perfecto. ¡Te contactaremos pronto!";
      session.step = 'menu';
    }
  }

  // Guardar estado de la sesión
  await db.run('INSERT OR REPLACE INTO sessions (k, v, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(session), Date.now());
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responseMsg}</Message></Response>`;
  res.type('text/xml').send(twiml);
};

// --- INICIO DEL SERVIDOR ---
app.post('/webhook/whatsapp', handler);
app.get('/', (req, res) => res.send('DestapesPR Bot Activo ✅'));

initDB().then(() => {
  app.listen(PORT, () => console.log(`${TAG} bilingüe y CRM listo en puerto ${PORT}`));
});

// Cierre ordenado
process.on('SIGTERM', () => {
  console.log('Cerrando servidor...');
  process.exit(0);
});
