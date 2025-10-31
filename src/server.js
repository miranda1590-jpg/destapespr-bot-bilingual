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

const MENU_ES = `Bienvenido a DestapesPR 👋
Escribe el número o la palabra:
1 - Destape
2 - Fuga
3 - Cámara
4 - Calentador
5 - Cita

Escribe "menu en" para inglés.`;

const MENU_EN = `Welcome to DestapesPR 👋
Type the number or the word:
1 - Unclog
2 - Leak
3 - Camera
4 - Water heater
5 - Appointment`;

const RESP_ES = {
  destape: `Perfecto. ¿Municipio/sector y qué línea (fregadero, inodoro, principal)?${CIERRE}`,
  fuga: `¿Dónde notas la fuga/humedad y desde cuándo?${CIERRE}`,
  camara: `Hacemos inspección con cámara. ¿En qué área (baño, cocina, principal)?${CIERRE}`,
  calentador: `¿Es eléctrico o gas? ¿Qué falla notas?${CIERRE}`,
  cita: `Por favor escribe: nombre, teléfono (787/939/US), municipio o sector y horario preferido.${CIERRE}`,
};
const RESP_EN = {
  unclog: `What area (city/sector) and which line (sink, toilet, main)?${CIERRE}`,
  leak: `Where do you see moisture/leak and since when?${CIERRE}`,
  camera: `We do camera inspections. Which area (bathroom, kitchen, main)?${CIERRE}`,
  heater: `Is it electric or gas? What's the issue?${CIERRE}`,
  appointment: `Please send: name, phone (US), city/sector and preferred contact time.${CIERRE}`,
};

const norm = s => String(s||"").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,"").trim();

function detect(raw) {
  const b = norm(raw);
  // Menús
  if (["menu","inicio","volver","hola","buenas"].includes(b)) return {lang:"es", key:"menu"};
  if (["menu en","english","en","hi","hello","start"].includes(b)) return {lang:"en", key:"menu"};

  // Español
  if (["1","destape","tapon","tapada","obstruccion","drenaje"].includes(b)) return {lang:"es", key:"destape"};
  if (["2","fuga","goteo","filtracion","humedad"].includes(b)) return {lang:"es", key:"fuga"};
  if (["3","camara","cámara","inspeccion"].includes(b)) return {lang:"es", key:"camara"};
  if (["4","calentador","boiler"].includes(b)) return {lang:"es", key:"calentador"};
  if (["5","cita","agendar","reserva"].includes(b)) return {lang:"es", key:"cita"};

  // Inglés
  if (["1","unclog","clog","drain"].includes(b)) return {lang:"en", key:"unclog"};
  if (["2","leak","leaking","moisture"].includes(b)) return {lang:"en", key:"leak"};
  if (["3","camera","inspection","video"].includes(b)) return {lang:"en", key:"camera"};
  if (["4","water heater","heater","boiler"].includes(b)) return {lang:"en", key:"heater"};
  if (["5","appointment","schedule"].includes(b)) return {lang:"en", key:"appointment"};

  // Heurística
  if (b.includes("destape")||b.includes("tapon")||b.includes("obstru")||b.includes("drenaje")) return {lang:"es", key:"destape"};
  if (b.includes("fuga")||b.includes("gote")||b.includes("filtrac")||b.includes("humedad")) return {lang:"es", key:"fuga"};
  if (b.includes("camara")||b.includes("cámara")||b.includes("inspecc")) return {lang:"es", key:"camara"};
  if (b.includes("calentador")||b.includes("boiler")||b.includes("agua caliente")) return {lang:"es", key:"calentador"};
  if (b.includes("cita")||b.includes("agenda")) return {lang:"es", key:"cita"};

  if (b.includes("clog")||b.includes("unclog")) return {lang:"en", key:"unclog"};
  if (b.includes("leak")) return {lang:"en", key:"leak"};
  if (b.includes("camera")) return {lang:"en", key:"camera"};
  if (b.includes("heater")) return {lang:"en", key:"heater"};
  if (b.includes("appointment")||b.includes("schedule")) return {lang:"en", key:"appointment"};

  return {lang:"es", key:"menu"};
}

function twiml(res, text) {
  const safe = String(text).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
  res.set("Content-Type","application/xml");
  return res.status(200).send(xml);
}

// Health & version
app.get("/", (_req,res) => res.send(`${TAG} OK`));
app.get("/__version", (_req,res) => res.json({ ok:true, tag: TAG }));

// Webhook principal
app.post("/webhook/whatsapp", (req,res) => {
  const body = req.body.Body || req.body.body || "";
  const d = detect(body);
  if (d.lang === "en") {
    if (d.key === "menu") return twiml(res, MENU_EN);
    const map = {unclog:"unclog", leak:"leak", camera:"camera", heater:"heater", appointment:"appointment"};
    return twiml(res, RESP_EN[map[d.key]] || MENU_EN);
  }
  if (d.key === "menu") return twiml(res, MENU_ES);
  const mapES = {destape:"destape", fuga:"fuga", camara:"camara", calentador:"calentador", cita:"cita"};
  return twiml(res, RESP_ES[mapES[d.key]] || MENU_ES);
});

// Alias por compatibilidad
app.post("/api/whatsapp", (req,res)=> app._router.handle(req,res,()=>{},"post","/webhook/whatsapp"));
app.post("/whatsapp/webhook", (req,res)=> app._router.handle(req,res,()=>{},"post","/webhook/whatsapp"));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`💬 ${TAG} escuchando en http://localhost:${PORT}`);
});