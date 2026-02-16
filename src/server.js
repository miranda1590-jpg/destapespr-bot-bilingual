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

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzu19t44BDuwNkq8AG39zKhdZFOwJk3o1e1HW2-KlzbAxB2_DB36UQPp3uKUjxKCyQ/exec';
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || process.env.DESTAPESPR_TOKEN || '';

const SESSION_TTL_MS = 48 * 60 * 60 * 1000;
const WELCOME_AFTER_MS = 12 * 60 * 60 * 1000;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

let db;

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec('CREATE TABLE IF NOT EXISTS sessions ( k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL );');
  await db.exec('CREATE TABLE IF NOT EXISTS error_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, from_number TEXT, case_id TEXT, action TEXT, error TEXT, details TEXT );');
  console.log('✅ Database initialized');
}

function nowMs() { return Date.now(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function b64url(obj) {
  const s = JSON.stringify(obj);
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
        return { ok: false, error: 'non_json_response', status, raw: text.slice(0, 500) };
      }

      if (json?.ok === true) return json;
      if (json?.error === 'unauthorized') return json;

      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
      return json || { ok: false, error: 'unknown' };
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY_MS * attempt); continue; }
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

function normalizeFrom(from) {
  const s = String(from || '').trim();
  if (!s) return '';
  if (/^whatsapp:/i.test(s)) return s;
  if (/^\+?\d+$/.test(s)) return `whatsapp:${s.startsWith('+') ? s : `+${s}`}`;
  return s;
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
  try { return JSON.parse(row.v); } catch { return null; }
}

async function saveSession(key, obj) {
  const v = JSON.stringify(obj || {});
  const t = nowMs();
  await db.run(
    'INSERT INTO sessions(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at',
    key, v, t
  );
}

function clean(s) { return String(s || '').trim(); }

function parseInbound(req) {
  const from = normalizeFrom(req.body.From);
  const body = clean(req.body.Body);
  const profileName = clean(req.body.ProfileName);
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

function isHello(text) {
  const t = clean(text).toLowerCase();
  return ['hola','hello','hi','buenas','saludos','menu','start','inicio','back'].includes(t);
}

function menuText(lang) {
  if (lang === 'en') {
    return [
      `${TAG}`,
      `Choose an option:`,
      `1) Clog / Drain (Destape)`,
      `2) Leak / Plumbing repair`,
      `3) Water heater (Calentador)`,
      `4) Schedule an appointment`,
      ``,
      `Type: 1,2,3,4  |  Type "español" to switch`,
      `Facebook: ${FB_LINK}`,
      `Phone: ${PHONE}`
    ].join('\n');
  }
  return [
    `${TAG}`,
    `Elige una opción:`,
    `1) Destape / Drenaje`,
    `2) Fuga / Reparación`,
    `3) Calentador`,
    `4) Agendar cita`,
    ``,
    `Escribe: 1,2,3,4  |  Escribe "english" para cambiar`,
    `Facebook: ${FB_LINK}`,
    `Tel: ${PHONE}`
  ].join('\n');
}

function askLeadData(lang, serviceLabel) {
  if (lang === 'en') {
    return [
      `Got it ✅ (${serviceLabel})`,
      `Reply with ONE message like this:`,
      `Name: John`,
      `City: Caguas`,
      `Phone: 7875551234`,
      `Details: ...`
    ].join('\n');
  }
  return [
    `Perfecto ✅ (${serviceLabel})`,
    `Contesta con UN solo mensaje así:`,
    `Nombre: Juan`,
    `Pueblo: Caguas`,
    `Tel: 7875551234`,
    `Detalles: ...`
  ].join('\n');
}

function parseLeadMessage(text) {
  const t = String(text || '');
  const lines = t.split('\n').map((x) => x.trim()).filter(Boolean);
  const out = { name: '', city: '', phone: '', details: '' };

  for (const l of lines) {
    const m1 = l.match(/^(nombre|name)\s*:\s*(.+)$/i);
    if (m1) { out.name = clean(m1[2]); continue; }

    const m2 = l.match(/^(pueblo|ciudad|city)\s*:\s*(.+)$/i);
    if (m2) { out.city = clean(m2[2]); continue; }

    const m3 = l.match(/^(tel|telefono|phone)\s*:\s*(.+)$/i);
    if (m3) {
      let phone = clean(m3[2]).replace(/[^\d+]/g, '');
      if (phone && !phone.startsWith('+')) phone = '+1' + phone;
      out.phone = phone;
      continue;
    }

    const m4 = l.match(/^(detalles|details)\s*:\s*(.+)$/i);
    if (m4) { out.details = clean(m4[2]); continue; }
  }

  if (!out.details) out.details = clean(lines.join(' '));

  if (out.name.length > 100) out.name = out.name.slice(0, 100);
  if (out.city.length > 50) out.city = out.city.slice(0, 50);
  if (out.details.length > 500) out.details = out.details.slice(0, 500);

  return out;
}

async function ensureCase(session) {
  if (!session.case_id) session.case_id = makeCaseId();
  return session.case_id;
}

async function pushLeadToScript({ session, from, profileName }) {
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
    status: session.status || 'En proceso',
    priority: session.priority || 'Normal',
    membership: session.membership || 'NO',
    tech_name: session.tech_name || '',
    tech_whatsapp: session.tech_whatsapp || '',
    appointment_start: session.appointment_start || '',
    appointment_end: session.appointment_end || '',
    calendar_event_id: session.calendar_event_id || ''
  };

  try {
    const resp = await appsGet('lead', payload);
    if (!resp?.ok) await logError(from, caseId, 'push_lead', resp?.error || 'unknown', resp);
    return resp;
  } catch (err) {
    await logError(from, caseId, 'push_lead', err?.message || String(err), { stack: err?.stack });
    return { ok: false, error: 'exception', details: err?.message || String(err) };
  }
}

async function listAvailability(session) {
  const resp = await appsGet('availability', {}, { limit: 6, days_ahead: 14 });
  if (!resp?.ok || !Array.isArray(resp.slots)) return null;
  session.slots = resp.slots;
  session.slot_offer_at = new Date().toISOString();
  return resp.slots;
}

function formatSlots(lang, slots) {
  const lines = [];
  lines.push(lang === 'en' ? 'Available slots:' : 'Horarios disponibles:');
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const label = lang === 'en' ? s.slot_en : s.slot_es;
    lines.push(`${i + 1}) ${s.ymd} — ${label}`);
  }
  lines.push('');
  lines.push(lang === 'en' ? `Reply with the number (1-${slots.length}) to book.` : `Contesta con el número (1-${slots.length}) para reservar.`);
  return lines.join('\n');
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
    service_label: session.service_label || session.service || 'Cita',
    details: session.details || '',
    start_iso: s.start_iso,
    end_iso: s.end_iso
  };

  const resp = await appsGet('book', payload);
  if (!resp?.ok) {
    await logError(from, caseId, 'book_slot', resp?.error || 'unknown', { resp, payload });
    return resp || { ok: false, error: 'book_failed' };
  }

  session.appointment_start = resp.start_iso || s.start_iso || '';
  session.appointment_end = resp.end_iso || s.end_iso || '';
  session.calendar_event_id = resp.event_id || '';
  session.status = 'Programado';

  return { ok: true, book: resp };
}

app.get('/', (req, res) => res.status(200).send('DestapesPR Bot activo ✅'));

app.get('/health', async (req, res) => {
  try {
    const scriptCheck = await appsGet('ready');
    res.json({
      ok: true,
      tag: TAG,
      apps_script: scriptCheck?.ok ? 'connected' : 'error',
      apps_script_version: scriptCheck?.version || 'unknown'
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post(["/twilio","/webhook/whatsapp"], async (req, res) => {
  try {
    const { from, body, profileName } = parseInbound(req);
    if (!from) return res.status(200).type('text/xml').send(twiml(''));

    const key = from;
    const session = (await loadSession(key)) || {
      lang: 'es',
      step: 'menu',
      created_at: new Date().toISOString(),
      last_seen: nowMs()
    };

    const idle = nowMs() - (session.last_seen || 0);
    session.last_seen = nowMs();

    const lower = clean(body).toLowerCase();

    if (lower === 'english') session.lang = 'en';
    if (lower === 'español' || lower === 'espanol') session.lang = 'es';

    if (idle > WELCOME_AFTER_MS || isHello(body) || lower === 'menu' || lower === 'start' || lower === 'back') {
      session.step = 'menu';
      session.service = '';
      session.service_label = '';
      session.heater_type = 'N/A';
      session.slots = [];
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
    }

    if (session.step === 'menu') {
      if (['1','2','3','4'].includes(lower)) {
        if (lower === '1') { session.service = 'destape'; session.service_label = session.lang === 'en' ? 'Clog / Drain' : 'Destape / Drenaje'; session.step = 'lead'; }
        if (lower === '2') { session.service = 'reparacion'; session.service_label = session.lang === 'en' ? 'Leak / Repair' : 'Fuga / Reparación'; session.step = 'lead'; }
        if (lower === '3') { session.service = 'calentador'; session.service_label = 'Calentador'; session.step = 'heater_type'; }
        if (lower === '4') { session.service = 'cita'; session.service_label = session.lang === 'en' ? 'Appointment' : 'Cita'; session.step = 'lead_then_slots'; }

        await ensureCase(session);
        await saveSession(key, session);

        if (session.step === 'heater_type') {
          const msg = session.lang === 'en'
            ? 'Water heater type?\n1) Solar\n2) Conventional\n\nReply 1 or 2'
            : '¿Tipo de calentador?\n1) Solar\n2) Convencional\n\nContesta 1 o 2';
          return res.status(200).type('text/xml').send(twiml(msg));
        }

        return res.status(200).type('text/xml').send(twiml(askLeadData(session.lang, session.service_label)));
      }

      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
    }

    if (session.step === 'heater_type') {
      if (lower === '1') session.heater_type = 'SOLAR';
      else if (lower === '2') session.heater_type = 'Convencional';
      else {
        await saveSession(key, session);
        const msg = session.lang === 'en' ? 'Reply 1 (Solar) or 2 (Conventional)' : 'Contesta 1 (Solar) o 2 (Convencional)';
        return res.status(200).type('text/xml').send(twiml(msg));
      }
      session.step = 'lead';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(askLeadData(session.lang, session.service_label)));
    }

    if (session.step === 'lead' || session.step === 'lead_then_slots') {
      const parsed = parseLeadMessage(body);
      session.name = parsed.name || session.name || profileName || '';
      session.city = parsed.city || session.city || '';
      session.phone = parsed.phone || session.phone || '';
      session.details = parsed.details || session.details || '';
      session.status = session.status || 'En proceso';

      const leadResp = await pushLeadToScript({ session, from, profileName });
      if (!leadResp?.ok) {}

      if (session.step === 'lead_then_slots') {
        const slots = await listAvailability(session);
        session.step = 'pick_slot';
        await saveSession(key, session);

        if (!slots?.length) {
          const msg = session.lang === 'en'
            ? `I couldn't find available slots right now. We'll contact you shortly.\nCase: ${session.case_id}`
            : `No pude encontrar horarios disponibles ahora mismo. Te contactamos pronto.\nCaso: ${session.case_id}`;
          return res.status(200).type('text/xml').send(twiml(msg));
        }

        return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
      }

      session.step = 'menu';
      await saveSession(key, session);

      const msg = session.lang === 'en'
        ? `Done ✅ Case: ${session.case_id}\nWe will contact you shortly.`
        : `Listo ✅ Caso: ${session.case_id}\nTe estaremos contactando ahora.`;

      return res.status(200).type('text/xml').send(twiml(msg));
    }

    if (session.step === 'pick_slot') {
      const n = Number(lower);
      const slots = Array.isArray(session.slots) ? session.slots : [];
      if (!n || n < 1 || n > slots.length) {
        await saveSession(key, session);
        const msg = session.lang === 'en' ? `Reply with a number 1-${slots.length}.` : `Contesta con un número 1-${slots.length}.`;
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      const out = await bookSlot({ session, slotIndex: n - 1, from, profileName });
      session.step = 'menu';
      session.slots = [];
      await saveSession(key, session);

      if (!out?.ok) {
        const errorMsg = session.lang === 'en'
          ? `I couldn't book that slot. Please try again from the menu or call us at ${PHONE}.\nCase: ${session.case_id}`
          : `No pude reservar ese horario. Intenta nuevamente desde el menú o llámanos al ${PHONE}.\nCaso: ${session.case_id}`;
        await logError(from, session.case_id, 'book_slot_ui', out?.error || 'unknown', out);
        return res.status(200).type('text/xml').send(twiml(errorMsg));
      }

      const msg = session.lang === 'en'
        ? `Booked ✅\nCase: ${session.case_id}\nStart: ${session.appointment_start}\nEnd: ${session.appointment_end}`
        : `Cita agendada ✅\nCaso: ${session.case_id}\nInicio: ${session.appointment_start}\nFin: ${session.appointment_end}`;

      return res.status(200).type('text/xml').send(twiml(msg));
    }

    session.step = 'menu';
    await saveSession(key, session);
    return res.status(200).type('text/xml').send(twiml(menuText(session.lang)));
  } catch (e) {
    try { await logError(req.body?.From, null, 'twilio_handler', e?.message || String(e), { stack: e?.stack }); } catch {}
    return res.status(200).type('text/xml').send(twiml(''));
  }
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
    console.log(`✅ TAG: ${TAG}`);
    console.log(`✅ APPS_SCRIPT_URL: ${APPS_SCRIPT_URL ? 'configured' : '❌ MISSING'}`);
    console.log(`✅ APPS_SCRIPT_TOKEN: ${APPS_SCRIPT_TOKEN ? 'configured' : '❌ MISSING'}`);
  });
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
  process.exit(1);
});


app.get("/webhook/whatsapp", (req,res)=>res.status(200).send("OK"));
app.get("/twilio", (req,res)=>res.status(200).send("OK"));
