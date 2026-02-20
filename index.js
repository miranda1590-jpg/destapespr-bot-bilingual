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
const VALIDATE_TWILIO_SIG  = process.env.VALIDATE_TWILIO_SIGNATURE !== 'false'; // true por defecto

const SESSION_TTL_MS   = 48 * 60 * 60 * 1000;
const WELCOME_AFTER_MS = 12 * 60 * 60 * 1000;
const MAX_RETRIES      = 3;
const RETRY_DELAY_MS   = 900;
const FETCH_TIMEOUT_MS = 15000;

// Rate limit: máximo mensajes por usuario por ventana
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      k          TEXT    PRIMARY KEY,
      v          TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS error_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL,
      from_number TEXT,
      case_id     TEXT,
      action      TEXT,
      error       TEXT,
      details     TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS lead_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   TEXT    NOT NULL,
      case_id     TEXT,
      from_number TEXT,
      service     TEXT,
      name        TEXT,
      phone       TEXT,
      city        TEXT,
      status      TEXT,
      emergency   INTEGER
    );
  `);

  // Limpiar sesiones vencidas al arrancar
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

function normalizeWhatsAppAddr(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^whatsapp:/i.test(s)) return s;
  if (/^\+?\d+$/.test(s)) return `whatsapp:${s.startsWith('+') ? s : `+${s}`}`;
  return s;
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(msg) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(msg)}</Message></Response>`;
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function makeCaseId() {
  const d   = new Date();
  const y   = d.getUTCFullYear();
  const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `DP-${y}${m}${day}-${rnd}`;
}

// ─── RATE LIMITING ────────────────────────────────────────────────────────────

function isRateLimited(from) {
  const now  = nowMs();
  const info = rateLimitMap.get(from);
  if (!info || now > info.resetAt) {
    rateLimitMap.set(from, { count: 1, resetAt: now + RATE_LIMIT_WIN_MS });
    return false;
  }
  info.count++;
  if (info.count > RATE_LIMIT_MAX) {
    log('warn', 'Rate limit alcanzado', { from });
    return true;
  }
  return false;
}

// Limpiar mapa para evitar memory leak
setInterval(() => {
  const now = nowMs();
  for (const [k, v] of rateLimitMap) {
    if (now > v.resetAt) rateLimitMap.delete(k);
  }
}, 5 * 60 * 1000);

// ─── TWILIO SIGNATURE VALIDATION ─────────────────────────────────────────────

function validateTwilioSignature(req) {
  if (!VALIDATE_TWILIO_SIG || !TWILIO_AUTH_TOKEN) return true;

  const sig    = req.headers['x-twilio-signature'] || '';
  const url    = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const body   = req.body || {};
  const params = Object.keys(body).sort().reduce((acc, k) => acc + k + body[k], url);

  const expected = crypto
    .createHmac('sha1', TWILIO_AUTH_TOKEN)
    .update(params)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── FETCH CON TIMEOUT ────────────────────────────────────────────────────────

async function fetchTextWithTimeout(url) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res  = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

// ─── APPS SCRIPT ─────────────────────────────────────────────────────────────

async function appsGet(action, payload = {}, extraQuery = {}) {
  if (!APPS_SCRIPT_URL) throw new Error('missing APPS_SCRIPT_URL');

  const qs = new URLSearchParams();
  qs.set('action', String(action || '').trim());

  if (action !== 'ready') {
    if (!APPS_SCRIPT_TOKEN) throw new Error('missing APPS_SCRIPT_TOKEN');
    qs.set('token', APPS_SCRIPT_TOKEN);
  }

  if (payload && Object.keys(payload).length) qs.set('p', b64url(payload));

  for (const [k, v] of Object.entries(extraQuery || {})) {
    if (v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
  }

  const url = `${APPS_SCRIPT_URL}?${qs.toString()}`;

  if (url.length > 2000) log('warn', 'URL muy larga hacia Apps Script', { length: url.length, action });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { status, text } = await fetchTextWithTimeout(url);
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        log('warn', 'Respuesta no-JSON de Apps Script', { action, attempt, status, raw: text.slice(0, 200) });
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
        return { ok: false, error: 'non_json_response', status, raw: text.slice(0, 500) };
      }

      if (json?.ok === true) return json;
      if (json?.error === 'unauthorized') {
        log('error', 'Token rechazado por Apps Script', { action });
        return json;
      }

      log('warn', 'Apps Script respondió ok=false', { action, attempt, error: json?.error });
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
      return json || { ok: false, error: 'unknown' };

    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
      log('warn', `Error fetch Apps Script (intento ${attempt})`, { action, error: msg });
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
      return { ok: false, error: 'fetch_failed', details: msg };
    }
  }

  return { ok: false, error: 'max_retries_exceeded' };
}

// ─── WHATSAPP OUTBOUND ────────────────────────────────────────────────────────

async function sendWhatsApp(to, text) {
  try {
    const toAddr   = normalizeWhatsAppAddr(to);
    const fromAddr = normalizeWhatsAppAddr(TWILIO_WHATSAPP_FROM);
    if (!toAddr || !fromAddr) return { ok: false, skipped: 'missing_to_or_from' };
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return { ok: false, skipped: 'missing_twilio_creds' };

    const url  = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const body = new URLSearchParams();
    body.set('To',   toAddr);
    body.set('From', fromAddr);
    body.set('Body', String(text || '').slice(0, 1500));

    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`, 'utf8').toString('base64');
    const res  = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const t = await res.text();
    if (!res.ok) {
      log('error', 'Error enviando WhatsApp', { to: toAddr, status: res.status });
      return { ok: false, status: res.status, raw: t.slice(0, 500) };
    }
    return { ok: true };
  } catch (e) {
    log('error', 'Excepción enviando WhatsApp', { error: e?.message });
    return { ok: false, error: String(e?.message || e) };
  }
}

// ─── ALERTAS ADMIN ────────────────────────────────────────────────────────────

async function alertAdmin(type, session, from) {
  if (!ADMIN_WHATSAPP) return;

  const templates = {
    new_lead: () => [
      `🆕 *NUEVO LEAD*`,
      `Caso:     ${session.case_id}`,
      `Servicio: ${session.service_label}`,
      `Nombre:   ${session.name  || 'N/A'}`,
      `Tel:      ${session.phone || 'N/A'}`,
      `Pueblo:   ${session.city  || 'N/A'}`,
      `WA:       ${from}`,
      `Detalle:  ${(session.details || '').slice(0, 200)}`,
    ].join('\n'),

    emergency: () => [
      `🚨 *EMERGENCIA*`,
      `Caso:     ${session.case_id}`,
      `Servicio: ${session.service_label}`,
      `Nombre:   ${session.name  || 'N/A'}`,
      `Tel:      ${session.phone || 'N/A'}`,
      `Pueblo:   ${session.city  || 'N/A'}`,
      `WA:       ${from}`,
      `Detalle:  ${(session.details || '').slice(0, 200)}`,
    ].join('\n'),

    booked: () => [
      `📅 *CITA AGENDADA*`,
      `Caso:     ${session.case_id}`,
      `Servicio: ${session.service_label}`,
      `Nombre:   ${session.name  || 'N/A'}`,
      `Tel:      ${session.phone || 'N/A'}`,
      `Pueblo:   ${session.city  || 'N/A'}`,
      `Cuando:   ${session.appointment_start || 'N/A'}`,
    ].join('\n'),
  };

  const builder = templates[type];
  if (!builder) return;

  const result = await sendWhatsApp(ADMIN_WHATSAPP, builder());
  if (!result.ok) log('warn', 'No se pudo enviar alerta admin', { type, error: result.error || result.skipped });
}

// ─── DB HELPERS ──────────────────────────────────────────────────────────────

async function logError(from, caseId, action, error, details) {
  try {
    await db.run(
      'INSERT INTO error_log (timestamp, from_number, case_id, action, error, details) VALUES (?,?,?,?,?,?)',
      new Date().toISOString(), from || '', caseId || '', action || '',
      String(error || ''), JSON.stringify(details || {})
    );
  } catch (e) {
    log('error', 'No se pudo guardar error en DB', { error: e?.message });
  }
}

async function logLead(session, from) {
  try {
    await db.run(
      'INSERT INTO lead_log (timestamp,case_id,from_number,service,name,phone,city,status,emergency) VALUES (?,?,?,?,?,?,?,?,?)',
      new Date().toISOString(),
      session.case_id || '', from || '',
      session.service || '', session.name || '',
      session.phone || '', session.city || '',
      session.status || 'Nuevo', session.emergency ? 1 : 0
    );
  } catch {}
}

async function loadSession(key) {
  try {
    const row = await db.get('SELECT v, updated_at FROM sessions WHERE k=?', key);
    if (!row) return null;
    if (nowMs() - row.updated_at > SESSION_TTL_MS) {
      await db.run('DELETE FROM sessions WHERE k=?', key);
      return null;
    }
    return JSON.parse(row.v);
  } catch { return null; }
}

async function saveSession(key, obj) {
  const v = JSON.stringify(obj || {});
  const t = nowMs();
  await db.run(
    'INSERT INTO sessions(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at',
    key, v, t
  );
}

// ─── SESIÓN ───────────────────────────────────────────────────────────────────

function freshSession() {
  return {
    lang: 'es', step: 'menu',
    created_at: new Date().toISOString(), last_seen: nowMs(),
    service: '', service_label: '', heater_type: 'N/A', case_id: '',
    name: '', phone: '', city: '', details: '', emergency: false,
    slots: [], appointment_start: '', appointment_end: '',
    calendar_event_id: '', status: 'Nuevo',
  };
}

function resetSessionData(session) {
  Object.assign(session, {
    step: 'menu', service: '', service_label: '', heater_type: 'N/A',
    case_id: '', name: '', phone: '', city: '', details: '',
    emergency: false, slots: [], appointment_start: '',
    appointment_end: '', calendar_event_id: '', status: 'Nuevo',
  });
}

const hasMinimumLead = (s) => !!(clean(s.phone) && clean(s.city));

async function ensureCase(session) {
  if (!session.case_id) session.case_id = makeCaseId();
  return session.case_id;
}

// ─── TEXTOS ───────────────────────────────────────────────────────────────────

function isHello(text) {
  const t = norm(text);
  return ['hola','hello','hi','hey','menu','start','inicio','back','volver','buenas','saludos'].includes(t);
}

function menuText(lang) {
  if (lang === 'en') return [
    `👋 Welcome to DestapesPR.`, ``,
    `Choose a number or type what you need:`, ``,
    `1️⃣ Drain cleaning (clogged drains/pipes)`,
    `2️⃣ Leak (water leaks / dampness)`,
    `3️⃣ Camera inspection (video)`,
    `4️⃣ Water heater (gas/electric/solar)`,
    `5️⃣ Other plumbing service`,
    `6️⃣ Appointment / schedule a visit`, ``,
    `💬 Commands: "start", "menu" or "back"`,
    `🌐 Type "español" to switch language`, ``,
    `📘 Facebook: ${FB_LINK}`,
    `📞 Phone: ${PHONE}`, ``,
    `Example: "My name is John Rivera, 787-555-1234, Caguas, kitchen sink clogged"`,
  ].join('\n');

  return [
    `👋 Bienvenido a DestapesPR.`, ``,
    `Selecciona un número o escribe lo que necesitas:`, ``,
    `1️⃣ Destape (drenajes o tuberías tapadas)`,
    `2️⃣ Fuga de agua (goteos / filtraciones)`,
    `3️⃣ Inspección con cámara (video)`,
    `4️⃣ Calentador (gas/eléctrico/solar)`,
    `5️⃣ Otro servicio de plomería`,
    `6️⃣ Cita / coordinar visita`, ``,
    `💬 Comandos: "inicio", "menu" o "volver"`,
    `🌐 Escribe "english" para cambiar idioma`, ``,
    `📘 Facebook: ${FB_LINK}`,
    `📞 Tel: ${PHONE}`, ``,
    `Ejemplo: "Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`,
  ].join('\n');
}

function serviceName(service, lang) {
  const names = {
    destape:    { es: 'Destape',                   en: 'Drain cleaning' },
    fuga:       { es: 'Fuga de agua',              en: 'Water leak' },
    camara:     { es: 'Inspección con cámara',     en: 'Camera inspection' },
    calentador: { es: 'Calentador',                en: 'Water heater' },
    otro:       { es: 'Otro servicio de plomería', en: 'Other plumbing service' },
    cita:       { es: 'Cita / coordinar visita',   en: 'Appointment' },
  };
  const k = names[service] ? service : 'otro';
  return names[k][lang === 'en' ? 'en' : 'es'];
}

function heaterMenu(lang) {
  if (lang === 'en') return [
    `✅ Service: Water heater`, ``,
    `Choose heater type:`,
    `1️⃣ Solar`,
    `2️⃣ Conventional (gas/electric)`, ``,
    `Reply with 1 or 2.`,
  ].join('\n');

  return [
    `✅ Servicio: Calentador`, ``,
    `Elige tipo:`,
    `1️⃣ Solar`,
    `2️⃣ Convencional (gas/eléctrico)`, ``,
    `Responde 1 o 2.`,
  ].join('\n');
}

function isEmergency(text) {
  const s = norm(text);
  if (!s) return false;
  return (
    s.includes('emergenc') || s.includes('urgente')     || s.includes('inund')  ||
    s.includes('revento')  || s.includes('exploto')     || s.includes('flooding') ||
    s.includes('agua por todos lados')                  || s.includes('fuga grande') ||
    s.includes('pipe burst')
  );
}

function stripEmergency(text) {
  return clean(
    String(text || '')
      .replace(/\bemergencia\b/gi, '')
      .replace(/\bemergency\b/gi, '')
      .replace(/\burgente\b/gi, '')
      .replace(/\s*,\s*,/g, ',')
      .replace(/\s{2,}/g, ' ')
  );
}

function leadPrompt(service, lang, heaterType) {
  const title    = lang === 'en' ? `✅ Service: ${serviceName(service, lang)}` : `✅ Servicio: ${serviceName(service, lang)}`;
  const typeLine = service === 'calentador' && heaterType
    ? (lang === 'en' ? `✅ Type: ${heaterType}` : `✅ Tipo: ${heaterType}`)
    : null;

  if (lang === 'en') return [title, typeLine, ``,
    `Please send EVERYTHING in ONE message:`,
    `• 👤 Full name`,
    `• 📞 Contact number`,
    `• 📍 City / area / sector`,
    `• 📝 Short description of the problem`, ``,
    `Example:`,
    `"My name is John Rivera, 787-555-1234, Caguas, kitchen sink clogged"`, ``,
    `🚨 Emergency? CALL NOW for fastest response: ${PHONE}`,
  ].filter(Boolean).join('\n');

  return [title, typeLine, ``,
    `Por favor envía TODO en UN solo mensaje:`,
    `• 👤 Nombre completo`,
    `• 📞 Número de contacto`,
    `• 📍 Municipio / zona / sector`,
    `• 📝 Descripción breve del problema`, ``,
    `Ejemplo:`,
    `"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`, ``,
    `🚨 ¿Emergencia? Llama AHORA para atención inmediata: ${PHONE}`,
  ].filter(Boolean).join('\n');
}

function askSchedule(lang) {
  if (lang === 'en') return [
    `📅 Do you want to schedule an appointment now?`, ``,
    `Reply YES or NO`, ``,
    `🚨 Emergency? CALL now: ${PHONE}`,
  ].join('\n');

  return [
    `📅 ¿Quieres agendar una cita ahora?`, ``,
    `Responde SI o NO`, ``,
    `🚨 ¿Emergencia? Llama ahora: ${PHONE}`,
  ].join('\n');
}

function emergencyCallText(lang, caseId) {
  if (lang === 'en') return [
    `🚨 *Emergency detected*`, ``,
    `For fastest assistance, CALL NOW: ${PHONE}`, ``,
    caseId ? `Case ID: ${caseId}` : null, ``,
    `You can also reply with your info (name, phone, city, brief description) and we will contact you.`, ``,
    `Type "menu" to return.`,
  ].filter(Boolean).join('\n');

  return [
    `🚨 *Emergencia detectada*`, ``,
    `Para atención inmediata, llama AHORA: ${PHONE}`, ``,
    caseId ? `Caso: ${caseId}` : null, ``,
    `También puedes responder con tu info (nombre, tel, pueblo, descripción breve) y te contactamos.`, ``,
    `Escribe "menu" para regresar.`,
  ].filter(Boolean).join('\n');
}

function formatSlots(lang, slots) {
  const lines = [lang === 'en' ? `📅 Available slots:` : `📅 Horarios disponibles:`, ''];
  for (let i = 0; i < slots.length; i++) {
    const label = lang === 'en' ? slots[i].slot_en : slots[i].slot_es;
    lines.push(`${i + 1}️⃣ ${slots[i].ymd} — ${label}`);
  }
  lines.push('');
  lines.push(lang === 'en'
    ? `Reply with a number (1-${slots.length}) or type "menu" to cancel.`
    : `Responde con un número (1-${slots.length}) o escribe "menu" para cancelar.`);
  return lines.join('\n');
}

// ─── PARSING ─────────────────────────────────────────────────────────────────

function parseInbound(req) {
  const from        = normalizeFrom(req.body.From || req.body.from || req.body.WaId || '');
  const body        = clean(req.body.Body || req.body.body || '');
  const profileName = clean(req.body.ProfileName || req.body.profileName || '');
  return { from, body, profileName };
}

function parsePhoneLoose(s) {
  const t = String(s || '');
  const m = t.match(/(\+?1)?\s*[\(]?\s*(\d{3})\s*[\)]?\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})/);
  if (!m) return '';
  return `+1${m[2]}${m[3]}${m[4]}`;
}

function parseLeadMessage(text) {
  const raw0 = String(text || '').trim();
  const raw  = stripEmergency(raw0);
  const out  = { name: '', city: '', phone: '', details: '' };

  const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);

  for (const l of lines) {
    const m1 = l.match(/^(nombre|name)\s*:\s*(.+)$/i);
    if (m1) { out.name = clean(m1[2]); continue; }

    const m2 = l.match(/^(pueblo|municipio|ciudad|city|location|ubicacion)\s*:\s*(.+)$/i);
    if (m2) { out.city = clean(m2[2]); continue; }

    const m3 = l.match(/^(tel|telefono|phone|celular|numero)\s*:\s*(.+)$/i);
    if (m3) {
      const p = parsePhoneLoose(m3[2]) || clean(m3[2]).replace(/[^\d+]/g, '');
      out.phone = p.startsWith('+') ? p : (p ? `+1${p.replace(/\D/g, '')}` : '');
      continue;
    }

    const m4 = l.match(/^(detalles|details|problema|problem|descripcion|description)\s*:\s*(.+)$/i);
    if (m4) { out.details = clean(m4[2]); continue; }
  }

  if (!out.phone) out.phone = parsePhoneLoose(raw);

  if ((!out.name || !out.city || !out.details) && raw.includes(',')) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 4) {
      if (!out.name)    out.name    = parts[0];
      if (!out.phone)   out.phone   = parsePhoneLoose(parts[1]) || (parts[1] ? `+1${parts[1].replace(/\D/g, '')}` : '');
      if (!out.city)    out.city    = parts[2];
      if (!out.details) out.details = parts.slice(3).join(', ');
    } else if (parts.length === 3) {
      if (!out.name)  out.name  = parts[0];
      if (!out.phone) out.phone = parsePhoneLoose(parts[1]) || (parts[1] ? `+1${parts[1].replace(/\D/g, '')}` : '');
      if (!out.city)  out.city  = parts[2];
    }
  }

  if (!out.details) out.details = clean(lines.join(' '));
  out.details = stripEmergency(out.details);

  if (out.name.length    > 100) out.name    = out.name.slice(0, 100);
  if (out.city.length    > 60)  out.city    = out.city.slice(0, 60);
  if (out.details.length > 900) out.details = out.details.slice(0, 900);

  return out;
}

function normalizeYesNo(t) {
  const s = norm(t);
  if (['si','sí','s','yes','y','ok','dale','claro','sure','yep'].includes(s)) return 'yes';
  if (['no','n','nope','nel'].includes(s)) return 'no';
  return '';
}

function mapMenuChoiceToService(choice) {
  return { '1':'destape','2':'fuga','3':'camara','4':'calentador','5':'otro','6':'cita' }[choice] || '';
}

// ─── APPS SCRIPT ACTIONS ──────────────────────────────────────────────────────

async function pushLeadToScript({ session, from, profileName, statusOverride }) {
  const caseId  = await ensureCase(session);
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

  log('info', 'Enviando lead a Apps Script', { case_id: caseId, service: payload.service, status: payload.status });
  const resp = await appsGet('lead', payload);
  if (!resp?.ok) await logError(from, caseId, 'lead', resp?.error || 'unknown', resp);
  else log('info', 'Lead registrado OK', { case_id: caseId });

  await logLead(session, from);
  return resp;
}

async function listAvailability(session) {
  log('info', 'Consultando disponibilidad de citas');
  const resp = await appsGet('availability', {}, { limit: 6, days_ahead: 14 });
  if (!resp?.ok || !Array.isArray(resp.slots)) {
    log('warn', 'Sin slots o error al consultar disponibilidad', { error: resp?.error });
    return null;
  }
  session.slots         = resp.slots;
  session.slot_offer_at = new Date().toISOString();
  return resp.slots;
}

async function bookSlot({ session, slotIndex, from, profileName }) {
  const slots = Array.isArray(session.slots) ? session.slots : [];
  const s     = slots[slotIndex];
  if (!s) return { ok: false, error: 'invalid_slot' };

  const caseId  = await ensureCase(session);
  const payload = {
    case_id: caseId,
    name: session.name || profileName || 'Cliente',
    phone: session.phone || '', city: session.city || '',
    from_number: from,
    service_label: session.service_label || serviceName(session.service || 'cita', session.lang || 'es'),
    details: session.details || '',
    start_iso: s.start_iso, end_iso: s.end_iso,
    emergency: !!session.emergency,
  };

  log('info', 'Reservando slot', { case_id: caseId, start: s.start_iso });
  const resp = await appsGet('book', payload);

  if (!resp?.ok) {
    log('error', 'Error reservando slot', { case_id: caseId, error: resp?.error });
    await logError(from, caseId, 'book', resp?.error || 'unknown', { resp, payload });
    return resp || { ok: false, error: 'book_failed' };
  }

  session.appointment_start = resp.start_iso || s.start_iso || '';
  session.appointment_end   = resp.end_iso   || s.end_iso   || '';
  session.calendar_event_id = resp.event_id  || '';
  session.status            = 'Programado';

  log('info', 'Cita agendada OK', { case_id: caseId });
  return { ok: true, book: resp };
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

const handler = async (req, res) => {
  try {
    // Validar firma Twilio (se omite en desarrollo local si falla)
    if (TWILIO_AUTH_TOKEN && VALIDATE_TWILIO_SIG) {
      try {
        if (!validateTwilioSignature(req)) {
          log('warn', 'Firma Twilio inválida — request rechazado');
          return res.status(403).send('Forbidden');
        }
      } catch { /* continúa en desarrollo */ }
    }

    const { from, body, profileName } = parseInbound(req);
    if (!from || !body) return res.status(200).type('text/xml').send(twiml(''));

    if (isRateLimited(from)) {
      return res.status(200).type('text/xml').send(
        twiml('⏳ Demasiados mensajes. Espera un momento e intenta de nuevo.')
      );
    }

    const key     = from;
    const session = (await loadSession(key)) || freshSession();
    const idle    = nowMs() - (session.last_seen || 0);
    session.last_seen = nowMs();

    const lower = norm(body);

    if (lower === 'english')                        session.lang = 'en';
    if (lower === 'español' || lower === 'espanol') session.lang = 'es';

    // Bienvenida / reset
    if (idle > WELCOME_AFTER_MS || isHello(body) || ['menu','start','back','inicio','volver'].includes(lower)) {
      resetSessionData(session);
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
    }

    // ── MENU ────────────────────────────────────────────────────────────────
    if (session.step === 'menu') {
      const service = mapMenuChoiceToService(lower);
      if (!service) {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
      }

      session.service = service; session.service_label = serviceName(service, session.lang);
      session.case_id = makeCaseId();
      session.name = ''; session.phone = ''; session.city = ''; session.details = '';
      session.emergency = false; session.slots = [];

      log('info', 'Servicio seleccionado', { from, service, case_id: session.case_id });

      if (service === 'calentador') {
        session.step = 'heater_type'; session.heater_type = 'N/A';
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(heaterMenu(session.lang)));
      }

      session.step = 'lead'; session.heater_type = 'N/A';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(leadPrompt(service, session.lang, null)));
    }

    // ── HEATER TYPE ─────────────────────────────────────────────────────────
    if (session.step === 'heater_type') {
      if (lower === '1')      session.heater_type = 'SOLAR';
      else if (lower === '2') session.heater_type = 'Convencional';
      else {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(heaterMenu(session.lang)));
      }
      session.step = 'lead';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(leadPrompt('calentador', session.lang, session.heater_type)));
    }

    // ── LEAD ────────────────────────────────────────────────────────────────
    if (session.step === 'lead') {
      if (isEmergency(body)) session.emergency = true;

      const parsed = parseLeadMessage(body);
      if (parsed.name)    session.name    = parsed.name;
      if (parsed.city)    session.city    = parsed.city;
      if (parsed.phone)   session.phone   = parsed.phone;
      if (parsed.details) session.details = parsed.details;

      const looksLikeMenuPress = /^[1-6]$/.test(clean(body));
      const looksLikeYesNo     = !!normalizeYesNo(body);

      if (!hasMinimumLead(session) || looksLikeMenuPress || looksLikeYesNo) {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(
          twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null))
        );
      }

      if (session.emergency) {
        session.status = 'Emergencia';
        const caseId   = await ensureCase(session);
        try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Emergencia' }); }
        catch (e) { await logError(from, session.case_id, 'lead_exception', e?.message, { stack: e?.stack }); }
        await alertAdmin('emergency', session, from);
        const msg    = emergencyCallText(session.lang, caseId);
        session.step = 'menu'; session.slots = [];
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      session.status = 'Nuevo';
      try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Nuevo' }); }
      catch (e) { await logError(from, session.case_id, 'lead_exception', e?.message, { stack: e?.stack }); }
      await alertAdmin('new_lead', session, from);

      session.step = (session.service === 'cita') ? 'pick_slot' : 'ask_schedule';

      if (session.step === 'pick_slot') {
        const slots = await listAvailability(session);
        await saveSession(key, session);
        if (!slots?.length) {
          const msg    = session.lang === 'en'
            ? `⚠️ No slots available right now. We'll contact you.\nCase: ${session.case_id}`
            : `⚠️ No hay horarios disponibles ahora. Te contactamos pronto.\nCaso: ${session.case_id}`;
          session.step = 'menu'; session.slots = [];
          await saveSession(key, session);
          return res.status(200).type('text/xml').send(twiml(msg));
        }
        return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
      }

      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(askSchedule(session.lang)));
    }

    // ── ASK SCHEDULE ────────────────────────────────────────────────────────
    if (session.step === 'ask_schedule') {
      if (!hasMinimumLead(session)) {
        session.step = 'lead'; await saveSession(key, session);
        return res.status(200).type('text/xml').send(
          twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null))
        );
      }

      if (isEmergency(body)) {
        session.emergency = true; session.status = 'Emergencia';
        const caseId = await ensureCase(session);
        try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Emergencia' }); }
        catch (e) { await logError(from, session.case_id, 'lead_exception', e?.message, { stack: e?.stack }); }
        await alertAdmin('emergency', session, from);
        const msg    = emergencyCallText(session.lang, caseId);
        session.step = 'menu'; session.slots = [];
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      const yn = normalizeYesNo(body);
      if (!yn) {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(askSchedule(session.lang)));
      }

      if (yn === 'no') {
        session.step = 'menu'; await saveSession(key, session);
        const msg = session.lang === 'en'
          ? `✅ Got it! Your info has been saved.\n\nCase ID: ${session.case_id}\nService: ${session.service_label}\nDetails: "${session.details}"\n\nWe'll reach out soon. Type "menu" to return.`
          : `✅ ¡Listo! Tu información fue guardada.\n\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nDetalles: "${session.details}"\n\nTe contactaremos pronto. Escribe "menu" para regresar.`;
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      const slots = await listAvailability(session);
      session.step = 'pick_slot'; await saveSession(key, session);

      if (!slots?.length) {
        const msg    = session.lang === 'en'
          ? `⚠️ No slots available right now. We'll contact you.\nCase: ${session.case_id}`
          : `⚠️ No hay horarios disponibles ahora. Te contactamos pronto.\nCaso: ${session.case_id}`;
        session.step = 'menu'; session.slots = [];
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
    }

    // ── PICK SLOT ───────────────────────────────────────────────────────────
    if (session.step === 'pick_slot') {
      if (!hasMinimumLead(session)) {
        session.step = 'lead'; await saveSession(key, session);
        return res.status(200).type('text/xml').send(
          twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null))
        );
      }

      if (isEmergency(body) || session.emergency) {
        session.emergency = true; session.status = 'Emergencia';
        const caseId = await ensureCase(session);
        try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Emergencia' }); }
        catch (e) { await logError(from, session.case_id, 'lead_exception', e?.message, { stack: e?.stack }); }
        await alertAdmin('emergency', session, from);
        const msg    = emergencyCallText(session.lang, caseId);
        session.step = 'menu'; session.slots = [];
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      const slots = Array.isArray(session.slots) ? session.slots : [];
      const n     = Number(String(body || '').trim());

      if (!n || n < 1 || n > slots.length) {
        await saveSession(key, session);
        const prompt = session.lang === 'en'
          ? `Please reply with a number between 1 and ${slots.length}.`
          : `Por favor responde con un número entre 1 y ${slots.length}.`;
        return res.status(200).type('text/xml').send(twiml(`${prompt}\n\n${formatSlots(session.lang, slots)}`));
      }

      const out = await bookSlot({ session, slotIndex: n - 1, from, profileName });

      if (!out?.ok) {
        await logError(from, session.case_id, 'book_slot_ui', out?.error || 'unknown', out);

        if (out?.error === 'slot_taken') {
          const refreshed = await listAvailability(session);
          await saveSession(key, session);
          if (refreshed?.length) {
            const msg = session.lang === 'en'
              ? `⚠️ That slot was just taken. Please choose another:\n\n${formatSlots(session.lang, refreshed)}`
              : `⚠️ Ese horario ya fue reservado. Por favor escoge otro:\n\n${formatSlots(session.lang, refreshed)}`;
            return res.status(200).type('text/xml').send(twiml(msg));
          }
        }

        if (out?.error === 'missing_required_fields') {
          session.step = 'lead'; await saveSession(key, session);
          const msg = session.lang === 'en'
            ? `⚠️ We need your phone and city to book.\n\n${leadPrompt(session.service || 'otro', session.lang, null)}`
            : `⚠️ Necesitamos tu teléfono y pueblo para reservar.\n\n${leadPrompt(session.service || 'otro', session.lang, null)}`;
          return res.status(200).type('text/xml').send(twiml(msg));
        }

        const errorMsg = session.lang === 'en'
          ? `❌ We couldn't book that slot. Try again or call us: ${PHONE}\nCase: ${session.case_id}`
          : `❌ No pudimos reservar ese horario. Intenta de nuevo o llámanos: ${PHONE}\nCaso: ${session.case_id}`;
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(errorMsg));
      }

      try { await pushLeadToScript({ session, from, profileName, statusOverride: 'Programado' }); }
      catch (e) { await logError(from, session.case_id, 'lead_after_book_exception', e?.message, { stack: e?.stack }); }

      await alertAdmin('booked', session, from);

      const chosen    = slots[n - 1];
      const slotLabel = session.lang === 'en' ? chosen.slot_en : chosen.slot_es;
      const msg = session.lang === 'en'
        ? `✅ Appointment confirmed!\n\nCase ID: ${session.case_id}\nService: ${session.service_label}\nWhen: ${chosen.ymd} — ${slotLabel}\n\nWe'll contact you shortly. Type "menu" to return.`
        : `✅ ¡Cita confirmada!\n\nCaso: ${session.case_id}\nServicio: ${session.service_label}\nCuándo: ${chosen.ymd} — ${slotLabel}\n\nTe estaremos contactando. Escribe "menu" para regresar.`;

      session.step = 'menu'; session.slots = [];
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(msg));
    }

    // Fallback
    session.step = 'menu'; await saveSession(key, session);
    return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));

  } catch (e) {
    log('error', 'Excepción en handler', { error: e?.message, stack: e?.stack?.slice(0, 500) });
    try { await logError(req.body?.From, null, 'handler_exception', e?.message || String(e), { stack: e?.stack }); } catch {}
    return res.status(200).type('text/xml').send(twiml(''));
  }
};

// ─── RUTAS ────────────────────────────────────────────────────────────────────

app.post('/twilio',           handler);
app.post('/webhook/whatsapp', handler);

app.get('/', (req, res) => res.send(`${TAG} activo ✅`));

app.get('/__version', (req, res) => res.json({
  ok:      true,
  tag:     TAG,
  commit:  process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || null,
  service: process.env.RENDER_SERVICE_NAME || null,
  node:    process.version,
  uptime:  Math.floor(process.uptime()),
}));

app.get('/health', async (req, res) => {
  try {
    const out = await appsGet('ready');
    res.json({
      ok:                  true,
      tag:                 TAG,
      apps_script:         out?.ok ? 'connected' : 'error',
      apps_script_version: out?.version || null,
      apps_script_url:     APPS_SCRIPT_URL    ? 'configured' : 'missing',
      apps_script_token:   APPS_SCRIPT_TOKEN  ? 'configured' : 'missing',
      apps_script_error:   out?.ok ? null : (out?.error || 'unknown'),
      admin_whatsapp:      ADMIN_WHATSAPP     ? 'configured' : 'missing',
      twilio_from:         TWILIO_WHATSAPP_FROM ? 'configured' : 'missing',
      twilio_sig_validate: VALIDATE_TWILIO_SIG,
      calendar_id:         out?.calendar_id || null,
      tz:                  out?.tz || null,
      uptime_seconds:      Math.floor(process.uptime()),
    });
  } catch (err) {
    res.json({ ok: false, tag: TAG, apps_script: 'error', apps_script_error: err?.message || String(err) });
  }
});

// Ver errores recientes (debug)
app.get('/errors', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM error_log ORDER BY id DESC LIMIT 50');
    res.json({ ok: true, count: rows.length, errors: rows });
  } catch (e) { res.json({ ok: false, error: e?.message }); }
});

// Ver leads registrados localmente
app.get('/leads', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM lead_log ORDER BY id DESC LIMIT 100');
    res.json({ ok: true, count: rows.length, leads: rows });
  } catch (e) { res.json({ ok: false, error: e?.message }); }
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

let server;

async function shutdown(signal) {
  log('info', `Señal ${signal} recibida — cerrando servidor...`);
  server.close(async () => {
    try { await db?.close(); } catch {}
    log('info', 'Servidor cerrado correctamente.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── START ────────────────────────────────────────────────────────────────────

initDB()
  .then(() => {
    server = app.listen(PORT, () => {
      log('info', `${TAG} escuchando en puerto ${PORT}`);
      log('info', `Apps Script URL:  ${APPS_SCRIPT_URL    ? '✅ configurado' : '❌ FALTA'}`);
      log('info', `Admin WhatsApp:   ${ADMIN_WHATSAPP     ? '✅ configurado' : '⚠️  no configurado (alertas desactivadas)'}`);
      log('info', `Twilio sig:       ${VALIDATE_TWILIO_SIG ? '✅ activo' : '⚠️  desactivado'}`);
    });
  })
  .catch((err) => {
    log('error', 'Error iniciando DB', { error: err?.message });
    process.exit(1);
  });
