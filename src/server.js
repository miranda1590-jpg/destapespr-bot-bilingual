import express from "express";
import morgan from "morgan";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan("dev"));

// =====================
// CONFIG
// =====================
const TAG = "DestapesPR Bot (Bilingual)";
const CIERRE = `
✅ Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR`;

const MENU_ES = `👋 *Bienvenido a DestapesPR*

Escribe el número o la palabra del servicio que necesitas:

1️⃣ - Destape (drenajes o tuberías tapadas)
2️⃣ - Fuga (fugas de agua)
3️⃣ - Cámara (inspección con cámara)
4️⃣ - Calentador (gas o eléctrico)
5️⃣ - Cita (agendar servicio)

🗣️ Si deseas continuar en *inglés*, escribe *english* o *menu en*`;

const MENU_EN = `👋 *Welcome to DestapesPR*

Type the number or word of the service you need:

1️⃣ - Unclog (drain or pipe cleaning)
2️⃣ - Leak (water leak)
3️⃣ - Camera (pipe inspection)
4️⃣ - Water heater (gas or electric)
5️⃣ - Appointment (schedule a service)

🗣️ To switch to *Spanish*, type *español* or *menu es*`;

const RESP_ES = {
  destape: `Perfecto. ¿En qué área estás (municipio o sector)?
Luego cuéntame qué línea está tapada (fregadero, inodoro, principal, etc.).${CIERRE}`,
  fuga: `Entendido. ¿Dónde notas la fuga o humedad? ¿Es dentro o fuera de la propiedad?${CIERRE}`,
  camara: `Realizamos inspección con cámara. ¿En qué área la necesitas (baño, cocina, línea principal)?${CIERRE}`,
  calentador: `Revisamos calentadores eléctricos o de gas. ¿Qué tipo tienes y qué problema notas?${CIERRE}`,
  cita: `Por favor escribe:
- Tu *nombre completo*,
- Tu *número de teléfono* (787 / 939 / US),
- El *municipio o sector*,
- Y el *horario de contacto* preferido.${CIERRE}`,
};

const RESP_EN = {
  unclog: `Perfect. What area are you in (city or sector)?
Then tell me which line is clogged (sink, toilet, main, etc.).${CIERRE}`,
  leak: `Understood. Where do you notice the leak or moisture? Is it inside or outside the property?${CIERRE}`,
  camera: `We perform camera inspections. In which area do you need it (bathroom, kitchen, main line)?${CIERRE}`,
  heater: `We service electric and gas water heaters. Which type do you have and what issue are you experiencing?${CIERRE}`,
  appointment: `Please provide:
- Your *full name*,
- Your *phone number* (787 / 939 / US),
- Your *city or area*,
- And your *preferred contact time*.${CIERRE}`,
};

// =====================
// DETECTOR DE IDIOMA
// =====================
const norm = s => String(s || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .trim();

function detect(raw) {
  const b = norm(raw);

  // Cambiar idioma explícitamente
  if (b.includes("english") || b.includes("menu en")) return { lang: "en", key: "menu" };
  if (b.includes("espanol") || b.includes("menu es")) return { lang: "es", key: "menu" };

  // Saludos → idioma por palabra
  if (["hi", "hello", "hey"].some(x => b.includes(x))) return { lang: "en", key: "menu" };
  if (["hola", "buenas"].some(x => b.includes(x))) return { lang: "es", key: "menu" };

  // Menú general
  if (["menu", "inicio", "volver", "start"].includes(b)) return { lang: "es", key: "menu" };

  // Inglés
  if (["1", "unclog", "clog", "drain"].includes(b)) return { lang: "en", key: "unclog" };
  if (["2", "leak", "moisture"].includes(b)) return { lang: "en", key: "leak" };
  if (["3", "camera", "inspection"].includes(b)) return { lang: "en", key: "camera" };
  if (["4", "heater", "water heater"].includes(b)) return { lang: "en", key: "heater" };
  if (["5", "appointment", "schedule"].includes(b)) return { lang: "en", key: "appointment" };

  // Español
  if (["1", "destape", "tapon", "tapada", "drenaje"].includes(b)) return { lang: "es", key: "destape" };
  if (["2", "fuga", "goteo", "filtracion", "humedad"].includes(b)) return { lang: "es", key: "fuga" };
  if (["3", "camara", "cámara", "inspeccion"].includes(b)) return { lang: "es", key: "camara" };
  if (["4", "calentador", "boiler"].includes(b)) return { lang: "es", key: "calentador" };
  if (["5", "cita", "agendar", "reservar"].includes(b)) return { lang: "es", key: "cita" };

  return { lang: "es", key: "menu" };
}

// =====================
// TWILIO XML RESPONSE
// =====================
function twiml(res, text) {
  const safe = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set("Content-Type", "application/xml");
  return res.status(200).send(xml);
}

// =====================
// ENDPOINTS
// =====================
app.get("/", (_req, res) => res.send(`${TAG} ✅`));
app.get("/__version", (_req, res) => res.json({ ok: true, tag: TAG }));

app.post("/webhook/whatsapp", (req, res) => {
  const body = req.body.Body || req.body.body || "";
  const { lang, key } = detect(body);

  if (lang === "en") {
    if (key === "menu") return twiml(res, MENU_EN);
    return twiml(res, RESP_EN[key] || MENU_EN);
  }

  if (key === "menu") return twiml(res, MENU_ES);
  return twiml(res, RESP_ES[key] || MENU_ES);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`💬 ${TAG} escuchando en http://localhost:${PORT}`);
});