// server.js – DestapesPR Bot 5 Pro 🇵🇷 (Bilingüe ES/EN)

import express from "express";
import morgan from "morgan";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const TAG = "DestapesPR Bot 5 Pro 🇵🇷";

// --- Config básica ---
const PORT = process.env.PORT || 10000;
const FB_LINK = "https://www.facebook.com/destapesPR/";
const PHONE = "787-922-0068";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));

// --- Helpers de texto ---

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function detectLang(normalized) {
  const t = normalized;
  if (!t) return "es";

  const esHits = [
    "destape",
    "tapon",
    "tapada",
    "fuga",
    "fugas",
    "tuberia",
    "tuberias",
    "tuberia",
    "baño",
    "bano",
    "inodoro",
    "fregadero",
    "lavamanos",
    "lavaplatos",
    "calentador",
    "gas",
    "electrico",
    "cita",
    "agendar"
  ].filter((w) => t.includes(w)).length;

  const enHits = [
    "drain",
    "clog",
    "clogged",
    "leak",
    "leaks",
    "pipe",
    "pipes",
    "bathroom",
    "toilet",
    "sink",
    "water heater",
    "heater",
    "appointment",
    "schedule",
    "booking"
  ].filter((w) => t.includes(w)).length;

  if (enHits > esHits) return "en";
  if (esHits > enHits) return "es";
  return "es";
}

// --- Detección de servicio / opción ---

const SERVICE_KEYS = {
  destape: [
    "1",
    "1️⃣",
    "uno",
    "destape",
    "destapar",
    "tapon",
    "tapada",
    "tapado",
    "obstruccion",
    "clog",
    "clogged",
    "drain",
    "drain cleaning"
  ],
  fuga: [
    "2",
    "2️⃣",
    "dos",
    "fuga",
    "fugas",
    "goteo",
    "goteando",
    "leak",
    "leaks",
    "leaking",
    "water leak"
  ],
  camara: [
    "3",
    "3️⃣",
    "tres",
    "camara",
    "cámara",
    "inspeccion",
    "inspection",
    "camera inspection",
    "video inspection"
  ],
  calentador: [
    "4",
    "4️⃣",
    "cuatro",
    "calentador",
    "boiler",
    "heater",
    "water heater",
    "agua caliente"
  ],
  otro: [
    "5",
    "5️⃣",
    "cinco",
    "otro",
    "otros",
    "other",
    "another",
    "consult",
    "consulta",
    "quote",
    "cotizacion",
    "cotización"
  ],
  cita: [
    "6",
    "6️⃣",
    "seis",
    "cita",
    "agendar",
    "agenda",
    "appointment",
    "schedule",
    "book",
    "booking"
  ]
};

function detectServiceChoice(raw) {
  const n = normalize(raw);
  if (!n) return null;

  for (const [key, arr] of Object.entries(SERVICE_KEYS)) {
    for (const token of arr) {
      const nt = normalize(token);
      if (!nt) continue;
      if (n === nt || n.includes(nt)) {
        return key; // destape, fuga, camara, calentador, otro, cita
      }
    }
  }
  return null;
}

function serviceLabel(choice) {
  switch (choice) {
    case "destape":
      return "Destape / Drain cleaning";
    case "fuga":
      return "Fuga / Leak";
    case "camara":
      return "Cámara / Camera inspection";
    case "calentador":
      return "Calentador / Water heater";
    case "cita":
      return "Cita / Appointment";
    case "otro":
    default:
      return "Otro servicio / Other service";
  }
}

// --- SQLite: sesiones ---

let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48 horas

async function initDB() {
  if (db) return db;

  db = await open({
    filename: "./sessions.db",
    driver: sqlite3.Database
  });

  // Crear tabla básica si no existe
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      from_number TEXT PRIMARY KEY,
      lang TEXT,
      last_choice TEXT,
      awaiting_details INTEGER DEFAULT 0,
      details TEXT,
      last_active INTEGER
    );
  `);

  // Migración defensiva por si la tabla venía de una versión vieja
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const names = cols.map((c) => c.name);

  async function ensureColumn(name, typeDef) {
    if (!names.includes(name)) {
      try {
        await db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${typeDef};`);
      } catch (e) {
        console.error("Error adding column", name, e);
      }
    }
  }

  await ensureColumn("lang", "TEXT");
  await ensureColumn("last_choice", "TEXT");
  await ensureColumn("awaiting_details", "INTEGER DEFAULT 0");
  await ensureColumn("details", "TEXT");
  await ensureColumn("last_active", "INTEGER");

  // Limpiar sesiones viejas
  await db.run(
    "DELETE FROM sessions WHERE last_active < ?",
    Date.now() - SESSION_TTL_MS
  );

  return db;
}

async function getSession(from_number) {
  await initDB();
  return db.get("SELECT * FROM sessions WHERE from_number = ?", from_number);
}

async function saveSession(from_number, patch) {
  await initDB();
  const prev = (await getSession(from_number)) || {};
  const next = {
    lang:
      patch.lang ??
      prev.lang ??
      "es",
    last_choice:
      patch.last_choice ??
      prev.last_choice ??
      null,
    awaiting_details:
      patch.awaiting_details ??
      prev.awaiting_details ??
      0,
    details:
      patch.details ??
      prev.details ??
      null,
    last_active: Date.now()
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
      from_number,
      next.lang,
      next.last_choice,
      next.awaiting_details,
      next.details,
      next.last_active
    ]
  );

  return next;
}

async function clearSession(from_number) {
  await initDB();
  await db.run("DELETE FROM sessions WHERE from_number = ?", from_number);
}

// --- Mensajes base (bilingües) ---

function footerText() {
  return `
📘 Facebook: ${FB_LINK}
📞 Tel: ${PHONE}

🤖 DestapesPR Bot 5 Pro – Bilingual ES/EN`;
}

function mainMenuText() {
  return `
👋 ${TAG}

🇪🇸 Selecciona un número o escribe el servicio que deseas solicitar.  
🇺🇸 Select a number or type the service you wish to request.

1️⃣ Destape / Drain cleaning  
2️⃣ Fuga / Leak  
3️⃣ Cámara / Camera inspection  
4️⃣ Calentador / Water heater  
5️⃣ Otro servicio / Other service  
6️⃣ Cita / Appointment

⌨️ Comandos:
🇪🇸 Escribe "inicio" o "menu" o "volver" para regresar al menú.  
🇺🇸 Type "start", "menu" or "back" to return to the menu.${footerText()}`;
}

function detailsCommonBlock() {
  return `
Por favor envía en un solo mensaje:
👤 Nombre completo / Full name  
📞 Número de contacto (787/939 o EE.UU.) / Contact number (787/939 or U.S.)  
📍 Zona o pueblo / Area or town  
🛠️ Servicio o problema / Service or issue

Ejemplo / Example:
"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero tapado en la cocina"

(Escribe "volver" para regresar al menú / Type "back" to return to the menu).`;
}

function promptForService(choice) {
  const label = serviceLabel(choice);

  switch (choice) {
    case "destape":
      return `
🛠️ Servicio: ${label}

🇪🇸 Te ayudaremos con tu destape.  
🇺🇸 We will help you with your drain cleaning.${detailsCommonBlock()}`;

    case "fuga":
      return `
🛠️ Servicio: ${label}

🇪🇸 Te ayudaremos con tu fuga o filtración de agua.  
🇺🇸 We will help you with your water leak.${detailsCommonBlock()}`;

    case "camara":
      return `
🛠️ Servicio: ${label}

🇪🇸 Te ayudaremos con la inspección con cámara.  
🇺🇸 We will help you with the camera inspection.${detailsCommonBlock()}`;

    case "calentador":
      return `
🛠️ Servicio: ${label}

🇪🇸 Te ayudaremos con tu calentador de agua.  
🇺🇸 We will help you with your water heater.${detailsCommonBlock()}`;

    case "cita":
      return `
🛠️ Servicio: ${label}

🇪🇸 Vamos a coordinar tu cita.  
🇺🇸 Let's schedule your appointment.${detailsCommonBlock()}`;

    case "otro":
    default:
      return `
🛠️ Servicio: ${label}

🇪🇸 Cuéntanos brevemente qué necesitas.  
🇺🇸 Tell us briefly what you need.${detailsCommonBlock()}`;
  }
}

function confirmationText(choice, detailsRaw) {
  const label = serviceLabel(choice);

  return `
✅ Recibido / Received.

🇪🇸 Guardé tus detalles:  
🇺🇸 I saved your details:

"${detailsRaw}"

Servicio / Service: ${label}

📞 🇪🇸 Próximamente nos estaremos comunicando contigo.  
📞 🇺🇸 We will contact you shortly.

Gracias por su patrocinio. / Thank you for your business.  
— DestapesPR${footerText()}`;
}

// --- Twilio XML ---

function sendTwilioXML(res, message) {
  const safe = String(message || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Message>${safe}</Message></Response>`;

  res.set("Content-Type", "application/xml");
  return res.status(200).send(xml);
}

// --- Rutas de diagnóstico ---

app.get("/__version", (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: "America/Puerto_Rico" });
});

app.get("/", (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

// --- Webhook principal WhatsApp ---

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    await initDB();

    const from =
      req.body.From ||
      req.body.from ||
      req.body.WaId ||
      "";
    const bodyRaw = (req.body.Body || req.body.body || "").toString();
    const bodyNorm = normalize(bodyRaw);

    let session = await getSession(from);

    // 1) Comandos globales para menú
    const isMenuCmd = ["inicio", "menu", "volver", "start", "back"].includes(
      bodyNorm
    );

    if (!bodyNorm || isMenuCmd) {
      await clearSession(from);
      const reply = mainMenuText();
      return sendTwilioXML(res, reply);
    }

    // 2) Si está esperando detalles, cualquier texto se toma como detalles
    if (session?.awaiting_details) {
      const choice = session.last_choice || "otro";
      await saveSession(from, {
        details: bodyRaw,
        awaiting_details: 0
      });

      const reply = confirmationText(choice, bodyRaw);
      return sendTwilioXML(res, reply);
    }

    // 3) Detectar servicio desde el mensaje
    const detectedChoice = detectServiceChoice(bodyRaw);
    const langGuess = detectLang(bodyNorm);
    const langFinal = session?.lang || langGuess || "es";

    // Si encontramos un servicio
    if (detectedChoice) {
      session = await saveSession(from, {
        lang: langFinal,
        last_choice: detectedChoice,
        awaiting_details: 1,
        details: null
      });

      const reply = promptForService(detectedChoice);
      return sendTwilioXML(res, reply);
    }

    // 4) Si no entendemos, regresamos al menú
    const fallback = mainMenuText();
    return sendTwilioXML(res, fallback);
  } catch (err) {
    console.error("Error in /webhook/whatsapp", err);
    return sendTwilioXML(
      res,
      "⚠️ Ocurrió un error procesando tu mensaje. / An error occurred processing your message."
    );
  }
});

// --- Iniciar servidor ---
app.listen(PORT, () => {
  console.log(`${TAG} escuchando en http://localhost:${PORT}`);
});