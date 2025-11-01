import express from "express";
import morgan from "morgan";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));

// ================== CONFIG ==================
const PHONE = "+17879220068";
const FB_LINK = "https://www.facebook.com/destapesPR/";
const TAG = "Bilingual Bot V5";

// Números-emoji (Unicode escapes)
const N1 = "\u0031\uFE0F\u20E3"; // 1️⃣
const N2 = "\u0032\uFE0F\u20E3"; // 2️⃣
const N3 = "\u0033\uFE0F\u20E3"; // 3️⃣
const N4 = "\u0034\uFE0F\u20E3"; // 4️⃣
const N5 = "\u0035\uFE0F\u20E3"; // 5️⃣
const N6 = "\u0036\uFE0F\u20E3"; // 6️⃣
const N7 = "\u0037\uFE0F\u20E3"; // 7️⃣

const FOOTER_ES = `
✅ Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR 🇵🇷

📞 ${PHONE}
📘 Facebook: ${FB_LINK}

🤖 Bilingual Bot V4`;

const FOOTER_EN = `
✅ We will contact you shortly.
Thank you for your business.
— DestapesPR 🇵🇷

📞 ${PHONE}
📘 Facebook: ${FB_LINK}

🤖 Bilingual Bot V4`;

const MAIN_MENU_ES = `
🇵🇷 *Bienvenido a DestapesPR Bilingual Bot* 🤖

Selecciona una opción escribiendo el número o la palabra:

${N1}  Destape (drenajes o tuberías tapadas)
${N2}  Fuga (fugas de agua)
${N3}  Cámara (inspección con cámara)
${N4}  Calentador (gas o eléctrico)
${N5}  Otro servicio
${N6}  Cita o agendar servicio
${N7}  Idioma / Language (cambiar ES/EN)

📞 Teléfono directo: ${PHONE}
📘 Facebook: ${FB_LINK}

Comandos: "inicio", "menu" o "volver" para regresar al menú.
Para cambiar idioma, escribe *english* o *español*.`;

const MAIN_MENU_EN = `
🇵🇷 *Welcome to DestapesPR Bilingual Bot* 🤖

Please select a service by typing the number or the word:

${N1}  Unclog (drains or blocked pipes)
${N2}  Leak (water leaks)
${N3}  Camera (pipe inspection)
${N4}  Heater (gas or electric)
${N5}  Other service
${N6}  Schedule an appointment
${N7}  Language / Idioma (switch EN/ES)

📞 Direct line: ${PHONE}
📘 Facebook: ${FB_LINK}

Commands: "start", "menu" or "back" to return to the menu.
To switch language, type *english* or *español*.`;

// Descripciones por servicio
const RESP_ES = {
  destape: `🚿 Perfecto. ¿En qué área estás (municipio o sector)?
Luego cuéntame qué línea está tapada (fregadero, inodoro, principal, etc.).`,
  fuga: `💧 Entendido. ¿Dónde notas la fuga o humedad? ¿Es dentro o fuera de la propiedad?`,
  camara: `📹 Realizamos inspección con cámara. ¿En qué área la necesitas (baño, cocina, línea principal)?`,
  calentador: `🔥 Revisamos calentadores eléctricos o de gas. ¿Qué tipo tienes y qué problema notas?`,
  otro: `🧰 Cuéntame brevemente qué servicio necesitas y en qué área estás.`,
  cita: `📅 Por favor envía en un solo mensaje:
👤 Nombre completo
📞 Número de contacto (787/939 o EE.UU.)
⏰ Horario disponible

Ejemplo:
"Me llamo Ana Rivera, 939-555-9999, 10am-1pm en Caguas"`
};

const RESP_EN = {
  destape: `🚿 Great! Which area are you in (city or sector)?
Then tell me which line is clogged (sink, toilet, main, etc.).`,
  fuga: `💧 Got it. Where do you notice the leak or moisture? Inside or outside the property?`,
  camara: `📹 We perform camera inspections. In what area do you need it (bathroom, kitchen, main line)?`,
  calentador: `🔥 We service electric and gas heaters. What type do you have and what issue are you seeing?`,
  otro: `🧰 Please tell me briefly what service you need and where you are located.`,
  cita: `📅 Please send the following in one message:
👤 Full name
📞 Contact number (787/939 or US)
⏰ Available time

Example:
"My name is Ana Rivera, 939-555-9999, 10am-1pm in Caguas"`
};

const SERVICE_LABEL = {
  es: { destape: "destape", fuga: "fuga", camara: "cámara", calentador: "calentador", otro: "otro", cita: "cita" },
  en: { destape: "unclog", fuga: "leak", camara: "camera", calentador: "heater", otro: "other", cita: "appointment" }
};

const CHOICES = {
  es: {
    "1": "destape", [N1]: "destape", "destape": "destape",
    "2": "fuga",    [N2]: "fuga",    "fuga": "fuga",
    "3": "camara",  [N3]: "camara",  "cámara": "camara", "camara": "camara",
    "4": "calentador",[N4]:"calentador","calentador":"calentador",
    "5": "otro",    [N5]: "otro",    "otro": "otro",
    "6": "cita",    [N6]: "cita",    "cita": "cita", "agendar": "cita", "reservar": "cita",
    "7": "lang",    [N7]: "lang",
    "idioma": "lang", "lenguaje": "lang", "language": "lang",
    "ingles": "lang", "inglés": "lang", "english": "lang",
    "espanol": "lang", "español": "lang", "spanish": "lang", "en": "lang", "es": "lang"
  },
  en: {
    "1": "destape", [N1]:"destape", "unclog":"destape","clog":"destape","blocked":"destape",
    "2": "fuga",    [N2]:"fuga",    "leak":"fuga",
    "3": "camara",  [N3]:"camara",  "camera":"camara","inspection":"camara",
    "4": "calentador",[N4]:"calentador","heater":"calentador","hot water":"calentador",
    "5": "otro",    [N5]:"otro",    "other":"otro","help":"otro","service":"otro",
    "6": "cita",    [N6]:"cita",    "appointment":"cita","schedule":"cita","book":"cita",
    "7": "lang",    [N7]:"lang",
    "language": "lang", "idioma": "lang",
    "english": "lang", "spanish": "lang", "espanol": "lang", "español": "lang", "en": "lang", "es": "lang"
  }
};

const KEYWORDS = {
  es: {
    destape: ["destape","tapado","obstruccion","obstrucción","fregadero","inodoro","toilet","principal","drenaje","desagüe","desague","trancado"],
    fuga: ["fuga","salidero","goteo","humedad","filtración","filtracion","escape","charco"],
    camara: ["cámara","camara","inspección","inspeccion","video","ver tubería","ver tuberia","localizar"],
    calentador: ["calentador","agua caliente","boiler","gas","eléctrico","electrico"],
    otro: ["otro","servicio","ayuda","consulta","presupuesto","cotización","cotizacion"],
    cita: ["cita","agendar","agenda","reservar"]
  },
  en: {
    destape: ["unclog","clog","blocked","drain","sink","toilet","main line"],
    fuga: ["leak","moisture","drip","water leak"],
    camara: ["camera","inspection","pipe video"],
    calentador: ["heater","hot water","boiler","gas","electric"],
    otro: ["other","service","help","quote"],
    cita: ["appointment","schedule","book","reserve"]
  }
};

// ============== DB INIT + MIGRACIÓN ==============
let db;
async function ensureSchema(dbo) {
  await dbo.exec(`CREATE TABLE IF NOT EXISTS sessions ( from_number TEXT PRIMARY KEY )`);
  const cols = new Set((await dbo.all(`PRAGMA table_info(sessions)`)).map(r => r.name));
  if (!cols.has("lang"))             await dbo.exec(`ALTER TABLE sessions ADD COLUMN lang TEXT DEFAULT 'es'`);
  if (!cols.has("last_choice"))      await dbo.exec(`ALTER TABLE sessions ADD COLUMN last_choice TEXT`);
  if (!cols.has("awaiting_details")) await dbo.exec(`ALTER TABLE sessions ADD COLUMN awaiting_details INTEGER DEFAULT 0`);
  if (!cols.has("details"))          await dbo.exec(`ALTER TABLE sessions ADD COLUMN details TEXT`);
  if (!cols.has("last_active"))      await dbo.exec(`ALTER TABLE sessions ADD COLUMN last_active INTEGER`);
}
async function initDB() {
  if (db) return db;
  db = await open({ filename: "./sessions.db", driver: sqlite3.Database });
  await ensureSchema(db);
  return db;
}

// ============== UTILIDADES ==============
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Detección robusta de idioma
function detectLangSmart(from, body) {
  const t = body || "";

  const englishHints = /\b(unclog|leak|camera|heater|appointment|schedule|book|other|quote|service|help)\b/i.test(t);
  const spanishHints = /\b(destape|fuga|c[aá]mara|calentador|cita|agendar|reservar|hola|buen[oa]s|gracias|inodoro|fregadero|desag[üu]e|tuber[ií]a)\b/i.test(t);
  const hasAccents = /[áéíóúñÁÉÍÓÚÑ]/.test(t);
  const isPR = typeof from === "string" && (/^\+1(787|939)/.test(from));

  if (spanishHints || hasAccents) return "es";
  if (englishHints) return "en";
  if (isPR) return "es";
  return "en";
}

function chooseByNumberOrWord(body, lang) {
  const t = norm(body);
  const map = CHOICES[lang];
  if (map[t]) return map[t];
  const kw = KEYWORDS[lang];
  for (const [srv, arr] of Object.entries(kw)) {
    if (arr.some(k => t.includes(norm(k)))) return srv;
  }
  return null;
}

function twiml(text) {
  const safe = String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

// ============== ENDPOINTS ==============
app.get("/", (_req, res) => res.send(`${TAG} DestapesPR Bot OK`));
app.get("/__version", (_req, res) => res.json({ ok: true, tag: TAG, tz: "America/Puerto_Rico" }));

app.post("/webhook/whatsapp", async (req, res) => {
  await initDB();
  res.set("Content-Type", "application/xml; charset=utf-8");

  const from = String(req.body.From || req.body.from || req.body.WaId || "");
  const bodyRaw = String(req.body.Body || req.body.body || "");
  const body = bodyRaw.trim();

  let s = await db.get("SELECT * FROM sessions WHERE from_number = ?", from);
  if (!s) {
    const lang0 = detectLangSmart(from, body);
    await db.run(
      "INSERT INTO sessions (from_number, lang, last_choice, awaiting_details, details, last_active) VALUES (?, ?, NULL, 0, NULL, ?)",
      from, lang0, Date.now()
    );
    s = { from_number: from, lang: lang0, last_choice: null, awaiting_details: 0, details: null };
  } else {
    await db.run("UPDATE sessions SET last_active=? WHERE from_number=?", Date.now(), from);
  }

  // Re-evalúa idioma SOLO si hay pistas claras; si no, mantén sesión
  const hinted = detectLangSmart(from, body);
  let lang = s.lang || hinted;
  if (hinted !== s.lang) {
    const switchToES = /\b(destape|fuga|c[aá]mara|calentador|cita|agendar|reservar|hola|buen[oa]s|gracias|inodoro|fregadero|desag[üu]e|tuber[ií]a)\b/i.test(body) || /[áéíóúñÁÉÍÓÚÑ]/.test(body);
    const switchToEN = /\b(unclog|leak|camera|heater|appointment|schedule|book|other|quote|service|help)\b/i.test(body);
    if ((hinted === "es" && switchToES) || (hinted === "en" && switchToEN)) {
      lang = hinted;
      await db.run("UPDATE sessions SET lang=? WHERE from_number=?", lang, from);
    }
  }

  const MENU = lang === "en" ? MAIN_MENU_EN : MAIN_MENU_ES;
  const RESP = lang === "en" ? RESP_EN : RESP_ES;
  const FOOT = lang === "en" ? FOOTER_EN : FOOTER_ES;

  const cmd = norm(body);

  // Cambio rápido de idioma
  if (["english","en"].includes(cmd)) {
    await db.run("UPDATE sessions SET lang=? WHERE from_number=?", "en", from);
    return res.status(200).send(twiml(MAIN_MENU_EN));
  }
  if (["espanol","español","spanish","es"].includes(cmd)) {
    await db.run("UPDATE sessions SET lang=? WHERE from_number=?", "es", from);
    return res.status(200).send(twiml(MAIN_MENU_ES));
  }

  // Comandos de menú
  if (["inicio","menu","volver","start","back"].includes(cmd)) {
    await db.run("UPDATE sessions SET last_choice=NULL, awaiting_details=0, details=NULL WHERE from_number=?", from);
    return res.status(200).send(twiml(MENU));
  }

  // Detección de elección
  const detected = chooseByNumberOrWord(body, lang);
  if (detected) {
    // Opción de idioma (7)
    if (detected === "lang") {
      const promptLang = (lang === "en")
        ? `🌐 Language settings.\nType *english* or *español* to switch.\n\n${FOOT}`
        : `🌐 Ajustes de idioma.\nEscribe *english* o *español* para cambiar.\n\n${FOOT}`;
      return res.status(200).send(twiml(promptLang));
    }

    await db.run(
      "UPDATE sessions SET last_choice=?, awaiting_details=1, details=NULL, lang=? WHERE from_number=?",
      detected, lang, from
    );

    const msg = `${RESP[detected]}

${lang==="en" ? "Please send in one message:" : "Por favor envía en un solo mensaje:"}
👤 ${lang==="en"?"Full name":"Nombre completo"}
📞 ${lang==="en"?"Contact number (787/939 or US)":"Número de contacto (787/939 o EE.UU.)"}
⏰ ${lang==="en"?"Available time":"Horario disponible"}

${lang==="en"
  ? 'Example:\n"My name is Ana Rivera, 939-555-9999, 10am-1pm in Caguas"'
  : 'Ejemplo:\n"Me llamo Ana Rivera, 939-555-9999, 10am-1pm en Caguas"'}\n\n${FOOT}`;

    return res.status(200).send(twiml(msg));
  }

  // Si está esperando detalles, guarda y confirma
  if (s.last_choice && s.awaiting_details) {
    await db.run("UPDATE sessions SET details=?, awaiting_details=0 WHERE from_number=?", bodyRaw, from);
    const lbl = SERVICE_LABEL[lang]?.[s.last_choice] || s.last_choice;
    const confirm = lang === "en"
      ? `✅ Received. I saved your details:\n"${bodyRaw}"\n\nService: ${lbl}\n\n${FOOT}`
      : `✅ Recibido. Guardé tus detalles:\n"${bodyRaw}"\n\nServicio: ${lbl}\n\n${FOOT}`;
    return res.status(200).send(twiml(confirm));
  }

  // Facebook directo
  if (["facebook","fb"].includes(cmd)) {
    const fbMsg = lang==="en"
      ? `📘 Our Facebook page:\n${FB_LINK}\n\n${FOOT}`
      : `📘 Nuestra página de Facebook:\n${FB_LINK}\n\n${FOOT}`;
    return res.status(200).send(twiml(fbMsg));
  }

  // Por defecto: menú en el idioma de la sesión
  return res.status(200).send(twiml(MENU));
});

app.listen(PORT, () => {
  console.log(`💬 DestapesPR Bilingual Bot listening on http://localhost:${PORT}`);
});