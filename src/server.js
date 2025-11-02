// server.js — DestapesPR Bilingual Bot V5.1 🇵🇷
// Requisitos: express, sqlite3, sqlite (npm i express sqlite sqlite3)

import express from "express";
import morgan from "morgan";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("tiny"));

const TAG = "Bilingual Bot V5.1 🇵🇷";
const PORT = process.env.PORT || 10000;
const LINK_CITA = "https://wa.me/17879220068?text=Quiero%20agendar%20una%20cita";
const PHONE_PRETTY = "+1 (787) 922-0068";
const FB_URL = "https://www.facebook.com/destapesPR/";

// =======================
// 🗄️  SQLite (migraciones)
// =======================
let db;
async function initDB() {
  if (db) return db;
  db = await open({ filename: "./sessions.db", driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      lang TEXT DEFAULT 'es',
      last_active INTEGER
    );
  `);

  const pragma = await db.all(`PRAGMA table_info(sessions)`);
  const cols = new Set(pragma.map(c => c.name));
  const addCol = async (name, type, def = null) => {
    if (!cols.has(name)) {
      await db.exec(
        `ALTER TABLE sessions ADD COLUMN ${name} ${type}` + (def ? ` DEFAULT ${def}` : "")
      );
    }
  };
  await addCol("last_choice", "TEXT");
  await addCol("awaiting_details", "INTEGER", 0);
  await addCol("details", "TEXT");
  await addCol("lang", "TEXT", "'es'");
  await addCol("last_active", "INTEGER");

  return db;
}

async function getSession(from) {
  return db.get(`SELECT * FROM sessions WHERE from_number = ?`, from);
}
async function upsertSession(from, patch = {}) {
  const now = Date.now();
  const prev = (await getSession(from)) || {};
  const next = {
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    lang: patch.lang ?? prev.lang ?? "es",
    last_active: now
  };
  await db.run(
    `
    INSERT INTO sessions (from_number, last_choice, awaiting_details, details, lang, last_active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      last_choice = excluded.last_choice,
      awaiting_details = excluded.awaiting_details,
      details = excluded.details,
      lang = excluded.lang,
      last_active = excluded.last_active
  `,
    [from, next.last_choice, next.awaiting_details, next.details, next.lang, next.last_active]
  );
  return next;
}
async function clearSession(from) {
  await db.run(`DELETE FROM sessions WHERE from_number = ?`, from);
}

// ===============
// 🔡 Utilidades
// ===============
const N1 = "\u0031\uFE0F\u20E3";
const N2 = "\u0032\uFE0F\u20E3";
const N3 = "\u0033\uFE0F\u20E3";
const N4 = "\u0034\uFE0F\u20E3";
const N5 = "\u0035\uFE0F\u20E3";
const N6 = "\u0036\uFE0F\u20E3";

function escXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function replyXML(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escXml(text)}</Message></Response>`;
}
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}
function detectLang(body) {
  const b = norm(body);
  if (/\b(english|ingl[eé]s)\b/.test(b)) return "en";
  if (/\b(espanol|espa[nñ]ol)\b/.test(b)) return "es";
  return null;
}

// ==================
// 📋 Textos / Menús
// ==================
const FOOTER = `
✅ Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR 🇵🇷

📞 ${PHONE_PRETTY}
🔗 Facebook: ${FB_URL}

${TAG}`.trim();

function mainMenu() {
  return (
`🇵🇷 *Bienvenido a DestapesPR* 💧 / *Welcome to DestapesPR* 💧

${N1} Destape / Drain cleaning  
${N2} Fuga / Leak  
${N3} Cámara / Camera inspection  
${N4} Calentador / Water heater  
${N5} Otro / Other service  
${N6} Cita / Appointment  

Commands: "start", "menu" or "back" to return to the menu.  
To switch language, type *english* or *español*.

${TAG}`
  );
}

function promptFor(choice, lang = "es") {
  const sections = {
    es: {
      destape:
`🛠️ *Destape*
Vamos a coordinar. Por favor envía en un *solo mensaje*:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
🚿 Qué línea está tapada (fregadero, inodoro, principal, etc.)
⏰ Horario disponible

*Ejemplo:*
"Me llamo Ana Rivera, 939-555-9999, Caguas, inodoro, 10am–1pm"

${FOOTER}`,
      fuga:
`💧 *Fuga*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
💦 Dónde notas la fuga (pared, piso, techo, interior/exterior)
⏰ Horario disponible

${FOOTER}`,
      camara:
`🎥 *Inspección con cámara*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
📌 Área a inspeccionar (baño, cocina, línea principal)
⏰ Horario disponible

${FOOTER}`,
      calentador:
`🔥 *Calentador*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
⚙️ Tipo y problema (gas/eléctrico, no enciende, fuga, etc.)
⏰ Horario disponible

${FOOTER}`,
      otro:
`🧰 *Otro servicio*
Por favor envía:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
📝 Breve descripción
⏰ Horario disponible

${FOOTER}`,
      cita:
`📅 *Cita / Appointment*
Si prefieres, puedes abrir este enlace para coordinar: ${LINK_CITA}

También puedes escribir aquí:
👤 Nombre completo
📞 Número (787/939 o EE. UU.)
📍 Zona (municipio/sector)
⏰ Horario disponible

${FOOTER}`
    },
    en: {
      destape:
`🛠️ *Drain cleaning*
Please send in *one message*:
👤 Full name
📞 Phone (US/PR)
📍 Area (city/neighborhood)
🚿 Which line is clogged (sink, toilet, main, etc.)
⏰ Available time window

${FOOTER}`,
      fuga:
`💧 *Leak*
Please send:
👤 Full name
📞 Phone (US/PR)
📍 Area (city/neighborhood)
💦 Where is the leak (wall, floor, ceiling, inside/outside)
⏰ Available time window

${FOOTER}`,
      camara:
`🎥 *Camera inspection*
Please send:
👤 Full name
📞 Phone (US/PR)
📍 Area (city/neighborhood)
📌 Area to inspect (bathroom, kitchen, main line)
⏰ Available time window

${FOOTER}`,
      calentador:
`🔥 *Water heater*
Please send:
👤 Full name
📞 Phone (US/PR)
📍 Area (city/neighborhood)
⚙️ Type and issue (gas/electric, won’t start, leak, etc.)
⏰ Available time window

${FOOTER}`,
      otro:
`🧰 *Other service*
Please send:
👤 Full name
📞 Phone (US/PR)
📍 Area (city/neighborhood)
📝 Short description
⏰ Available time window

${FOOTER}`,
      cita:
`📅 *Appointment*
You can also use this link to coordinate: ${LINK_CITA}

Or write here:
👤 Full name
📞 Phone (US/PR)
📍 Area (city/neighborhood)
⏰ Available time window

${FOOTER}`
    }
  };

  const map = {
    destape: "destape",
    fuga: "fuga",
    camara: "camara",
    calentador: "calentador",
    otro: "otro",
    cita: "cita"
  };

  const key = map[choice] || "otro";
  return sections[lang][key];
}

// ===============
// 🔎 Keywords
// ===============
const KEYWORDS = {
  destape: ["destape", "tapado", "drenaje", "tuberia", "drain"],
  fuga: ["fuga", "fugas", "agua", "filtracion", "leak"],
  camara: ["camara", "cámara", "inspeccion", "camera"],
  calentador: ["calentador", "heater", "gas", "electrico"],
  otro: ["otro", "consulta", "other"],
  cita: ["cita", "appointment", "agendar", "schedule"]
};
const NUMERIC = { "1": "destape", "2": "fuga", "3": "camara", "4": "calentador", "5": "otro", "6": "cita" };

// ======================
// 🚀 Webhook principal
// ======================
app.get("/__version", (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: "America/Puerto_Rico" });
});

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    await initDB();

    const from = String(req.body.From || req.body.from || req.body.WaId || "").trim();
    const bodyRaw = String(req.body.Body || req.body.body || "").trim();
    const body = norm(bodyRaw);

    if (!body || ["inicio", "menu", "volver", "start", "back"].includes(body)) {
      await clearSession(from);
      return res.type("application/xml").send(replyXML(mainMenu()));
    }

    if (/\b(english|ingl[eé]s)\b/.test(body)) {
      await upsertSession(from, { lang: "en" });
      return res.type("application/xml").send(replyXML("✅ Language set to English.\n\n" + mainMenu()));
    }
    if (/\b(espanol|espa[nñ]ol)\b/.test(body)) {
      await upsertSession(from, { lang: "es" });
      return res.type("application/xml").send(replyXML("✅ Idioma establecido a Español.\n\n" + mainMenu()));
    }

    const sess0 = (await getSession(from)) || {};
    const lang = sess0.lang || detectLang(bodyRaw) || "es";
    const choice = NUMERIC[body] || Object.entries(KEYWORDS).find(([_, list]) =>
      list.some(k => body.includes(k))
    )?.[0];

    if (choice) {
      await upsertSession(from, { last_choice: choice, awaiting_details: 1, lang });
      const ask = promptFor(choice, lang);
      return res.type("application/xml").send(replyXML(ask));
    }

    const s = await getSession(from);
    if (s?.last_choice && s?.awaiting_details) {
      await upsertSession(from, { details: bodyRaw, awaiting_details: 0 });
      const confirm =
        s.lang === "en"
          ? `✅ *Received.* I saved your details:\n"${bodyRaw}"\n\nService: ${s.last_choice}\n\n${FOOTER}`
          : `✅ *Recibido.* Guardé tus detalles:\n"${bodyRaw}"\n\nServicio: ${s.last_choice}\n\n${FOOTER}`;
      return res.type("application/xml").send(replyXML(confirm));
    }

    return res.type("application/xml").send(replyXML(mainMenu()));
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(200).type("application/xml").send(replyXML("Lo siento, ocurrió un error. / Sorry, an error occurred."));
  }
});

app.get("/", (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bilingual Bot V5.1 listening on http://localhost:${PORT}`);
});