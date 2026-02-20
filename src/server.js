/* DEPLOY_BUMP: auto */
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fetch from 'node-fetch';
import crypto from 'crypto';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

const PORT                 = process.env.PORT                || 10000;
const TAG                  = process.env.TAG                 || 'DestapesPR Bot 🇵🇷';
const PHONE                = process.env.BRAND_PHONE         || process.env.PHONE           || '+1 787-922-0068';
const FB_LINK              = process.env.BRAND_FB            || process.env.FB_LINK          || 'https://www.facebook.com/destapesPR/';
const APPS_SCRIPT_URL      = process.env.APPS_SCRIPT_URL     || process.env.LEADS_WEBHOOK_URL || '';
const APPS_SCRIPT_TOKEN    = process.env.APPS_SCRIPT_TOKEN   || process.env.LEADS_WEBHOOK_TOKEN || process.env.DESTAPESPR_TOKEN || '';
const ADMIN_WHATSAPP       = process.env.ADMIN_ALERT_TO      || process.env.ADMIN_WHATSAPP   || '';
const TWILIO_ACCOUNT_SID   = process.env.TWILIO_ACCOUNT_SID  || '';
const TWILIO_AUTH_TOKEN    = process.env.TWILIO_AUTH_TOKEN   || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM || '';
const VALIDATE_TWILIO_SIG  = process.env.VALIDATE_TWILIO_SIGNATURE !== 'false';
const ADMIN_TOKEN          = process.env.ADMIN_TOKEN         || 'cambiar_por_una_contraseña_segura'; 

const SESSION_TTL_MS   = 48 * 60 * 60 * 1000;
const WELCOME_AFTER_MS = 12 * 60 * 60 * 1000;
const MAX_RETRIES      = 3;
const RETRY_DELAY_MS   = 900;
const FETCH_TIMEOUT_MS = 15000;

// Rate limit
const RATE_LIMIT_MAX    = 20;
const RATE_LIMIT_WIN_MS = 60 * 1000;
const rateLimitMap      = new Map();

let db;

// ─── LOGGING ─────────────────────────────────────────────────────────────────

function log(level, msg, meta = {}) {
  const ts      = new Date().toISOString();
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  const icon    = level === 'error' ? '❌' : level === 'warn' ? '⚠️ ' : level === 'info' ? 'ℹ️ ' : '✅';
  console[level === 'error' ? 'error' : 'log'](`[${ts}] ${icon} ${msg}${metaStr}`);
}

// ─── BASE DE DATOS ────────────────────────────────────────────────────────────

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`PRAGMA journal_mode=WAL;`);
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
  await db.exec(`CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, from_number TEXT, case_id TEXT, action TEXT, error TEXT, details TEXT);`);
  await db.exec(`CREATE TABLE IF NOT EXISTS lead_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, case_id TEXT, from_number TEXT, service TEXT, name TEXT, phone TEXT, city TEXT, status TEXT, emergency INTEGER);`);

  const deleted = await db.run('DELETE FROM sessions WHERE updated_at < ?', Date.now() - SESSION_TTL_MS);
  if (deleted.changes) log('info', `Sesiones vencidas eliminadas: ${deleted.changes}`);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const nowMs = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s)  => String(s || '').trim();

function normalizeFrom(from) {
  const s = String(from || '').trim();
  if (!s) return '';
  if (/^whatsapp:/i.test(s)) return s;
  if (/^\+?\d+$/.test(s)) return `whatsapp:${s.startsWith('+') ? s : `+${s}`}`;
  return s;
}

function escapeXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function twiml(msg) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(msg)}</Message></Response>`;
}

function norm(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function makeCaseId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `DP-${y}${m}${day}-${rnd}`;
}

// ─── RATE LIMITING Y FIRMAS ──────────────────────────────────────────────────

function isRateLimited(from) {
  const now = nowMs();
  const info = rateLimitMap.get(from);
  if (!info || now > info.resetAt) {
    rateLimitMap.set(from, { count: 1, resetAt: now + RATE_LIMIT_WIN_MS });
    return false;
  }
  info.count++;
  if (info.count > RATE_LIMIT_MAX) return true;
  return false;
}

setInterval(() => {
  const now = nowMs();
  for (const [k, v] of rateLimitMap) { if (now > v.resetAt) rateLimitMap.delete(k); }
}, 5 * 60 * 1000);

function validateTwilioSignature(req) {
  if (!VALIDATE_TWILIO_SIG || !TWILIO_AUTH_TOKEN) return true;
  const sig = req.headers['x-twilio-signature'] || '';
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = Object.keys(req.body).sort().reduce((acc, k) => acc + k + req.body[k], url);
  const expected = crypto.createHmac('sha1', TWILIO_AUTH_TOKEN).update(params).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

// ─── APPS SCRIPT (POST SEGURO) ───────────────────────────────────────────────

async function appsPost(action, payload = {}, extraData = {}) {
  if (!APPS_SCRIPT_URL) throw new Error('missing APPS_SCRIPT_URL');

  const bodyData = { action, ...extraData };
  if (action !== 'ready') {
    if (!APPS_SCRIPT_TOKEN) throw new Error('missing APPS_SCRIPT_TOKEN');
    bodyData.token = APPS_SCRIPT_TOKEN;
  }
  if (payload && Object.keys(payload).length) bodyData.p = payload;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
        signal: ctrl.signal
      });

      const text = await res.text();
      log('info', 'AppsScript HTTP response', {
        action,
        status: res.status,
        ok: res.ok,
        raw: text.slice(0, 300)
      });
      
      let json;
      try { json = JSON.parse(text); } catch {
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
        return { ok: false, error: 'non_json_response', status: res.status, raw: text.slice(0, 500) };
      }

      if (json?.ok === true) {
        clearTimeout(timeoutId);
        return json;
      }
      if (json?.error === 'unauthorized') {
        clearTimeout(timeoutId);
        return json;
      }

      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
      return json || { ok: false, error: 'unknown' };

    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
      log('warn', 'AppsScript fetch error', {
        action,
        attempt,
        error: msg
      });
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
      return { ok: false, error: 'fetch_failed', details: msg };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { ok: false, error: 'max_retries_exceeded' };
}

// ─── WHATSAPP OUTBOUND Y ALERTAS ──────────────────────────────────────────────

async function sendWhatsApp(to, text) {
  try {
    const toAddr = normalizeFrom(to);
    const fromAddr = normalizeFrom(TWILIO_WHATSAPP_FROM);
    if (!toAddr || !fromAddr) return { ok: false, skipped: 'missing_to_or_from' };
    
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const body = new URLSearchParams({ To: toAddr, From: fromAddr, Body: String(text).slice(0, 1500) });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const t = await res.text();
    if (!res.ok) return { ok: false, status: res.status, raw: t.slice(0, 500) };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

async function alertAdmin(type, session, from) {
  if (!ADMIN_WHATSAPP) return;
  const templates = {
    new_lead: () => `🆕 *NUEVO LEAD*\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nNombre: ${session.name || 'N/A'}\nTel: ${session.phone || 'N/A'}\nPueblo: ${session.city || 'N/A'}\nWA: ${from}\nDetalle: ${(session.details || '').slice(0, 200)}`,
    emergency: () => `🚨 *EMERGENCIA*\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nNombre: ${session.name || 'N/A'}\nTel: ${session.phone || 'N/A'}\nPueblo: ${session.city || 'N/A'}\nWA: ${from}\nDetalle: ${(session.details || '').slice(0, 200)}`,
    booked: () => `📅 *CITA AGENDADA*\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nNombre: ${session.name || 'N/A'}\nTel: ${session.phone || 'N/A'}\nPueblo: ${session.city || 'N/A'}\nCuando: ${session.appointment_start || 'N/A'}`
  };
  if (!templates[type]) return;
  await sendWhatsApp(ADMIN_WHATSAPP, templates[type]());
}

// ─── DB HELPERS Y LOGICA SESION ───────────────────────────────────────────────

async function logError(from, caseId, action, error, details) {
  try { await db.run('INSERT INTO error_log (timestamp, from_number, case_id, action, error, details) VALUES (?,?,?,?,?,?)', new Date().toISOString(), from || '', caseId || '', action || '', String(error || ''), JSON.stringify(details || {})); } catch {}
}

async function logLead(session, from) {
  try { await db.run('INSERT INTO lead_log (timestamp,case_id,from_number,service,name,phone,city,status,emergency) VALUES (?,?,?,?,?,?,?,?,?)', new Date().toISOString(), session.case_id || '', from || '', session.service || '', session.name || '', session.phone || '', session.city || '', session.status || 'Nuevo', session.emergency ? 1 : 0); } catch {}
}

async function loadSession(key) {
  try {
    const row = await db.get('SELECT v, updated_at FROM sessions WHERE k=?', key);
    if (!row) return null;
    if (nowMs() - row.updated_at > SESSION_TTL_MS) { await db.run('DELETE FROM sessions WHERE k=?', key); return null; }
    return JSON.parse(row.v);
  } catch { return null; }
}

async function saveSession(key, obj) {
  await db.run('INSERT INTO sessions(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at', key, JSON.stringify(obj || {}), nowMs());
}

function freshSession() { return { lang: 'es', step: 'menu', created_at: new Date().toISOString(), last_seen: nowMs(), service: '', service_label: '', heater_type: 'N/A', case_id: '', name: '', phone: '', city: '', details: '', emergency: false, slots: [], appointment_start: '', appointment_end: '', calendar_event_id: '', status: 'Nuevo' }; }
function resetSessionData(session) { Object.assign(session, { step: 'menu', service: '', service_label: '', heater_type: 'N/A', case_id: '', name: '', phone: '', city: '', details: '', emergency: false, slots: [], appointment_start: '', appointment_end: '', calendar_event_id: '', status: 'Nuevo' }); }
const hasMinimumLead = (s) => !!(clean(s.phone) && clean(s.city));
async function ensureCase(session) { if (!session.case_id) session.case_id = makeCaseId(); return session.case_id; }

// ─── TEXTOS Y PARSING ────────────────────────────────────────────────────────
const isHello = (t) => ['hola','hello','hi','hey','menu','start','inicio','back','volver','buenas','saludos'].includes(norm(t));
const normalizeYesNo = (t) => ['si','sí','s','yes','y','ok','dale','claro','sure','yep'].includes(norm(t)) ? 'yes' : (['no','n','nope','nel'].includes(norm(t)) ? 'no' : '');
const mapMenuChoiceToService = (c) => ({ '1':'destape','2':'fuga','3':'camara','4':'calentador','5':'otro','6':'cita' }[c] || '');

function parseInbound(req) { return { from: normalizeFrom(req.body.From || req.body.from || req.body.WaId || ''), body: clean(req.body.Body || req.body.body || ''), profileName: clean(req.body.ProfileName || req.body.profileName || '') }; }

function menuText(lang) { return lang === 'en' ? `👋 Welcome to DestapesPR.\n\nChoose a number or type what you need:\n1️⃣ Drain cleaning\n2️⃣ Leak\n3️⃣ Camera inspection\n4️⃣ Water heater\n5️⃣ Other plumbing service\n6️⃣ Appointment / schedule a visit\n\n💬 Commands: "start", "menu" or "back"\n🌐 Type "español" to switch language\n\n📞 Phone: ${PHONE}` : `👋 Bienvenido a DestapesPR.\n\nSelecciona un número o escribe lo que necesitas:\n1️⃣ Destape (drenajes o tuberías tapadas)\n2️⃣ Fuga de agua\n3️⃣ Inspección con cámara\n4️⃣ Calentador\n5️⃣ Otro servicio\n6️⃣ Cita / coordinar visita\n\n💬 Comandos: "inicio", "menu" o "volver"\n🌐 Escribe "english" para cambiar idioma\n\n📞 Tel: ${PHONE}`; }
function serviceName(service, lang) { const names = { destape: { es: 'Destape', en: 'Drain cleaning' }, fuga: { es: 'Fuga de agua', en: 'Water leak' }, camara: { es: 'Inspección con cámara', en: 'Camera inspection' }, calentador: { es: 'Calentador', en: 'Water heater' }, otro: { es: 'Otro servicio de plomería', en: 'Other plumbing service' }, cita: { es: 'Cita / coordinar visita', en: 'Appointment' }, }; return (names[service] || names['otro'])[lang === 'en' ? 'en' : 'es']; }
function heaterMenu(lang) { return lang === 'en' ? `✅ Service: Water heater\n\nChoose heater type:\n1️⃣ Solar\n2️⃣ Conventional (gas/electric)\n\nReply with 1 or 2.` : `✅ Servicio: Calentador\n\nElige tipo:\n1️⃣ Solar\n2️⃣ Convencional (gas/eléctrico)\n\nResponde 1 o 2.`; }
function isEmergency(text) { const s = norm(text); return (s.includes('emergenc') || s.includes('urgente') || s.includes('inund') || s.includes('revento') || s.includes('exploto') || s.includes('flooding') || s.includes('fuga grande') || s.includes('pipe burst')); }
function stripEmergency(text) { return clean(String(text || '').replace(/\bemergencia\b/gi, '').replace(/\bemergency\b/gi, '').replace(/\burgente\b/gi, '').replace(/\s*,\s*,/g, ',').replace(/\s{2,}/g, ' ')); }

// LA FUNCIÓN NUEVA QUE PEDISTE:
function leadPrompt(service, lang, heaterType) {
  const title = lang === 'en' ? `✅ Service: ${serviceName(service, lang)}` : `✅ Servicio: ${serviceName(service, lang)}`;
  const typeLine = service === 'calentador' && heaterType ? (lang === 'en' ? `✅ Type: ${heaterType}` : `✅ Tipo: ${heaterType}`) : null;
  
  if (lang === 'en') {
    return [
      title, 
      typeLine, 
      `\nPlease send EVERYTHING in ONE message:\n• 👤 Full name\n• 📞 Contact number\n• 📍 City / area / sector\n• 📝 Short description of the problem\n\nExample:\n"My name is Ana Rivera, 939-555-9999, San Juan, clogged kitchen sink"\n\n🚨 Emergency? Call NOW for immediate assistance: ${PHONE}`
    ].filter(Boolean).join('\n');
  }

  return [
    title, 
    typeLine, 
    `\nPor favor envía TODO en UN solo mensaje:\n• 👤 Nombre completo\n• 📞 Número de contacto\n• 📍 Municipio / zona / sector\n• 📝 Descripción breve del problema\n\nEjemplo:\n"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"\n\n🚨 ¿Emergencia? Llama AHORA para atención inmediata: ${PHONE}`
  ].filter(Boolean).join('\n');
}

function askSchedule(lang) { return lang === 'en' ? `📅 Do you want to schedule an appointment now?\n\nReply YES or NO` : `📅 ¿Quieres agendar una cita ahora?\n\nResponde SI o NO`; }
function emergencyCallText(lang, caseId) { return lang === 'en' ? `🚨 *Emergency detected*\n\nFor fastest assistance, CALL NOW: ${PHONE}\n${caseId ? `Case ID: ${caseId}` : ''}\n\nType "menu" to return.` : `🚨 *Emergencia detectada*\n\nPara atención inmediata, llama AHORA: ${PHONE}\n${caseId ? `Caso: ${caseId}` : ''}\n\nEscribe "menu" para regresar.`; }
function formatSlots(lang, slots) { const lines = [lang === 'en' ? `📅 Available slots:` : `📅 Horarios disponibles:`, '']; for (let i = 0; i < slots.length; i++) { const label = lang === 'en' ? slots[i].slot_en : slots[i].slot_es; lines.push(`${i + 1}️⃣ ${slots[i].ymd} — ${label}`); } lines.push(''); lines.push(lang === 'en' ? `Reply with a number (1-${slots.length}) or type "menu" to cancel.` : `Responde con un número (1-${slots.length}) o escribe "menu" para cancelar.`); return lines.join('\n'); }
function parsePhoneLoose(s) { const t = String(s || ''); const m = t.match(/(\+?1)?\s*[\(]?\s*(\d{3})\s*[\)]?\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})/); return m ? `+1${m[2]}${m[3]}${m[4]}` : ''; }
function parseLeadMessage(text) { const raw = stripEmergency(String(text || '').trim()); const out = { name: '', city: '', phone: '', details: '' }; const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean); for (const l of lines) { const m1 = l.match(/^(nombre|name)\s*:\s*(.+)$/i); if (m1) { out.name = clean(m1[2]); continue; } const m2 = l.match(/^(pueblo|municipio|ciudad|city|location|ubicacion)\s*:\s*(.+)$/i); if (m2) { out.city = clean(m2[2]); continue; } const m3 = l.match(/^(tel|telefono|phone|celular|numero)\s*:\s*(.+)$/i); if (m3) { const p = parsePhoneLoose(m3[2]) || clean(m3[2]).replace(/[^\d+]/g, ''); out.phone = p.startsWith('+') ? p : (p ? `+1${p.replace(/\D/g, '')}` : ''); continue; } const m4 = l.match(/^(detalles|details|problema|problem|descripcion|description)\s*:\s*(.+)$/i); if (m4) { out.details = clean(m4[2]); continue; } } if (!out.phone) out.phone = parsePhoneLoose(raw); if ((!out.name || !out.city || !out.details) && raw.includes(',')) { const parts = raw.split(',').map((p) => p.trim()).filter(Boolean); if (parts.length >= 4) { if (!out.name) out.name = parts[0]; if (!out.phone) out.phone = parsePhoneLoose(parts[1]) || (parts[1] ? `+1${parts[1].replace(/\D/g, '')}` : ''); if (!out.city) out.city = parts[2]; if (!out.details) out.details = parts.slice(3).join(', '); } else if (parts.length === 3) { if (!out.name) out.name = parts[0]; if (!out.phone) out.phone = parsePhoneLoose(parts[1]) || (parts[1] ? `+1${parts[1].replace(/\D/g, '')}` : ''); if (!out.city) out.city = parts[2]; } } if (!out.details) out.details = clean(lines.join(' ')); out.details = stripEmergency(out.details); if (out.name.length > 100) out.name = out.name.slice(0, 100); if (out.city.length > 60) out.city = out.city.slice(0, 60); if (out.details.length > 900) out.details = out.details.slice(0, 900); return out; }

// ─── APPS SCRIPT ACTIONS (Ajustadas para POST) ────────────────────────────────

async function pushLeadToScript({ session, from, profileName, statusOverride }) {
  const caseId = await ensureCase(session);
  const payload = {
    case_id: caseId, created_at: session.created_at || new Date().toISOString(),
    from_number: from, lang: session.lang || 'es',
    service: session.service || '', service_label: session.service_label || '',
    heater_type: session.heater_type || 'N/A',
    name: session.name || profileName || '', phone: session.phone || '',
    city: session.city || '', details: session.details || '',
    status: statusOverride || session.status || 'Nuevo',
    emergency: !!session.emergency,
  };
  const resp = await appsPost('lead', payload);
  if (!resp?.ok) await logError(from, caseId, 'lead', resp?.error || 'unknown', resp);
  await logLead(session, from);
  return resp;
}

async function listAvailability(session) {
  log('info', 'Consultando disponibilidad de citas');

  const resp = await appsPost('availability', {}, { limit: 6, days_ahead: 14 });

  log('info', 'Availability raw resp', { resp: resp ?? null });

  if (!resp?.ok || !Array.isArray(resp.slots)) {
    log('warn', 'Sin slots o error al consultar disponibilidad', {
      ok: resp?.ok ?? null,
      error: resp?.error ?? null,
      status: resp?.status ?? null,
      hasSlotsArray: Array.isArray(resp?.slots),
      keys: resp && typeof resp === 'object' ? Object.keys(resp) : null,
      sample: resp ? JSON.stringify(resp).slice(0, 400) : null
    });
    return null;
  }

  log('info', 'Slots encontrados', { count: resp.slots.length });
  session.slots = resp.slots;
  return resp.slots;
}

async function bookSlot({ session, slotIndex, from, profileName }) {
  const slots = Array.isArray(session.slots) ? session.slots : [];
  const s = slots[slotIndex];
  if (!s) return { ok: false, error: 'invalid_slot' };

  const caseId = await ensureCase(session);
  const payload = {
    case_id: caseId, name: session.name || profileName || 'Cliente',
    phone: session.phone || '', city: session.city || '', from_number: from,
    service_label: session.service_label || serviceName(session.service || 'cita', session.lang || 'es'),
    details: session.details || '', start_iso: s.start_iso, end_iso: s.end_iso, emergency: !!session.emergency,
  };

  const resp = await appsPost('book', payload);
  if (!resp?.ok) {
    await logError(from, caseId, 'book', resp?.error || 'unknown', { resp, payload });
    return resp || { ok: false, error: 'book_failed' };
  }

  session.appointment_start = resp.start_iso || s.start_iso || '';
  session.appointment_end = resp.end_iso || s.end_iso || '';
  session.calendar_event_id = resp.event_id || '';
  session.status = 'Programado';
  return { ok: true, book: resp };
}

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────────

const handler = async (req, res) => {
  try {
    if (TWILIO_AUTH_TOKEN && VALIDATE_TWILIO_SIG) {
      try { if (!validateTwilioSignature(req)) return res.status(403).send('Forbidden'); } catch {}
    }

    const { from, body, profileName } = parseInbound(req);
    if (!from || !body) return res.status(200).type('text/xml').send(twiml(''));
    if (isRateLimited(from)) return res.status(200).type('text/xml').send(twiml('⏳ Demasiados mensajes. Espera un momento.'));

    const key = from;
    const session = (await loadSession(key)) || freshSession();
    const idle = nowMs() - (session.last_seen || 0);
    session.last_seen = nowMs();
    const lower = norm(body);

    if (lower === 'english') session.lang = 'en';
    if (lower === 'español' || lower === 'espanol') session.lang = 'es';

    if (idle > WELCOME_AFTER_MS || isHello(body) || ['menu','start','back','inicio','volver'].includes(lower)) {
      resetSessionData(session);
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
    }

    // ── MENU ──
    if (session.step === 'menu') {
      const service = mapMenuChoiceToService(lower);
      if (!service) { await saveSession(key, session); return res.status(200).type('text/xml').send(twiml(menuText(session.lang))); }
      session.service = service; session.service_label = serviceName(service, session.lang); session.case_id = makeCaseId();
      session.name = ''; session.phone = ''; session.city = ''; session.details = ''; session.emergency = false; session.slots = [];
      if (service === 'calentador') {
        session.step = 'heater_type'; session.heater_type = 'N/A';
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(heaterMenu(session.lang)));
      }
      session.step = 'lead'; session.heater_type = 'N/A';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(leadPrompt(service, session.lang, null)));
    }

    // ── HEATER TYPE ──
    if (session.step === 'heater_type') {
      if (lower === '1') session.heater_type = 'SOLAR';
      else if (lower === '2') session.heater_type = 'Convencional';
      else { await saveSession(key, session); return res.status(200).type('text/xml').send(twiml(heaterMenu(session.lang))); }
      session.step = 'lead'; await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(leadPrompt('calentador', session.lang, session.heater_type)));
    }

    // ── LEAD ──
    if (session.step === 'lead') {
      if (isEmergency(body)) session.emergency = true;
      const parsed = parseLeadMessage(body);
      if (parsed.name) session.name = parsed.name; if (parsed.city) session.city = parsed.city;
      if (parsed.phone) session.phone = parsed.phone; if (parsed.details) session.details = parsed.details;

      if (!hasMinimumLead(session) || /^[1-6]$/.test(clean(body)) || !!normalizeYesNo(body)) {
        await saveSession(key, session); return res.status(200).type('text/xml').send(twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null)));
      }

      if (session.emergency) {
        session.status = 'Emergencia'; const caseId = await ensureCase(session);
        try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Emergencia' }); } catch (e) {}
        await alertAdmin('emergency', session, from); session.step = 'menu'; session.slots = []; await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(emergencyCallText(session.lang, caseId)));
      }

      session.status = 'Nuevo';
      try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Nuevo' }); } catch (e) {}
      await alertAdmin('new_lead', session, from);

      session.step = (session.service === 'cita') ? 'pick_slot' : 'ask_schedule';
      if (session.step === 'pick_slot') {
        const slots = await listAvailability(session); await saveSession(key, session);
        if (!slots?.length) {
          session.step = 'menu'; session.slots = []; await saveSession(key, session);
          return res.status(200).type('text/xml').send(twiml(`⚠️ No hay horarios disponibles ahora. Te contactamos pronto.\nCaso: ${session.case_id}`));
        }
        return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
      }
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(askSchedule(session.lang)));
    }

    // ── ASK SCHEDULE ──
    if (session.step === 'ask_schedule') {
      if (!hasMinimumLead(session)) { session.step = 'lead'; await saveSession(key, session); return res.status(200).type('text/xml').send(twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null))); }
      
      const yn = normalizeYesNo(body);
      if (!yn) { await saveSession(key, session); return res.status(200).type('text/xml').send(twiml(askSchedule(session.lang))); }

      if (yn === 'no') {
        session.step = 'menu'; await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(`✅ ¡Listo! Tu información fue guardada.\n\nCaso: ${session.case_id}\nTe contactaremos pronto. Escribe "menu" para regresar.`));
      }

      const slots = await listAvailability(session); session.step = 'pick_slot'; await saveSession(key, session);
      if (!slots?.length) {
        session.step = 'menu'; session.slots = []; await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(`⚠️ No hay horarios disponibles ahora. Te contactamos pronto.\nCaso: ${session.case_id}`));
      }
      return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
    }

    // ── PICK SLOT ──
    if (session.step === 'pick_slot') {
      if (!hasMinimumLead(session)) { session.step = 'lead'; await saveSession(key, session); return res.status(200).type('text/xml').send(twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null))); }

      const slots = Array.isArray(session.slots) ? session.slots : [];
      const n = Number(String(body || '').trim());

      if (!n || n < 1 || n > slots.length) {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(`Por favor responde con un número entre 1 y ${slots.length}.\n\n${formatSlots(session.lang, slots)}`));
      }

      const out = await bookSlot({ session, slotIndex: n - 1, from, profileName });
      if (!out?.ok) {
        if (out?.error === 'slot_taken') {
          const refreshed = await listAvailability(session); await saveSession(key, session);
          if (refreshed?.length) return res.status(200).type('text/xml').send(twiml(`⚠️ Ese horario ya fue reservado. Por favor escoge otro:\n\n${formatSlots(session.lang, refreshed)}`));
        }
        session.step = 'menu'; await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(`❌ No pudimos reservar ese horario. Intenta de nuevo o llámanos: ${PHONE}\nCaso: ${session.case_id}`));
      }

      try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Programado' }); } catch (e) {}
      await alertAdmin('booked', session, from);

      const chosen = slots[n - 1]; const slotLabel = session.lang === 'en' ? chosen.slot_en : chosen.slot_es;
      session.step = 'menu'; session.slots = []; await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(`✅ ¡Cita confirmada!\n\nCaso: ${session.case_id}\nCuándo: ${chosen.ymd} — ${slotLabel}\n\nTe estaremos contactando. Escribe "menu" para regresar.`));
    }

    session.step = 'menu'; await saveSession(key, session); return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));

  } catch (e) {
    try { await logError(req.body?.From, null, 'handler_exception', e?.message || String(e), { stack: e?.stack }); } catch {}
    return res.status(200).type('text/xml').send(twiml(''));
  }
};

// ─── RUTAS PROTEGIDAS ────────────────────────────────────────────────────────

// Middleware para proteger rutas sensibles
const requireAdmin = (req, res, next) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
};

app.post('/twilio',           handler);
app.post('/webhook/whatsapp', handler);
app.get('/', (req, res) => res.send(`${TAG} activo ✅`));
app.get('/__version', (req, res) => res.json({ ok: true, tag: TAG, node: process.version, uptime: Math.floor(process.uptime()) }));

app.get('/health', requireAdmin, async (req, res) => {
  try {
    const out = await appsPost('ready');
    res.json({ ok: true, apps_script: out?.ok ? 'connected' : 'error', apps_script_error: out?.ok ? null : out?.error });
  } catch (err) { res.json({ ok: false, apps_script: 'error', apps_script_error: err?.message }); }
});

app.get('/errors', requireAdmin, async (req, res) => {
  try { const rows = await db.all('SELECT * FROM error_log ORDER BY id DESC LIMIT 50'); res.json({ ok: true, count: rows.length, errors: rows }); } 
  catch (e) { res.json({ ok: false, error: e?.message }); }
});

app.get('/leads', requireAdmin, async (req, res) => {
  try { const rows = await db.all('SELECT * FROM lead_log ORDER BY id DESC LIMIT 100'); res.json({ ok: true, count: rows.length, leads: rows }); } 
  catch (e) { res.json({ ok: false, error: e?.message }); }
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────
let server;
async function shutdown(signal) {
  server.close(async () => { try { await db?.close(); } catch {} process.exit(0); });
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('SIGINT',  () => shutdown('SIGINT'));

initDB().then(() => { server = app.listen(PORT, () => log('info', `${TAG} activo`)); }).catch(() => process.exit(1));

```
