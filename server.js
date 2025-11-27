import express from "express";
import morgan from "morgan";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
const PORT = process.env.PORT || 10000;
const TAG = "DestapesPR Bot 5 Pro 🇵🇷";

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));

// ─────────────────────────────────────────────
// SQLite + sesiones
// ─────────────────────────────────────────────
let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h

async function initDB() {
  if (db) return db;

  db = await open({
    filename: "./sessions.db",
    driver: sqlite3.Database,
  });

  // Tabla base
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY
    );
  `);

  // Migración de columnas
  const info = await db.all(`PRAGMA table_info(sessions);`);
  const cols = info.map((c) => c.name);
  const alters = [];

  if (!cols.includes("lang")) alters.push("ADD COLUMN lang TEXT");
  if (!cols.includes("service")) alters.push("ADD COLUMN service TEXT");
  if (!cols.includes("awaiting_details")) alters.push("ADD COLUMN awaiting_details INTEGER DEFAULT 0");
  if (!cols.includes("name")) alters.push("ADD COLUMN name TEXT");
  if (!cols.includes("phone")) alters.push("ADD COLUMN phone TEXT");
  if (!cols.includes("zone")) alters.push("ADD COLUMN zone TEXT");
  if (!cols.includes("details")) alters.push("ADD COLUMN details TEXT");
  if (!cols.includes("last_active")) alters.push("ADD COLUMN last_active INTEGER");

  for (const ddl of alters) {
    await db.exec(`ALTER TABLE sessions ${ddl};`);
  }

  // Limpieza de sesiones viejas
  await db.run(
    "DELETE FROM sessions WHERE last_active IS NOT NULL AND last_active < ?",
    Date.now() - SESSION_TTL_MS
  );

  return db;
}

async function loadSession(from_number) {
  await initDB();
  const row = await db.get(
    "SELECT from_number, lang, service, awaiting_details, name, phone, zone, details, last_active FROM sessions WHERE from_number = ?",
    from_number
  );

  if (!row) {
    return {
      from_number,
      lang: "es",
      service: null,
      awaiting_details: 0,
      name: null,
      phone: null,
      zone: null,
      details: null,
      last_active: Date.now(),
    };
  }

  return {
    from_number: row.from_number,
    lang: row.lang || "es",
    service: row.service || null,
    awaiting_details: row.awaiting_details || 0,
    name: row.name || null,
    phone: row.phone || null,
    zone: row.zone || null,
    details: row.details || null,
    last_active: row.last_active || Date.now(),
  };
}

async function saveSession(session) {
  await initDB();
  const now = Date.now();
  session.last_active = now;

  await db.run(
    `
      INSERT INTO sessions (from_number, lang, service, awaiting_details, name, phone, zone, details, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_number) DO UPDATE SET
        lang = excluded.lang,
        service = excluded.service,
        awaiting_details = excluded.awaiting_details,
        name = excluded.name,
        phone = excluded.phone,
        zone = excluded.zone,
        details = excluded.details,
        last_active = excluded.last_active
    `,
    [
      session.from_number,
      session.lang,
      session.service,
      session.awaiting_details,
      session.name,
      session.phone,
      session.zone,
      session.details,
      session.last_active,
    ]
  );

  return session;
}

async function clearSession(from_number) {
  await initDB();
  await db.run("DELETE FROM sessions WHERE from_number = ?", from_number);
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// ─────────────────────────────────────────────
// Mensajes base
// ─────────────────────────────────────────────
const FB_LINK = "https://www.facebook.com/destapesPR/";

const FOOTER_BILINGUAL = `
✅ Próximamente nos estaremos comunicando. / We will contact you shortly.
Gracias por su patrocinio. / Thank you for your business.
— DestapesPR
📞 787-922-0068
📘 Facebook: ${FB_LINK}
🤖 DestapesPR Bot 5 Pro 🇵🇷
`.trim();

function buildMainMenu() {
  return [
    `👋 ${TAG}`,
    "",
    "Comandos / Commands:",
    '• "inicio", "menu", "volver" → mostrar el menú',
    '• "start", "menu", "back" → show the menu',
    '• Escribe "english" o "español" para preferencia de idioma',
    '• Type "english" or "español" to set language',
    "",
    "🛠️ Servicios / Services:",
    "1️⃣ Destape / Drain cleaning (tapones, tuberías tapadas)",
    "2️⃣ Fuga / Leak (fugas de agua, humedades)",
    "3️⃣ Cámara / Camera inspection",
    "4️⃣ Calentador / Water heater (gas o eléctrico)",
    "5️⃣ Otro / Other service",
    "6️⃣ Cita / Appointment (solo coordinamos por mensaje, sin llamadas automáticas)",
    "",
    `📘 Facebook: ${FB_LINK}`,
    "📞 787-922-0068",
    "🤖 DestapesPR Bot 5 Pro 🇵🇷",
  ].join("\n");
}

function buildServicePrompt(serviceKey, langPref = "es") {
  const both = (es, en) =>
    langPref === "en"
      ? `${en}\n${es}`
      : `${es}\n${en}`;

  switch (serviceKey) {
    case "destape":
      return both(
        "🚿 Servicio de destape. Por favor indica: zona (municipio/sector) y qué está tapado (fregadero, inodoro, línea principal, etc.).",
        "🚿 Drain cleaning service. Please tell me: area (city/sector) and what is clogged (sink, toilet, main line, etc.)."
      );
    case "fuga":
      return both(
        "💧 Servicio de fugas. Indica dónde ves la fuga o humedad (baño, cocina, exterior, etc.) y desde cuándo.",
        "💧 Leak service. Tell me where you see the leak or moisture (bathroom, kitchen, outside, etc.) and since when."
      );
    case "camara":
      return both(
        "📹 Inspección con cámara. Indica en qué área (baño, cocina, línea principal) y qué problema presentas.",
        "📹 Camera inspection. Tell me the area (bathroom, kitchen, main line) and the issue you are noticing."
      );
    case "calentador":
      return both(
        "🔥 Calentador de agua. Indica si es de gas o eléctrico, marca si la conoces y qué falla notas.",
        "🔥 Water heater. Tell me if it’s gas or electric, brand if you know it, and what’s happening."
      );
    case "otro":
      return both(
        "🧰 Otro servicio. Cuéntame brevemente el problema y el área (ej. filtración en techo, reparación sanitaria, etc.).",
        "🧰 Other service. Briefly explain the problem and area (e.g. roof leak, sanitary repair, etc.)."
      );
    case "cita":
      return both(
        "📅 Coordinación de cita. Indica el tipo de servicio que necesitas, zona (municipio/sector), y horario aproximado en el que estás disponible.",
        "📅 Appointment coordination. Tell me the type of service you need, area (city/sector), and approximate time you are available."
      );
    default:
      return both(
        "Por favor indica qué necesitas con algunos detalles.",
        "Please describe what you need with some details."
      );
  }
}

function buildDetailsInstructions(langPref = "es") {
  const es = `Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
📍 Zona (municipio/sector)

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, Caguas"`;

  const en = `Please send everything in one message:
👤 Full name
📞 Contact number (US or Puerto Rico: 787/939)
📍 Area (city/sector)

Example:
"My name is Ana Rivera, 939-555-9999, Caguas"`;

  return langPref === "en" ? `${en}\n\n${es}` : `${es}\n\n${en}`;
}

function buildConfirmationMessage(session, rawMessage) {
  const serviceLabelES = {
    destape: "destape",
    fuga: "fuga",
    camara: "cámara",
    calentador: "calentador",
    otro: "otro servicio",
    cita: "cita",
  };

  const serviceLabelEN = {
    destape: "drain cleaning",
    fuga: "leak",
    camara: "camera inspection",
    calentador: "water heater",
    otro: "other service",
    cita: "appointment",
  };

  const sKey = session.service || "otro";
  const esLabel = serviceLabelES[sKey] || sKey;
  const enLabel = serviceLabelEN[sKey] || sKey;

  return [
    "✅ Datos recibidos / Details received:",
    "",
    `🛠️ Servicio (ES): ${esLabel}`,
    `🛠️ Service (EN): ${enLabel}`,
    "",
    `📝 Mensaje original / Original message:`,
    `"${rawMessage}"`,
    "",
    FOOTER_BILINGUAL,
  ].join("\n");
}

// ─────────────────────────────────────────────
// Lógica de opciones
// ─────────────────────────────────────────────
const OPTION_MAP = {
  "1": "destape",
  "2": "fuga",
  "3": "camara",
  "4": "calentador",
  "5": "otro",
  "6": "cita",
};

const KEYWORDS = {
  destape: [
    "destape",
    "tapon",
    "tapado",
    "tapada",
    "obstruccion",
    "tapones",
    "drenaje",
    "drain",
    "clog",
  ],
  fuga: [
    "fuga",
    "fugas",
    "goteo",
    "goteando",
    "leak",
    "moisture",
    "humedad",
    "filtracion",
    "filtracion",
  ],
  camara: [
    "camara",
    "cámara",
    "camera",
    "video inspeccion",
    "inspection camera",
  ],
  calentador: [
    "calentador",
    "heater",
    "water heater",
    "boiler",
    "caliente",
  ],
  otro: ["otro", "other", "servicio", "service"],
  cita: ["cita", "appointment", "agendar", "schedule"],
};

function detectServiceFromText(body) {
  const normBody = normalize(body);
  if (OPTION_MAP[normBody]) return OPTION_MAP[normBody];

  for (const [key, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => normBody.includes(w))) {
      return key;
    }
  }
  return null;
}

function detectLang(body) {
  const b = normalize(body);
  if (b.includes("english") || b.includes("inglish")) return "en";
  if (b.includes("espanol") || b.includes("español") || b.includes("spanish"))
    return "es";

  // heurístico simple
  const hasHola = b.includes("hola") || b.includes("buenos dias") || b.includes("buenas");
  const hasEnglishWords =
    b.includes("please") ||
    b.includes("hello") ||
    b.includes("hi ") ||
    b.startsWith("hi");

  if (hasEnglishWords && !hasHola) return "en";
  if (hasHola && !hasEnglishWords) return "es";
  return "es"; // por defecto español
}

// ─────────────────────────────────────────────
// Twilio helper
// ─────────────────────────────────────────────
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set("Content-Type", "application/xml");
  return res.send(xml);
}

// ─────────────────────────────────────────────
// Endpoints de diagnóstico
// ─────────────────────────────────────────────
app.get("/__version", (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: "America/Puerto_Rico" });
});

app.get("/", (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

// ─────────────────────────────────────────────
// Webhook principal
// ─────────────────────────────────────────────
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    await initDB();

    const from =
      req.body.From || req.body.from || req.body.WaId || "unknown-number";
    const bodyRaw = req.body.Body || req.body.body || "";
    const bodyNorm = normalize(bodyRaw);

    let session = await loadSession(from);

    // Cambiar idioma explícito
    if (["english", "inglish"].includes(bodyNorm)) {
      session.lang = "en";
      session = await saveSession(session);
      const msg = [
        "🌐 Language set to English.",
        "You can always type “español” to get Spanish + English.",
        "",
        buildMainMenu(),
      ].join("\n");
      return sendTwilioXML(res, msg);
    }

    if (["espanol", "español", "spanish"].includes(bodyNorm)) {
      session.lang = "es";
      session = await saveSession(session);
      const msg = [
        "🌐 Idioma configurado a Español.",
        "Siempre verás Español + Inglés en los mensajes principales.",
        "",
        buildMainMenu(),
      ].join("\n");
      return sendTwilioXML(res, msg);
    }

    // Comandos de menú
    if (
      !bodyNorm ||
      ["inicio", "menu", "volver", "start", "back"].includes(bodyNorm)
    ) {
      await clearSession(from);
      session = await loadSession(from);
      const menu = buildMainMenu();
      return sendTwilioXML(res, menu);
    }

    // Si estamos esperando detalles, lo que venga ahora se toma como info
    if (session.service && session.awaiting_details === 1) {
      session.details = bodyRaw;
      session.awaiting_details = 0;
      await saveSession(session);

      const finalMsg = buildConfirmationMessage(session, bodyRaw);
      return sendTwilioXML(res, finalMsg);
    }

    // Detectar servicio por número o palabra
    const serviceKey = detectServiceFromText(bodyRaw);
    if (serviceKey) {
      session.service = serviceKey;
      session.awaiting_details = 1;
      await saveSession(session);

      const prompt = buildServicePrompt(serviceKey, session.lang);
      const instructions = buildDetailsInstructions(session.lang);

      const fullMsg = [
        prompt,
        "",
        instructions,
        "",
        "Cuando envíes tus datos, te confirmaré que fueron recibidos. / After you send your details, I’ll confirm I got them.",
      ].join("\n");

      return sendTwilioXML(res, fullMsg);
    }

    // Si nada matchea, devolvemos el menú bilingüe
    const fallback = [
      "No pude identificar el servicio. / I could not identify the service.",
      "",
      buildMainMenu(),
    ].join("\n");
    return sendTwilioXML(res, fallback);
  } catch (err) {
    console.error("Error in /webhook/whatsapp", err);
    return sendTwilioXML(
      res,
      "Ocurrió un error interno. / Internal error occurred."
    );
  }
});

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`${TAG} listening on http://localhost:${PORT}`);
});