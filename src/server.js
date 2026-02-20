/* DEPLOY_BUMP: 20260220-071622 */
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

const TAG = process.env.TAG || 'DestapesPR Bot 🇵🇷';
const PHONE = process.env.PHONE || '+1 787-922-0068';
const FB_LINK = process.env.FB_LINK || 'https://www.facebook.com/destapesPR/';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || process.env.DESTAPESPR_TOKEN || '';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
const WELCOME_AFTER_MS = 12 * 60 * 60 * 1000;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 900;
const FETCH_TIMEOUT_MS = 15000;

let db;

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      from_number TEXT,
      case_id TEXT,
      action TEXT,
      error TEXT,
      details TEXT
    );
  `);
}

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clean(s) {
  return String(s || '').trim();
}

function normalizeFrom(from) {
  const s = String(from || '').trim();
  if (!s) return '';
  if (/^whatsapp:/i.test(s)) return s;
  if (/^\+?\d+$/.test(s)) return `whatsapp:${s.startsWith('+') ? s : `+${s}`}`;
  return s;
}

function parseInbound(req) {
  const from = normalizeFrom(req.body.From || req.body.from || req.body.WaId || '');
  const body = clean(req.body.Body || req.body.body || '');
  const profileName = clean(req.body.ProfileName || req.body.profileName || '');
  return { from, body, profileName };
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
  const s = JSON.stringify(obj);
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function fetchTextWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

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

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { status, text } = await fetchTextWithTimeout(url);
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        return { ok: false, error: 'non_json_response', status, raw: text.slice(0, 500) };
      }

      if (json?.ok === true) return json;
      if (json?.error === 'unauthorized') return json;

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return json || { ok: false, error: 'unknown' };
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return { ok: false, error: 'fetch_failed', details: msg };
    }
  }

  return { ok: false, error: 'max_retries_exceeded' };
}

async function logError(from, caseId, action, error, details) {
  try {
    await db.run(
      'INSERT INTO error_log (timestamp, from_number, case_id, action, error, details) VALUES (?, ?, ?, ?, ?, ?)',
      new Date().toISOString(),
      from || '',
      caseId || '',
      action || '',
      String(error || ''),
      JSON.stringify(details || {})
    );
  } catch {}
}

function makeCaseId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `DP-${y}${m}${day}-${rnd}`;
}

async function loadSession(key) {
  const row = await db.get('SELECT v, updated_at FROM sessions WHERE k=?', key);
  if (!row) return null;
  if (nowMs() - row.updated_at > SESSION_TTL_MS) {
    await db.run('DELETE FROM sessions WHERE k=?', key);
    return null;
  }
  try {
    return JSON.parse(row.v);
  } catch {
    return null;
  }
}

async function saveSession(key, obj) {
  const v = JSON.stringify(obj || {});
  const t = nowMs();
  await db.run(
    'INSERT INTO sessions(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at',
    key,
    v,
    t
  );
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function isHello(text) {
  const t = norm(text);
  return (
    t === 'hola' ||
    t === 'hello' ||
    t === 'hi' ||
    t === 'hey' ||
    t === 'menu' ||
    t === 'start' ||
    t === 'inicio' ||
    t === 'back' ||
    t === 'volver' ||
    t === 'buenas' ||
    t === 'saludos'
  );
}

function menuText(lang) {
  if (lang === 'en') {
    return [
      `👋 Welcome to DestapesPR.`,
      ``,
      `Choose a number or type what you need:`,
      ``,
      `1️⃣ Drain cleaning (clogged drains/pipes)`,
      `2️⃣ Leak (water leaks / dampness)`,
      `3️⃣ Camera inspection (video)`,
      `4️⃣ Water heater (gas/electric/solar)`,
      `5️⃣ Other plumbing service`,
      `6️⃣ Appointment / schedule a visit`,
      ``,
      `💬 Commands: "start", "menu" or "back"`,
      `🌐 Type "español" to switch`,
      ``,
      `📘 Facebook: ${FB_LINK}`,
      `📞 Phone: ${PHONE}`,
    ].join('\n');
  }

  return [
    `👋 Bienvenido a DestapesPR.`,
    ``,
    `Selecciona un número o escribe lo que necesitas:`,
    ``,
    `1️⃣ Destape (drenajes o tuberías tapadas)`,
    `2️⃣ Fuga de agua (goteos / filtraciones)`,
    `3️⃣ Inspección con cámara (video)`,
    `4️⃣ Calentador (gas/eléctrico/solar)`,
    `5️⃣ Otro servicio de plomería`,
    `6️⃣ Cita / coordinar visita`,
    ``,
    `💬 Comandos: "inicio", "menu" o "volver"`,
    `🌐 Escribe "english" para cambiar`,
    ``,
    `📘 Facebook: ${FB_LINK}`,
    `📞 Tel: ${PHONE}`,
    ``,
    `Ejemplo (1 línea): "Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`,
  ].join('\n');
}

function serviceName(service, lang) {
  const names = {
    destape: { es: 'Destape', en: 'Drain cleaning' },
    fuga: { es: 'Fuga de agua', en: 'Water leak' },
    camara: { es: 'Inspección con cámara', en: 'Camera inspection' },
    calentador: { es: 'Calentador', en: 'Water heater' },
    otro: { es: 'Otro servicio de plomería', en: 'Other plumbing service' },
    cita: { es: 'Cita / coordinar visita', en: 'Appointment' },
  };
  const k = names[service] ? service : 'otro';
  return names[k][lang === 'en' ? 'en' : 'es'];
}

function heaterMenu(lang) {
  if (lang === 'en') {
    return [
      `✅ Service: Water heater`,
      ``,
      `Choose heater type:`,
      `1️⃣ Solar`,
      `2️⃣ Conventional (gas/electric)`,
      ``,
      `Reply with 1 or 2.`,
    ].join('\n');
  }
  return [
    `✅ Servicio: Calentador`,
    ``,
    `Elige tipo:`,
    `1️⃣ Solar`,
    `2️⃣ Convencional (gas/eléctrico)`,
    ``,
    `Responde 1 o 2.`,
  ].join('\n');
}

function leadPrompt(service, lang, heaterType) {
  const title = lang === 'en'
    ? `✅ Service: ${serviceName(service, lang)}`
    : `✅ Servicio: ${serviceName(service, lang)}`;

  const typeLine =
    service === 'calentador' && heaterType
      ? (lang === 'en' ? `✅ Type: ${heaterType}` : `✅ Tipo: ${heaterType}`)
      : null;

  if (lang === 'en') {
    return [
      title,
      typeLine || null,
      ``,
      `Please send EVERYTHING in ONE message:`,
      `• 👨‍🔧 Full name`,
      `• 📞 Contact number`,
      `• 📍 City / area / sector`,
      `• 📝 Short description`,
      ``,
      `Example:`,
      `"My name is John Rivera, 787-555-1234, Caguas, kitchen sink clogged"`,
      ``,
      `If it’s an emergency, type "EMERGENCY".`,
    ].filter(Boolean).join('\n');
  }

  return [
    title,
    typeLine || null,
    ``,
    `Por favor envía TODO en UN solo mensaje:`,
    `• 👨‍🔧 Nombre completo`,
    `• 📞 Número de contacto`,
    `• 📍 Municipio / zona / sector`,
    `• 📝 Descripción breve`,
    ``,
    `Ejemplo:`,
    `"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de cocina tapado"`,
    ``,
    `Si es emergencia, escribe "EMERGENCIA".`,
  ].filter(Boolean).join('\n');
}

function askSchedule(lang) {
  if (lang === 'en') {
    return [
      `📅 Do you want to schedule an appointment now?`,
      ``,
      `Reply:`,
      `✅ YES = show available slots`,
      `❌ NO = finish without booking`,
      ``,
      `If it’s an emergency, type "EMERGENCY".`,
    ].join('\n');
  }
  return [
    `📅 ¿Quieres agendar una cita ahora?`,
    ``,
    `Responde:`,
    `✅ SI = ver horarios disponibles`,
    `❌ NO = finalizar sin cita`,
    ``,
    `Si es emergencia, escribe "EMERGENCIA".`,
  ].join('\n');
}

function parsePhoneLoose(s) {
  const t = String(s || '');
  const m = t.match(/(\+?1)?\s*[\(]?\s*(\d{3})\s*[\)]?\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})/);
  if (!m) return '';
  return `+1${m[2]}${m[3]}${m[4]}`;
}

function parseLeadMessage(text) {
  const raw = String(text || '').trim();
  const out = { name: '', city: '', phone: '', details: '' };

  const lines = raw.split('\n').map((x) => x.trim()).filter(Boolean);

  for (const l of lines) {
    const m1 = l.match(/^(nombre|name)\s*:\s*(.+)$/i);
    if (m1) { out.name = clean(m1[2]); continue; }

    const m2 = l.match(/^(pueblo|municipio|ciudad|city)\s*:\s*(.+)$/i);
    if (m2) { out.city = clean(m2[2]); continue; }

    const m3 = l.match(/^(tel|telefono|phone)\s*:\s*(.+)$/i);
    if (m3) {
      const p = parsePhoneLoose(m3[2]) || clean(m3[2]).replace(/[^\d+]/g, '');
      out.phone = p.startsWith('+') ? p : (p ? `+1${p.replace(/\D/g, '')}` : '');
      continue;
    }

    const m4 = l.match(/^(detalles|details)\s*:\s*(.+)$/i);
    if (m4) { out.details = clean(m4[2]); continue; }
  }

  if (!out.phone) out.phone = parsePhoneLoose(raw);

  if ((!out.name || !out.city || !out.details) && raw.includes(',')) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 4) {
      if (!out.name) out.name = parts[0];
      if (!out.phone) out.phone = parsePhoneLoose(parts[1]) || (parts[1] ? `+1${parts[1].replace(/\D/g, '')}` : '');
      if (!out.city) out.city = parts[2];
      if (!out.details) out.details = parts.slice(3).join(', ');
    }
  }

  if (!out.details) out.details = clean(lines.join(' '));

  if (out.name.length > 100) out.name = out.name.slice(0, 100);
  if (out.city.length > 60) out.city = out.city.slice(0, 60);
  if (out.details.length > 900) out.details = out.details.slice(0, 900);

  return out;
}

function normalizeYesNo(t) {
  const s = norm(t);
  if (['si', 'sí', 's', 'yes', 'y', 'ok', 'dale'].includes(s)) return 'yes';
  if (['no', 'n'].includes(s)) return 'no';
  return '';
}

function isEmergency(text) {
  const s = norm(text);
  if (!s) return false;
  return s.includes("emergenc");
}



function formatSlots(lang, slots) {
  const lines = [];
  lines.push(lang === 'en' ? `✅ Available slots:` : `✅ Horarios disponibles:`);
  lines.push('');
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const label = lang === 'en' ? s.slot_en : s.slot_es;
    lines.push(`${i + 1}️⃣ ${s.ymd} — ${label}`);
  }
  lines.push('');
  lines.push(lang === 'en'
    ? `Reply with the number (1-${slots.length}) or type "menu".`
    : `Responde con el número (1-${slots.length}) o escribe "menu".`);
  return lines.join('\n');
}

async function ensureCase(session) {
  if (!session.case_id) session.case_id = makeCaseId();
  return session.case_id;
}

function hasMinimumLead(session) {
  return !!(clean(session.phone) && clean(session.city));
}

async function pushLeadToScript({ session, from, profileName, statusOverride }) {
  const caseId = await ensureCase(session);

  const payload = {
    case_id: caseId,
    created_at: session.created_at || new Date().toISOString(),
    from_number: from,
    lang: session.lang || 'es',
    service: session.service || '',
    service_label: session.service_label || '',
    heater_type: session.heater_type || 'N/A',
    name: session.name || profileName || '',
    phone: session.phone || '',
    city: session.city || '',
    details: session.details || '',
    status: statusOverride || session.status || 'Nuevo',
    emergency: !!session.emergency,
  };

  const resp = await appsGet('lead', payload);
  if (!resp?.ok) await logError(from, caseId, 'lead', resp?.error || 'unknown', resp);
  return resp;
}

async function listAvailability(session) {
  const resp = await appsGet('availability', {}, { limit: 6, days_ahead: 14, emergency: session.emergency ? '1' : '' });
  if (!resp?.ok || !Array.isArray(resp.slots)) return null;
  session.slots = resp.slots;
  session.slot_offer_at = new Date().toISOString();
  return resp.slots;
}

async function bookSlot({ session, slotIndex, from, profileName }) {
  const slots = Array.isArray(session.slots) ? session.slots : [];
  const s = slots[slotIndex];
  if (!s) return { ok: false, error: 'invalid_slot' };

  const caseId = await ensureCase(session);

  const payload = {
    case_id: caseId,
    name: session.name || profileName || 'Cliente',
    phone: session.phone || '',
    city: session.city || '',
    from_number: from,
    service_label: session.service_label || serviceName(session.service || 'cita', session.lang || 'es'),
    details: session.details || '',
    start_iso: s.start_iso,
    end_iso: s.end_iso,
    emergency: !!session.emergency,
  };

  const resp = await appsGet('book', payload);
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

function mapMenuChoiceToService(choice) {
  if (choice === '1') return 'destape';
  if (choice === '2') return 'fuga';
  if (choice === '3') return 'camara';
  if (choice === '4') return 'calentador';
  if (choice === '5') return 'otro';
  if (choice === '6') return 'cita';
  return '';
}

const handler = async (req, res) => {
  try {
    const { from, body, profileName } = parseInbound(req);
    if (!from) return res.status(200).type('text/xml').send(twiml(''));

    const key = from;
    const session = (await loadSession(key)) || {
      lang: 'es',
      step: 'menu',
      created_at: new Date().toISOString(),
      last_seen: nowMs(),
      service: '',
      service_label: '',
      heater_type: 'N/A',
      case_id: '',
      name: '',
      phone: '',
      city: '',
      details: '',
      emergency: false,
      slots: [],
      appointment_start: '',
      appointment_end: '',
      calendar_event_id: '',
      status: 'Nuevo',
    };

    const idle = nowMs() - (session.last_seen || 0);
    session.last_seen = nowMs();

    const lower = norm(body);

    if (isEmergency(body)) session.emergency = true;

    if (lower === 'english') session.lang = 'en';
    if (lower === 'español' || lower === 'espanol') session.lang = 'es';

    if (idle > WELCOME_AFTER_MS || isHello(body) || lower === 'menu' || lower === 'start' || lower === 'back' || lower === 'inicio' || lower === 'volver') {
      session.step = 'menu';
      session.service = '';
      session.service_label = '';
      session.heater_type = 'N/A';
      session.case_id = '';
      session.name = '';
      session.phone = '';
      session.city = '';
      session.details = '';
      session.emergency = false;
      session.slots = [];
      session.appointment_start = '';
      session.appointment_end = '';
      session.calendar_event_id = '';
      session.status = 'Nuevo';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
    }

    if (session.step === 'menu') {
      const service = mapMenuChoiceToService(lower);
      if (!service) {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
      }

      session.service = service;
      session.service_label = serviceName(service, session.lang);
      session.case_id = makeCaseId();
      session.name = '';
      session.phone = '';
      session.city = '';
      session.details = '';
      session.emergency = false;
      session.slots = [];
      session.appointment_start = '';
      session.appointment_end = '';
      session.calendar_event_id = '';
      session.status = 'Nuevo';

      if (service === 'calentador') {
        session.step = 'heater_type';
        session.heater_type = 'N/A';
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(heaterMenu(session.lang)));
      }

      session.step = 'lead';
      session.heater_type = 'N/A';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(leadPrompt(service, session.lang, null)));
    }

    if (session.step === 'heater_type') {
      if (lower === '1') session.heater_type = 'SOLAR';
      else if (lower === '2') session.heater_type = 'Convencional';
      else {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(heaterMenu(session.lang)));
      }
      session.step = 'lead';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(leadPrompt('calentador', session.lang, session.heater_type)));
    }

    if (session.step === 'lead') {
      session.emergency = isEmergency(body) || session.emergency;

      const parsed = parseLeadMessage(body);
      if (parsed.name) session.name = parsed.name;
      if (parsed.city) session.city = parsed.city;
      if (parsed.phone) session.phone = parsed.phone;
      if (parsed.details) session.details = parsed.details;

      const looksLikeMenuPress = /^[1-6]$/.test(clean(body));
      const looksLikeYesNo = !!normalizeYesNo(body);

      if (!hasMinimumLead(session) || looksLikeMenuPress || looksLikeYesNo) {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null)));
      }

      session.status = 'Nuevo';

      try {
        await pushLeadToScript({ session, from, profileName, statusOverride: 'Nuevo' });
      } catch (e) {
        await logError(from, session.case_id, 'lead_exception', e?.message || String(e), { stack: e?.stack });
      }

      session.step = session.service === 'cita' ? 'pick_slot' : 'ask_schedule';

      if (session.step === 'pick_slot') {
        const slots = await listAvailability(session);
        await saveSession(key, session);

        if (!slots?.length) {
          const msg = session.lang === 'en'
            ? `⚠️ No slots available right now. We'll contact you.\nCase: ${session.case_id}`
            : `⚠️ No hay horarios disponibles. Te contactamos.\nCaso: ${session.case_id}`;
          session.step = 'menu';
          session.slots = [];
          await saveSession(key, session);
          return res.status(200).type('text/xml').send(twiml(msg));
        }

        return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
      }

      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(askSchedule(session.lang)));
    }

    if (session.step === 'ask_schedule') {
      if (!hasMinimumLead(session)) {
        session.step = 'lead';
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null)));
      }

      if (isEmergency(body)) {
        session.emergency = true;
        const slots = await listAvailability(session);
        session.step = 'pick_slot';
        await saveSession(key, session);

        if (!slots?.length) {
          const msg = session.lang === 'en'
            ? `⚠️ No slots available right now. We'll contact you.\nCase: ${session.case_id}`
            : `⚠️ No hay horarios disponibles. Te contactamos.\nCaso: ${session.case_id}`;
          session.step = 'menu';
          session.slots = [];
          await saveSession(key, session);
          return res.status(200).type('text/xml').send(twiml(msg));
        }

        return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
      }

      const yn = normalizeYesNo(body);
      if (!yn) {
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(askSchedule(session.lang)));
      }

      if (yn === 'no') {
        session.step = 'menu';
        await saveSession(key, session);

        const msg = session.lang === 'en'
          ? `✅ Received. We saved your info.\n\nCase ID: ${session.case_id}\nService: ${session.service_label}\nDetails:\n"${session.details}"\n\nType "menu" to return.`
          : `✅ Recibido. Guardamos tu información.\n\nCase ID: ${session.case_id}\nServicio: ${session.service_label}\nDetalles:\n"${session.details}"\n\nEscribe "menu" para regresar.`;
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      const slots = await listAvailability(session);
      session.step = 'pick_slot';
      await saveSession(key, session);

      if (!slots?.length) {
        const msg = session.lang === 'en'
          ? `⚠️ No slots available right now. We'll contact you.\nCase: ${session.case_id}`
          : `⚠️ No hay horarios disponibles. Te contactamos.\nCaso: ${session.case_id}`;
        session.step = 'menu';
        session.slots = [];
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
    }

    if (session.step === 'pick_slot') {
      if (!hasMinimumLead(session)) {
        session.step = 'lead';
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null)));
      }

      const slots = Array.isArray(session.slots) ? session.slots : [];
      const n = Number(String(body || '').trim());
      if (!n || n < 1 || n > slots.length) {
        await saveSession(key, session);
        const msg = session.lang === 'en'
          ? `Reply with a number 1-${slots.length}.`
          : `Responde con un número 1-${slots.length}.`;
        return res.status(200).type('text/xml').send(twiml(msg + '\n\n' + formatSlots(session.lang, slots)));
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
              : `⚠️ Ese espacio ya fue reservado. Escoge otro:\n\n${formatSlots(session.lang, refreshed)}`;
            return res.status(200).type('text/xml').send(twiml(msg));
          }
        }

        if (out?.error === 'missing_required_fields') {
          session.step = 'lead';
          await saveSession(key, session);
          const msg = session.lang === 'en'
            ? `⚠️ I need your phone and city to book.\n\n${leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null)}`
            : `⚠️ Necesito tu Tel y Pueblo para reservar.\n\n${leadPrompt(session.service || 'otro', session.lang, session.heater_type !== 'N/A' ? session.heater_type : null)}`;
          return res.status(200).type('text/xml').send(twiml(msg));
        }

        const errorMsg = session.lang === 'en'
          ? `❌ I couldn't book that slot. Try again or call ${PHONE}.\nCase: ${session.case_id}`
          : `❌ No pude reservar ese horario.\nIntenta otra vez o llámanos al ${PHONE}.\nCaso: ${session.case_id}`;
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(errorMsg));
      }

      try {
        await pushLeadToScript({ session, from, profileName, statusOverride: 'Programado' });
      } catch (e) {
        await logError(from, session.case_id, 'lead_after_book_exception', e?.message || String(e), { stack: e?.stack });
      }

      const chosen = slots[n - 1];
      const slotLabel = session.lang === 'en' ? chosen.slot_en : chosen.slot_es;

      const msg = session.lang === 'en'
        ? `✅ Appointment booked\n\nCase ID: ${session.case_id}\nService: ${session.service_label}\nWhen: ${chosen.ymd} — ${slotLabel}\n\nWe will contact you shortly.\nType "menu" to return.`
        : `✅ Cita agendada\n\nCase ID: ${session.case_id}\nServicio: ${session.service_label}\nCuándo: ${chosen.ymd} — ${slotLabel}\n\nTe estaremos contactando.\nEscribe "menu" para regresar.`;

      session.step = 'menu';
      session.slots = [];
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(msg));
    }

    session.step = 'menu';
    await saveSession(key, session);
    return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
  } catch (e) {
    try {
      await logError(req.body?.From, null, 'handler_exception', e?.message || String(e), { stack: e?.stack });
    } catch {}
    return res.status(200).type('text/xml').send(twiml(''));
  }
};

app.post('/twilio', handler);
app.post('/webhook/whatsapp', handler);

app.get('/', (req, res) => res.send('DestapesPR Bot activo ✅'));

app.get('/__version', (req, res) => {
  res.json({
    ok: true,
    tag: TAG,
    commit: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || process.env.GIT_COMMIT || null,
    service: process.env.RENDER_SERVICE_NAME || process.env.SERVICE_NAME || null,
    node: process.version,
  });
});

app.get('/health', async (req, res) => {
  try {
    const out = await appsGet('ready');
    res.json({
      ok: true,
      tag: TAG,
      apps_script: out?.ok ? 'connected' : 'error',
      apps_script_version: out?.version || null,
      apps_script_url: APPS_SCRIPT_URL ? 'configured' : 'missing',
      apps_script_token: APPS_SCRIPT_TOKEN ? 'configured' : 'missing',
      apps_script_error: out?.ok ? null : (out?.error || 'unknown'),
      calendar_id: out?.calendar_id || null,
      tz: out?.tz || null,
    });
  } catch (err) {
    res.json({
      ok: true,
      tag: TAG,
      apps_script: 'error',
      apps_script_version: null,
      apps_script_url: APPS_SCRIPT_URL ? 'configured' : 'missing',
      apps_script_token: APPS_SCRIPT_TOKEN ? 'configured' : 'missing',
      apps_script_error: err?.message || String(err),
    });
  }
});

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ ${TAG} listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
