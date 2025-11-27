import express from "express";
import morgan from "morgan";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const TAG = "DestapesPR Bot 5 Pro 🇵🇷";
const PORT = process.env.PORT || 10000;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

let db;

// ---------- Utilidades de texto ----------
function normalizeText(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Heurística simple para detectar idioma
function detectLangFromText(bodyNorm) {
  const esWords = [
    "hola",
    "buenas",
    "gracias",
    "destape",
    "fuga",
    "fregadero",
    "inodoro",
    "sanitario",
    "cocina",
    "baño",
    "bano",
    "cámara",
    "camara",
    "calentador",
    "tuberia",
    "tubería",
    "cita",
    "servicio",
    "municipio",
    "sector",
    "tapada",
    "tapon",
    "obstruccion",
  ];
  const enWords = [
    "hi",
    "hello",
    "please",
    "thanks",
    "thank you",
    "sink",
    "toilet",
    "heater",
    "water",
    "line",
    "drain",
    "clog",
    "clogged",
    "leak",
    "appointment",
    "schedule",
    "service",
    "city",
    "area",
  ];

  let esScore = 0;
  let enScore = 0;

  for (const w of esWords) {
    if (bodyNorm.includes(w)) esScore++;
  }
  for (const w of enWords) {
    if (bodyNorm.includes(w)) enScore++;
  }

  if (esScore === 0 && enScore === 0) return null;
  return esScore >= enScore ? "es" : "en";
}

// ---------- SQLite (sesiones) ----------
async function initDB() {
  if (db) return db;
  db = await open({
    filename: "./sessions.db",
    driver: sqlite3.Database,
  });

  await db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    from_number TEXT PRIMARY KEY
  );`);

  const cols = await db.all(`PRAGMA table_info('sessions');`);
  const names = cols.map((c) => c.name);

  const ensureCol = async (name, type, defaultExpr = null) => {
    if (!names.includes(name)) {
      const def = defaultExpr ? ` DEFAULT ${defaultExpr}` : "";
      await db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}${def};`);
    }
  };

  await ensureCol("lang", "TEXT");
  await ensureCol("last_choice", "TEXT");
  await ensureCol("awaiting_details", "INTEGER", 0);
  await ensureCol("details", "TEXT");
  await ensureCol("last_active", "INTEGER");

  await db.run("DELETE FROM sessions WHERE last_active < ?", Date.now() - SESSION_TTL_MS);

  return db;
}

async function loadSession(from) {
  if (!db) await initDB();
  return (
    (await db.get("SELECT * FROM sessions WHERE from_number = ?", from)) || null
  );
}

async function saveSession(from, patch) {
  if (!db) await initDB();
  const prev = (await loadSession(from)) || {};
  const now = Date.now();
  const next = {
    lang: patch.lang ?? prev.lang ?? null,
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details:
      patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
    last_active: now,
  };

  await db.run(
    `
    INSERT INTO sessions (from_number, lang, last_choice, awaiting_details, details, last_active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_number) DO UPDATE SET
      lang = excluded.lang,
      last_choice = excluded.last_choice,
      awaiting_details = excluded.awaiting_details,
      details = excluded.details,
      last_active = excluded.last_active
  `,
    [
      from,
      next.lang,
      next.last_choice,
      next.awaiting_details,
      next.details,
      next.last_active,
    ]
  );

  return next;
}

async function clearSession(from) {
  if (!db) await initDB();
  await db.run("DELETE FROM sessions WHERE from_number = ?", from);
}

// ---------- Servicios / textos ----------
const SERVICE_CODES = ["destape", "fuga", "camara", "calentador", "otro", "cita"];

const SERVICE_LABELS = {
  destape: { es: "Destape de tuberías", en: "Drain cleaning" },
  fuga: { es: "Fuga / filtración", en: "Leak / seepage" },
  camara: { es: "Inspección con cámara", en: "Camera inspection" },
  calentador: { es: "Calentador de agua", en: "Water heater" },
  otro: { es: "Otro servicio", en: "Other service" },
  cita: { es: "Coordinar cita", en: "Schedule appointment" },
};

const KEYWORDS = {
  destape: [
    "destape",
    "tapon",
    "tapones",
    "tapada",
    "trancada",
    "obstruccion",
    "obstrucciones",
    "drenaje",
    "desague",
    "desagüe",
    "fregadero",
    "lavaplatos",
    "inodoro",
    "sanitario",
    "toilet",
    "ducha",
    "lavamanos",
    "banera",
    "bañera",
    "principal",
    "linea principal",
    "alcantarillado",
    "pluvial",
    "cloaca",
    "trampa",
    "sifon",
    "sifón",
    "clog",
    "clogged",
    "drain",
    "drain line",
    "sewer",
  ],
  fuga: [
    "fuga",
    "salidero",
    "goteo",
    "goteando",
    "humedad",
    "filtracion",
    "filtración",
    "escapes",
    "escape",
    "charco",
    "leak",
    "leaking",
    "water leak",
  ],
  camara: [
    "camara",
    "cámara",
    "inspeccion",
    "inspección",
    "video inspeccion",
    "video",
    "endoscopia",
    "ver tuberia",
    "ver tubería",
    "camera",
    "inspection",
    "camera inspection",
    "video inspection",
    "scope",
  ],
  calentador: [
    "calentador",
    "boiler",
    "heater",
    "water heater",
    "agua caliente",
    "termo",
    "termotanque",
    "gas",
    "electrico",
    "eléctrico",
    "resistencia",
    "piloto",
    "ignicion",
    "ignición",
    "hot water",
  ],
  otro: [
    "otro",
    "otros",
    "servicio",
    "ayuda",
    "consulta",
    "cotizacion",
    "cotización",
    "presupuesto",
    "visita",
    "other",
    "problem",
    "issue",
    "service",
  ],
  cita: [
    "cita",
    "appointment",
    "agendar",
    "schedule",
    "agendame",
    "reservar",
    "reservation",
    "book",
  ],
};

function detectServiceChoice(bodyNorm) {
  const n = bodyNorm.trim();

  if (["1", "uno", "one"].includes(n)) return "destape";
  if (["2", "dos", "two"].includes(n)) return "fuga";
  if (["3", "tres", "three"].includes(n)) return "camara";
  if (["4", "cuatro", "four"].includes(n)) return "calentador";
  if (["5", "cinco", "five"].includes(n)) return "otro";
  if (["6", "seis", "six"].includes(n)) return "cita";

  for (const code of SERVICE_CODES) {
    if (code === "cita") continue;
    const arr = KEYWORDS[code];
    if (arr && arr.some((k) => bodyNorm.includes(k))) {
      return code;
    }
  }

  if (KEYWORDS.cita.some((k) => bodyNorm.includes(k))) {
    return "cita";
  }

  return null;
}

// ---------- Textos de interfaz ----------
const FB_LINK = "https://www.facebook.com/destapesPR/";
const PHONE_TEXT = "📞 Tel/WhatsApp: +1 (787) 922-0068";

function buildMainMenuText() {
  return [
    "👋 DestapesPR Bot 5 Pro 🇵🇷",
    "",
    "📝 Puedes escribir directamente el servicio que necesitas en español o inglés, por ejemplo:",
    "   • \"destape\", \"fuga\", \"inspección con cámara\", \"calentador\"",
    "   • \"drain cleaning\", \"leak\", \"camera inspection\", \"water heater\"",
    "",
    "O puedes usar el menú con números:",
    "",
    "1️⃣ Destape / Drain cleaning",
    "2️⃣ Fuga / Leak",
    "3️⃣ Cámara / Camera inspection",
    "4️⃣ Calentador / Water heater",
    "5️⃣ Otro servicio / Other service",
    "6️⃣ Cita / Appointment",
    "",
    "Comandos / Commands:",
    "• \"inicio\", \"menu\", \"volver\"  → regresar al menú",
    "• \"start\", \"menu\", \"back\"     → back to the menu",
    "",
    `${PHONE_TEXT}`,
    `📱 Facebook: ${FB_LINK}`,
  ].join("\n");
}

function buildServiceIntroText(serviceCode, lang) {
  const label = SERVICE_LABELS[serviceCode] || SERVICE_LABELS.otro;

  const esHeader = `✅ Servicio seleccionado: ${label.es}`;
  const enHeader = `✅ Selected service: ${label.en}`;

  const esBody = [
    "Por favor envía *todo en un solo mensaje*:",
    "👤 Nombre completo",
    "📞 Número de contacto (787/939 o EE.UU.)",
    "📍 Municipio o zona",
    "🛠️ Breve descripción del problema",
    "",
    "Ejemplo:",
    "“Soy Ana Rivera, 939-555-9999, Caguas, fregadero tapado en la cocina”",
  ].join("\n");

  const enBody = [
    "Please send *everything in a single message*:",
    "👤 Full name",
    "📞 Contact number (US/PR)",
    "📍 City / Area",
    "🛠️ Short description of the issue",
    "",
    "Example:",
    `"I'm Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"`,
  ].join("\n");

  const footer = [
    "",
    "✅ Próximamente nos estaremos comunicando.",
    "✅ We will contact you shortly.",
    "Gracias por su patrocinio. / Thank you for your business.",
    "— DestapesPR",
    "",
    "DestapesPR Bot 5 Pro 🇵🇷",
  ].join("\n");

  if (lang === "en") {
    return [enHeader, "", enBody, "", esBody, footer].join("\n");
  }

  return [esHeader, "", esBody, "", enBody, footer].join("\n");
}

function buildAppointmentText(lang) {
  const es = [
    "📅 Cita / Appointment",
    "",
    "Por favor envía *todo en un solo mensaje*:",
    "👤 Nombre completo",
    "📞 Número de contacto (787/939 o EE.UU.)",
    "📍 Municipio o zona",
    "🛠️ Servicio que necesitas",
    "",
    "Ejemplo:",
    "“Soy Ana Rivera, 939-555-9999, Caguas, quiero coordinar una cita para destape en la cocina”",
  ].join("\n");

  const en = [
    "📅 Appointment / Cita",
    "",
    "Please send *everything in a single message*:",
    "👤 Full name",
    "📞 Contact number (US/PR)",
    "📍 City / Area",
    "🛠️ Service you need",
    "",
    "Example:",
    `"I'm Ana Rivera, 939-555-9999, Caguas, I want to schedule a drain cleaning in the kitchen"`,
  ].join("\n");

  const footer = [
    "",
    "✅ Próximamente nos estaremos comunicando.",
    "✅ We will contact you shortly.",
    "Gracias por su patrocinio. / Thank you for your business.",
    "— DestapesPR",
    "",
    "DestapesPR Bot 5 Pro 🇵🇷",
  ].join("\n");

  if (lang === "en") {
    return [en, "", es, footer].join("\n");
  }
  return [es, "", en, footer].join("\n");
}

function buildDetailsConfirmationText(lang, serviceCode, rawDetails) {
  const label = SERVICE_LABELS[serviceCode] || SERVICE_LABELS.otro;

  const es = [
    "✅ Recibido. Guardé tus datos:",
    `"${rawDetails}"`,
    "",
    `Servicio seleccionado: ${label.es}`,
  ].join("\n");

  const en = [
    "✅ Received. I saved your details:",
    `"${rawDetails}"`,
    "",
    `Selected service: ${label.en}`,
  ].join("\n");

  const footer = [
    "",
    "✅ Próximamente nos estaremos comunicando.",
    "✅ We will contact you shortly.",
    "Gracias por su patrocinio. / Thank you for your business.",
    "— DestapesPR",
    "",
    "DestapesPR Bot 5 Pro 🇵🇷",
  ].join("\n");

  if (lang === "en") {
    return [en, "", es, footer].join("\n");
  }
  return [es, "", en, footer].join("\n");
}

// ---------- Twilio helper ----------
function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set("Content-Type", "application/xml; charset=utf-8");
  return res.status(200).send(xml);
}

// ---------- App ----------
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));

app.get("/", (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

app.get("/__version", (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: "America/Puerto_Rico" });
});

// Webhook principal
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    await initDB();

    const from =
      (req.body.From || req.body.from || req.body.WaId || "").toString();
    const bodyRaw = (req.body.Body || req.body.body || "").toString();
    const bodyNorm = normalizeText(bodyRaw);

    if (!from) {
      return sendTwilioXML(
        res,
        "Error: no se recibió número de origen. / Source number missing."
      );
    }

    let session = (await loadSession(from)) || {
      lang: null,
      last_choice: null,
      awaiting_details: 0,
      details: null,
    };

    const isMenuCmd = [
      "menu",
      "inicio",
      "start",
      "comenzar",
      "volver",
      "back",
      "",
    ].includes(bodyNorm);

    const langFromText = detectLangFromText(bodyNorm);
    const lang = langFromText || session.lang || "es";

    // 1) Comandos de menú: siempre resetean e imprimen menú
    if (isMenuCmd) {
      session = await saveSession(from, {
        lang,
        last_choice: null,
        awaiting_details: 0,
        details: null,
      });
      const menuText = buildMainMenuText();
      return sendTwilioXML(res, menuText);
    }

    // 2) SI YA HAY SERVICIO SELECCIONADO Y ESPERAMOS DETALLES,
    //    SIEMPRE TRATAR ESTE MENSAJE COMO DETALLES (AUNQUE CONTENGA "toilet", "leak", etc)
    if (session.last_choice && session.awaiting_details) {
      await saveSession(from, {
        lang,
        details: bodyRaw,
        awaiting_details: 0,
      });
      const txt = buildDetailsConfirmationText(
        lang,
        session.last_choice,
        bodyRaw
      );
      return sendTwilioXML(res, txt);
    }

    // 3) Detectar nuevo servicio (solo si NO estamos esperando detalles)
    const serviceChoice = detectServiceChoice(bodyNorm);

    if (serviceChoice) {
      if (serviceChoice === "cita") {
        await saveSession(from, {
          lang,
          last_choice: "cita",
          awaiting_details: 1,
          details: null,
        });
        const txt = buildAppointmentText(lang);
        return sendTwilioXML(res, txt);
      } else {
        await saveSession(from, {
          lang,
          last_choice: serviceChoice,
          awaiting_details: 1,
          details: null,
        });
        const txt = buildServiceIntroText(serviceChoice, lang);
        return sendTwilioXML(res, txt);
      }
    }

    // 4) Fallback: menú principal
    const fallback = buildMainMenuText();
    return sendTwilioXML(res, fallback);
  } catch (e) {
    console.error("Error in /webhook/whatsapp", e);
    return sendTwilioXML(
      res,
      "Hubo un error procesando tu mensaje. / There was an error processing your message."
    );
  }
});

app.listen(PORT, () => {
  console.log(`${TAG} listening on http://localhost:${PORT}`);
});