// server.js – DestapesPR Bot 5 Pro 🇵🇷 (detector ES/EN, respuestas por idioma)

import express from "express";
import morgan from "morgan";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const TAG = "DestapesPR Bot 5 Pro 🇵🇷";
const PORT = process.env.PORT || 10000;

const FB_LINK = "https://www.facebook.com/destapesPR/";
const PHONE = "787-922-0068";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));

// ---------- Helpers de texto ----------

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Detector sencillo ES/EN
function detectLang(normalized) {
  const t = normalized || "";
  if (!t) return "es";

  const esHits = [
    "destape",
    "tapon",
    "tapada",
    "fuga",
    "fugas",
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
    "agendar",
    "hola",
    "buenas",
    "menu",
    "inicio",
    "volver",
    "otro servicio"
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
    "booking",
    "hello",
    "hi",
    "menu",
    "back",
    "start",
    "other service"
  ].filter((w) => t.includes(w)).length;

  if (enHits > esHits) return "en";
  if (esHits > enHits) return "es";
  return "es"; // default
}

// Mapeo de servicios por palabras clave
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
    "obstrucción",
    "drain",
    "clog",
    "clogged",
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
    "humedad",
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
    "inspección",
    "camera inspection",
    "inspection",
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

function serviceLabel(lang, choice) {
  if (lang === "en") {
    switch (choice) {
      case "destape":
        return "Drain cleaning";
      case "fuga":
        return "Water leak";
      case "camara":
        return "Camera inspection";
      case "calentador":
        return "Water heater";
      case "cita":
        return "Appointment";
      case "otro":
      default:
        return "Other service";
    }
  } else {
    // es
    switch (choice) {
      case "destape":
        return "Destape";
      case "fuga":
        return "Fuga de agua";
      case "camara":
        return "Inspección con cámara";
      case "calentador":
        return "Calentador de agua";
      case "cita":
        return "Cita";
      case "otro":
      default:
        return "Otro servicio";
    }
  }
}

// ---------- SQLite sesiones ----------

let db;
const SESSION_TTL_MS = 48 * 60 * 60 * 1000; // 48h

async function initDB() {
  if (db) return db;

  db = await open({
    filename: "./sessions.db",
    driver: sqlite3.Database
  });

  // Crear tabla base
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

  // Migración defensiva
  const cols = await db.all(`PRAGMA table_info(sessions);`);
  const names = cols.map((c) => c.name);

  async function ensureColumn(name, def) {
    if (!names.includes(name)) {
      try {
        await db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${def};`);
      } catch (e) {
        console.error("Error adding column", name, e.message);
      }
    }
  }

  await ensureColumn("lang", "TEXT");
  await ensureColumn("last_choice", "TEXT");
  await ensureColumn("awaiting_details", "INTEGER DEFAULT 0");
  await ensureColumn("details", "TEXT");
  await ensureColumn("last_active", "INTEGER");

  // Limpiar viejas
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
    lang: patch.lang ?? prev.lang ?? "es",
    last_choice: patch.last_choice ?? prev.last_choice ?? null,
    awaiting_details: patch.awaiting_details ?? prev.awaiting_details ?? 0,
    details: patch.details ?? prev.details ?? null,
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

// ---------- Textos por idioma ----------

function footerText(lang) {
  if (lang === "en") {
    return `
📘 Facebook: ${FB_LINK}
📞 Phone: ${PHONE}

🤖 DestapesPR Bot 5 Pro – Bilingual ES/EN`;
  }
  return `
📘 Facebook: ${FB_LINK}
📞 Teléfono: ${PHONE}

🤖 DestapesPR Bot 5 Pro – Bilingüe ES/EN`;
}

function mainMenuText(lang) {
  if (lang === "en") {
    return `
👋 Welcome to DestapesPR Bot 5 Pro 🇵🇷

Please select a number or type the service you need:

1️⃣ Drain cleaning  
2️⃣ Water leak  
3️⃣ Camera inspection  
4️⃣ Water heater  
5️⃣ Other service  
6️⃣ Appointment

⌨️ Commands:
Type "start", "menu" or "back" to return to this menu.${footerText("en")}`;
  }

  // Español
  return `
👋 Bienvenido a DestapesPR Bot 5 Pro 🇵🇷

Por favor, selecciona un número o escribe el servicio que necesitas:

1️⃣ Destape  
2️⃣ Fuga de agua  
3️⃣ Inspección con cámara  
4️⃣ Calentador de agua  
5️⃣ Otro servicio  
6️⃣ Cita

⌨️ Comandos:
Escribe "inicio", "menu" o "volver" para regresar a este menú.${footerText("es")}`;
}

function detailsBlock(lang) {
  if (lang === "en") {
    return `
Please send everything in ONE message:
👤 Full name  
📞 Contact number (787/939 or U.S.)  
📍 Area or town  
🛠️ Service or issue

Example:
"My name is Ana Rivera, 939-555-9999, Caguas, kitchen sink clogged"

(Type "back" to return to the menu.)`;
  }

  // ES
  return `
Por favor envía todo en UN solo mensaje:
👤 Nombre completo  
📞 Número de contacto (787/939 o EE.UU.)  
📍 Zona o pueblo  
🛠️ Servicio o problema

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, Caguas, fregadero de la cocina tapado"

(Escribe "volver" para regresar al menú.)`;
}

function promptForService(lang, choice) {
  const label = serviceLabel(lang, choice);

  if (lang === "en") {
    switch (choice) {
      case "destape":
        return `
🛠️ Service: ${label}

We will help you with your clogged line or drain.${detailsBlock("en")}`;
      case "fuga":
        return `
🛠️ Service: ${label}

We will help you with your water leak or moisture issue.${detailsBlock("en")}`;
      case "camara":
        return `
🛠️ Service: ${label}

We will help you with a camera inspection of your line.${detailsBlock("en")}`;
      case "calentador":
        return `
🛠️ Service: ${label}

We will help you with your water heater (gas or electric).${detailsBlock("en")}`;
      case "cita":
        return `
🛠️ Service: ${label}

Let's schedule your appointment.${detailsBlock("en")}`;
      case "otro":
      default:
        return `
🛠️ Service: ${label}

Tell us briefly what you need.${detailsBlock("en")}`;
    }
  }

  // Español
  switch (choice) {
    case "destape":
      return `
🛠️ Servicio: ${label}

Te ayudaremos con tu línea o drenaje tapado.${detailsBlock("es")}`;
    case "fuga":
      return `
🛠️ Servicio: ${label}

Te ayudaremos con tu fuga de agua o problema de humedad.${detailsBlock("es")}`;
    case "camara":
      return `
🛠️ Servicio: ${label}

Te ayudaremos con la inspección con cámara de tu tubería.${detailsBlock("es")}`;
    case "calentador":
      return `
🛠️ Servicio: ${label}

Te ayudaremos con tu calentador de agua (gas o eléctrico).${detailsBlock("es")}`;
    case "cita":
      return `
🛠️ Servicio: ${label}

Vamos a coordinar tu cita.${detailsBlock("es")}`;
    case "otro":
    default:
      return `
🛠️ Servicio: ${label}

Cuéntanos brevemente qué necesitas.${detailsBlock("es")}`;
  }
}

function confirmationText(lang, choice, detailsRaw) {
  const label = serviceLabel(lang, choice);

  if (lang === "en") {
    return `
✅ Received.

I saved your details:

"${detailsRaw}"

Service: ${label}

📞 We will contact you shortly.

Thank you for your business.  
— DestapesPR${footerText("en")}`;
  }

  // Español
  return `
✅ Recibido.

Guardé tus detalles:

"${detailsRaw}"

Servicio: ${label}

📞 Próximamente nos estaremos comunicando contigo.

Gracias por su patrocinio.  
— DestapesPR${footerText("es")}`;
}

// ---------- Twilio XML ----------

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

// ---------- Rutas diagnóstico ----------

app.get("/__version", (_req, res) => {
  res.json({ ok: true, tag: TAG, tz: "America/Puerto_Rico" });
});

app.get("/", (_req, res) => {
  res.send(`${TAG} activo ✅`);
});

// ---------- Webhook principal WhatsApp ----------

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

    // Idioma estimado
    const langGuess = detectLang(bodyNorm);
    const lang = session?.lang || langGuess || "es";

    // Comandos globales al menú
    const isMenuCmd = ["inicio", "menu", "volver", "start", "back"].includes(
      bodyNorm
    );

    if (!bodyNorm || isMenuCmd) {
      await clearSession(from);
      await saveSession(from, { lang, last_choice: null, awaiting_details: 0 });
      const reply = mainMenuText(lang);
      return sendTwilioXML(res, reply);
    }

    // Si está esperando detalles, cualquier cosa es info
    if (session?.awaiting_details) {
      const choice = session.last_choice || "otro";
      await saveSession(from, {
        lang,
        details: bodyRaw,
        awaiting_details: 0
      });

      const reply = confirmationText(lang, choice, bodyRaw);
      return sendTwilioXML(res, reply);
    }

    // Detectar servicio desde el mensaje
    const detectedChoice = detectServiceChoice(bodyRaw);

    if (detectedChoice) {
      session = await saveSession(from, {
        lang,
        last_choice: detectedChoice,
        awaiting_details: 1,
        details: null
      });

      const reply = promptForService(lang, detectedChoice);
      return sendTwilioXML(res, reply);
    }

    // Si no entendí, devuelvo menú en su idioma
    const fallback =
      lang === "en"
        ? `I didn’t understand your message. Returning to the menu...${mainMenuText(
            "en"
          )}`
        : `No entendí tu mensaje. Regresando al menú...${mainMenuText("es")}`;

    return sendTwilioXML(res, fallback);
  } catch (err) {
    console.error("Error in /webhook/whatsapp", err);
    return sendTwilioXML(
      res,
      "⚠️ Ocurrió un error procesando tu mensaje. / An error occurred processing your message."
    );
  }
});

// ---------- Iniciar servidor ----------

app.listen(PORT, () => {
  console.log(`${TAG} escuchando en http://localhost:${PORT}`);
});