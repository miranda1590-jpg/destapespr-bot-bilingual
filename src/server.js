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
const RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;

let db;

async function initDB() {
  db = await open({ filename: './data.sqlite', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS sessions ( k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL );`);
  await db.exec(`CREATE TABLE IF NOT EXISTS error_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, from_number TEXT, case_id TEXT, action TEXT, error TEXT, details TEXT );`);
  console.log('✅ Database initialized');
}

function nowMs(){ return Date.now(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function b64url(obj){
  const s = JSON.stringify(obj);
  return Buffer.from(s,'utf8').toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}

async function fetchTextWithTimeout(url){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), FETCH_TIMEOUT_MS);
  try{
    const res = await fetch(url,{ method:'GET', redirect:'follow', signal:ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally { clearTimeout(t); }
}

async function appsGet(action, payload = {}, extraQuery = {}){
  if(!APPS_SCRIPT_URL) throw new Error('missing APPS_SCRIPT_URL');

  const qs = new URLSearchParams();
  qs.set('action', String(action||'').trim());

  if(action !== 'ready'){
    if(!APPS_SCRIPT_TOKEN) throw new Error('missing APPS_SCRIPT_TOKEN');
    qs.set('token', APPS_SCRIPT_TOKEN);
  }

  if(payload && Object.keys(payload).length) qs.set('p', b64url(payload));

  for(const [k,v] of Object.entries(extraQuery||{})){
    if(v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
  }

  const url = `${APPS_SCRIPT_URL}?${qs.toString()}`;

  for(let attempt=1; attempt<=MAX_RETRIES; attempt++){
    try{
      const { status, text } = await fetchTextWithTimeout(url);

      let json;
      try{ json = JSON.parse(text); }
      catch{
        console.error('❌ Apps non-json:', text.slice(0,200));
        if(attempt < MAX_RETRIES){ await sleep(RETRY_DELAY_MS*attempt); continue; }
        return { ok:false, error:'non_json_response', status, raw:text.slice(0,500) };
      }

      if(json?.ok === true) return json;
      if(json?.error === 'unauthorized') return json;

      console.warn('⚠️ Apps error:', json?.error || 'unknown');
      if(attempt < MAX_RETRIES){ await sleep(RETRY_DELAY_MS*attempt); continue; }
      return json || { ok:false, error:'unknown' };
    } catch(err){
      const msg = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
      console.error('❌ Apps fetch error:', msg);
      if(attempt < MAX_RETRIES){ await sleep(RETRY_DELAY_MS*attempt); continue; }
      return { ok:false, error:'fetch_failed', details: msg };
    }
  }
  return { ok:false, error:'max_retries_exceeded' };
}

async function logError(from, caseId, action, error, details){
  try{
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

function normalizeFrom(from){
  const s = String(from||'').trim();
  if(!s) return '';
  if(/^whatsapp:/i.test(s)) return s;
  if(/^\+?\d+$/.test(s)) return `whatsapp:${s.startsWith('+') ? s : `+${s}`}`;
  return s;
}

function makeCaseId(){
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  const rnd = String(Math.floor(1000 + Math.random()*9000));
  return `DP-${y}${m}${day}-${rnd}`;
}

async function loadSession(key){
  const row = await db.get('SELECT v, updated_at FROM sessions WHERE k=?', key);
  if(!row) return null;
  if(nowMs() - row.updated_at > SESSION_TTL_MS){
    await db.run('DELETE FROM sessions WHERE k=?', key);
    return null;
  }
  try{ return JSON.parse(row.v); } catch { return null; }
}

async function saveSession(key, obj){
  const v = JSON.stringify(obj||{});
  const t = nowMs();
  await db.run(
    'INSERT INTO sessions(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at',
    key, v, t
  );
}

function clean(s){ return String(s||'').trim(); }
function norm(s){
  return String(s||'').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
}

function parseInbound(req){
  const from = normalizeFrom(req.body.From || req.body.from);
  const body = clean(req.body.Body || req.body.body);
  const profileName = clean(req.body.ProfileName || req.body.profileName);
  return { from, body, profileName };
}

function escapeXml(s){
  return String(s||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&apos;');
}

function twiml(msg){
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(msg)}</Message></Response>`;
}

function isHello(text){
  const t = norm(text);
  return ['hola','hello','hi','hey','buenas','saludos','menu','start','inicio','back','volver'].includes(t);
}

function mainMenuPretty(lang){
  if(lang === 'en'){
    return [
      `👋 Welcome to DestapesPR.`,
      ``,
      `Choose a number:`,
      `1️⃣ Drain cleaning (clogged drains/pipes)`,
      `2️⃣ Leak (water leaks / dampness)`,
      `3️⃣ Camera inspection (video)`,
      `4️⃣ Water heater (gas/electric/solar)`,
      `5️⃣ Other plumbing service`,
      `6️⃣ Appointment / schedule a visit`,
      ``,
      `💬 Commands: "start", "menu" or "back".`,
      `🌐 Type "español" to switch.`,
      ``,
      `📘 Facebook: ${FB_LINK}`,
      `📞 Phone: ${PHONE}`
    ].join('\n');
  }
  return [
    `👋 Bienvenido a DestapesPR.`,
    ``,
    `Selecciona un número:`,
    `1️⃣ Destape (drenajes o tuberías tapadas)`,
    `2️⃣ Fuga de agua (goteos / filtraciones)`,
    `3️⃣ Inspección con cámara (video)`,
    `4️⃣ Calentador (gas/eléctrico/solar)`,
    `5️⃣ Otro servicio de plomería`,
    `6️⃣ Cita / coordinar visita`,
    ``,
    `💬 Comandos: "inicio", "menu" o "volver".`,
    `🌐 Escribe "english" para cambiar.`,
    ``,
    `📘 Facebook: ${FB_LINK}`,
    `📞 Tel: ${PHONE}`
  ].join('\n');
}

function heaterTypeMenu(lang){
  if(lang === 'en'){
    return `✅ Water heater selected.\nChoose type:\n1️⃣ Solar\n2️⃣ Conventional (gas/electric)\n\nReply 1 or 2.`;
  }
  return `✅ Servicio: Calentador.\nElige tipo:\n1️⃣ Solar\n2️⃣ Convencional (gas/eléctrico)\n\nResponde 1 o 2.`;
}

function serviceLabel(service, lang){
  const map = {
    destape: { es:'Destape', en:'Drain cleaning' },
    fuga: { es:'Fuga de agua', en:'Water leak' },
    camara: { es:'Inspección con cámara', en:'Camera inspection' },
    calentador: { es:'Calentador', en:'Water heater' },
    otro: { es:'Otro servicio', en:'Other service' },
    cita: { es:'Cita / coordinar visita', en:'Appointment' },
  };
  return (map[service] || map.otro)[lang === 'en' ? 'en' : 'es'];
}

function askLeadDataPretty(lang, service, heaterType){
  const svc = serviceLabel(service, lang);
  const ht = heaterType && heaterType !== 'N/A'
    ? (lang === 'en' ? `Heater type: ${heaterType}\n` : `Tipo: ${heaterType}\n`)
    : '';
  if(lang === 'en'){
    return [
      `✅ Selected: ${svc}`,
      ht ? `✅ ${ht.trim()}` : null,
      ``,
      `Send ONE message like:`,
      `Name: John`,
      `City: Caguas`,
      `Phone: 7875551234`,
      `Details: ...`,
    ].filter(Boolean).join('\n');
  }
  return [
    `✅ Servicio: ${svc}`,
    ht ? `✅ ${ht.trim()}` : null,
    ``,
    `Envía UN mensaje así:`,
    `Nombre: Juan`,
    `Pueblo: Caguas`,
    `Tel: 7875551234`,
    `Detalles: ...`,
  ].filter(Boolean).join('\n');
}

function parseLeadMessage(text){
  const t = String(text||'');
  const lines = t.split('\n').map(x=>x.trim()).filter(Boolean);
  const out = { name:'', city:'', phone:'', details:'' };

  for(const l of lines){
    const m1 = l.match(/^(nombre|name)\s*:\s*(.+)$/i);
    if(m1){ out.name = clean(m1[2]); continue; }

    const m2 = l.match(/^(pueblo|ciudad|city)\s*:\s*(.+)$/i);
    if(m2){ out.city = clean(m2[2]); continue; }

    const m3 = l.match(/^(tel|telefono|phone)\s*:\s*(.+)$/i);
    if(m3){
      let phone = clean(m3[2]).replace(/[^\d+]/g,'');
      if(phone && !phone.startsWith('+')) phone = '+1' + phone;
      out.phone = phone;
      continue;
    }

    const m4 = l.match(/^(detalles|details)\s*:\s*(.+)$/i);
    if(m4){ out.details = clean(m4[2]); continue; }
  }

  if(!out.details) out.details = clean(lines.join(' '));
  if(out.name.length > 100) out.name = out.name.slice(0,100);
  if(out.city.length > 50) out.city = out.city.slice(0,50);
  if(out.details.length > 500) out.details = out.details.slice(0,500);
  return out;
}

async function ensureCase(session){
  if(!session.case_id) session.case_id = makeCaseId();
  return session.case_id;
}

async function pushLeadToScript({ session, from, profileName }){
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
    calendar_event_id: session.calendar_event_id || '',
  };

  try{
    const resp = await appsGet('lead', payload);
    if(!resp?.ok) await logError(from, caseId, 'lead', resp?.error || 'unknown', resp);
    return resp;
  } catch(err){
    await logError(from, caseId, 'lead', err?.message || String(err), { stack: err?.stack });
    return { ok:false, error:'exception', details: err?.message || String(err) };
  }
}

async function listAvailability(session){
  const limit = 6;
  const daysAhead = 14;
  try{
    const resp = await appsGet('availability', {}, { limit, days_ahead: daysAhead });
    if(!resp?.ok || !Array.isArray(resp.slots)) return null;
    session.slots = resp.slots;
    return resp.slots;
  } catch {
    return null;
  }
}

function formatSlots(lang, slots){
  const lines = [];
  lines.push(lang === 'en' ? `✅ Available slots:` : `✅ Horarios disponibles:`);
  for(let i=0;i<slots.length;i++){
    const s = slots[i];
    const label = lang === 'en' ? s.slot_en : s.slot_es;
    lines.push(`${i+1}️⃣ ${s.ymd} — ${label}`);
  }
  lines.push('');
  lines.push(lang === 'en'
    ? `Reply with the number (1-${slots.length}) to book.`
    : `Responde con el número (1-${slots.length}) para reservar.`);
  return lines.join('\n');
}

async function bookSlot({ session, slotIndex, from, profileName }){
  const slots = Array.isArray(session.slots) ? session.slots : [];
  const s = slots[slotIndex];
  if(!s) return { ok:false, error:'invalid_slot' };

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
    end_iso: s.end_iso,
  };

  const resp = await appsGet('book', payload);
  if(!resp?.ok){
    await logError(from, caseId, 'book', resp?.error || 'unknown', { resp, payload });
    return resp || { ok:false, error:'book_failed' };
  }

  session.appointment_start = resp.start_iso || s.start_iso || '';
  session.appointment_end = resp.end_iso || s.end_iso || '';
  session.calendar_event_id = resp.event_id || '';
  session.status = 'Programado';
  return { ok:true, book: resp };
}

function mapChoiceToService(choice){
  const t = norm(choice);
  if(t === '1') return 'destape';
  if(t === '2') return 'fuga';
  if(t === '3') return 'camara';
  if(t === '4') return 'calentador';
  if(t === '5') return 'otro';
  if(t === '6') return 'cita';
  return null;
}

const twilioHandler = async (req, res) => {
  try{
    const { from, body, profileName } = parseInbound(req);
    if(!from) return res.status(200).type('text/xml').send(twiml(''));

    const key = from;
    const session = (await loadSession(key)) || {
      lang: 'es',
      step: 'menu',
      created_at: new Date().toISOString(),
      last_seen: nowMs(),
      service: '',
      service_label: '',
      heater_type: 'N/A',
      slots: []
    };

    const idle = nowMs() - (session.last_seen || 0);
    session.last_seen = nowMs();

    const lower = norm(body);

    if(lower === 'english') session.lang = 'en';
    if(lower === 'español' || lower === 'espanol') session.lang = 'es';

    if(idle > WELCOME_AFTER_MS || isHello(body)){
      session.step = 'menu';
      session.service = '';
      session.service_label = '';
      session.heater_type = 'N/A';
      session.slots = [];
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(mainMenuPretty(session.lang)));
    }

    if(lower === 'menu' || lower === 'start' || lower === 'inicio' || lower === 'back' || lower === 'volver'){
      session.step = 'menu';
      session.service = '';
      session.service_label = '';
      session.heater_type = 'N/A';
      session.slots = [];
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(mainMenuPretty(session.lang)));
    }

    if(session.step === 'menu'){
      const svc = mapChoiceToService(body);
      if(!svc){
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(mainMenuPretty(session.lang)));
      }

      session.service = svc;
      session.service_label = serviceLabel(svc, session.lang);
      await ensureCase(session);

      if(svc === 'calentador'){
        session.step = 'heater_type';
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(heaterTypeMenu(session.lang)));
      }

      if(svc === 'cita'){
        session.step = 'lead_then_slots';
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(askLeadDataPretty(session.lang, svc, 'N/A')));
      }

      session.step = 'lead';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(askLeadDataPretty(session.lang, svc, 'N/A')));
    }

    if(session.step === 'heater_type'){
      if(lower === '1') session.heater_type = 'SOLAR';
      else if(lower === '2') session.heater_type = 'Convencional';
      else{
        await saveSession(key, session);
        return res.status(200).type('text/xml').send(twiml(heaterTypeMenu(session.lang)));
      }
      session.step = 'lead';
      await saveSession(key, session);
      return res.status(200).type('text/xml').send(twiml(askLeadDataPretty(session.lang, 'calentador', session.heater_type)));
    }

    if(session.step === 'lead' || session.step === 'lead_then_slots'){
      const parsed = parseLeadMessage(body);

      session.name = parsed.name || session.name || profileName || '';
      session.city = parsed.city || session.city || '';
      session.phone = parsed.phone || session.phone || '';
      session.details = parsed.details || session.details || '';
      session.status = session.status || 'En proceso';

      const leadResp = await pushLeadToScript({ session, from, profileName });
      console.log('📌 lead:', session.case_id, leadResp?.ok ? 'OK' : `FAIL:${leadResp?.error || 'unknown'}`);

      if(session.step === 'lead_then_slots'){
        const slots = await listAvailability(session);
        console.log('📌 availability:', session.case_id, slots?.length ? `OK:${slots.length}` : 'FAIL');
        session.step = 'pick_slot';
        await saveSession(key, session);

        if(!slots?.length){
          const msg = session.lang === 'en'
            ? `⚠️ No slots available. We'll contact you.\nCase: ${session.case_id}`
            : `⚠️ No hay horarios disponibles. Te contactamos.\nCaso: ${session.case_id}`;
          return res.status(200).type('text/xml').send(twiml(msg));
        }

        return res.status(200).type('text/xml').send(twiml(formatSlots(session.lang, slots)));
      }

      session.step = 'menu';
      await saveSession(key, session);

      const msg = session.lang === 'en'
        ? `✅ Done. Case: ${session.case_id}\nWe will contact you shortly.`
        : `✅ Listo. Caso: ${session.case_id}\nTe estaremos contactando pronto.`;

      return res.status(200).type('text/xml').send(twiml(msg));
    }

    if(session.step === 'pick_slot'){
      const slots = Array.isArray(session.slots) ? session.slots : [];
      const n = Number(lower);

      if(!n || n < 1 || n > slots.length){
        await saveSession(key, session);
        const msg = session.lang === 'en'
          ? `Reply with a number 1-${slots.length}.`
          : `Responde con un número 1-${slots.length}.`;
        return res.status(200).type('text/xml').send(twiml(msg));
      }

      const out = await bookSlot({ session, slotIndex: n - 1, from, profileName });
      console.log('📌 book:', session.case_id, out?.ok ? 'OK' : `FAIL:${out?.error || 'unknown'}`);

      session.step = 'menu';
      session.slots = [];
      await saveSession(key, session);

      if(!out?.ok){
        const errorMsg = session.lang === 'en'
          ? `I couldn't book that slot. Try again or call ${PHONE}.\nCase: ${session.case_id}`
          : `No pude reservar ese horario. Intenta de nuevo o llama al ${PHONE}.\nCaso: ${session.case_id}`;
        return res.status(200).type('text/xml').send(twiml(errorMsg));
      }

      const msg = session.lang === 'en'
        ? `✅ Appointment booked.\nCase: ${session.case_id}\nStart: ${session.appointment_start}\nEnd: ${session.appointment_end}`
        : `✅ Cita agendada.\nCaso: ${session.case_id}\nInicio: ${session.appointment_start}\nFin: ${session.appointment_end}`;

      return res.status(200).type('text/xml').send(twiml(msg));
    }

    session.step = 'menu';
    await saveSession(key, session);
    return res.status(200).type('text/xml').send(twiml(mainMenuPretty(session.lang)));
  } catch(e){
    return res.status(200).type('text/xml').send(twiml(''));
  }
};

app.post('/twilio', twilioHandler);
app.post('/webhook/whatsapp', twilioHandler);

app.get('/', (req,res) => res.send('DestapesPR Bot activo ✅'));

app.get('/health', async (req,res) => {
  try{
    let scriptCheck = null;
    let scriptErr = null;
    try{ scriptCheck = await appsGet('ready'); } catch(err){ scriptErr = err?.message || String(err); }
    res.json({
      ok:true,
      tag: TAG,
      apps_script: scriptCheck?.ok ? 'connected' : 'error',
      apps_script_version: scriptCheck?.version || null,
      apps_script_url: APPS_SCRIPT_URL ? 'configured' : 'missing',
      apps_script_token: APPS_SCRIPT_TOKEN ? 'configured' : 'missing',
      apps_script_error: scriptErr
    });
  } catch(err){
    res.status(500).json({ ok:false, error: err?.message || String(err), tag: TAG });
  }
});

initDB().then(()=>{
  app.listen(PORT, ()=>console.log(`✅ ${TAG} listening on ${PORT}`));
}).catch(()=>process.exit(1));
