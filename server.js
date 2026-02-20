/* DEPLOY_BUMP: 2026-02-20T19:30:11Z */
import "dotenv/config";
import express from "express";
import morgan from "morgan";

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(morgan("dev"));

const PORT = process.env.PORT || 10000;

function twiml(msg) {
  const safe = String(msg || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

app.get("/", (req, res) => res.status(200).send("DestapesPR WhatsApp bot activo ✅"));
app.get("/webhook/whatsapp", (req, res) => res.status(200).send("OK"));
app.get("/twilio", (req, res) => res.status(200).send("OK"));

app.post(["/twilio", "/webhook/whatsapp"], (req, res) => {
  const body = (req.body.Body || "").trim();
  if (!body) {
    return res.status(200).set("Content-Type","text/xml").send(twiml("OK"));
  }
  if (body.toLowerCase() === "menu" || body.toLowerCase() === "menú") {
    return res.status(200).set("Content-Type","text/xml").send(twiml("✅ MENU OK (deploy confirmado)"));
  }
  return res.status(200).set("Content-Type","text/xml").send(twiml("✅ OK"));
});

app.listen(PORT, () => console.log(`✅ listening on ${PORT}`));
