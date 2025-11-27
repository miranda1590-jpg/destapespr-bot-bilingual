// DestapesPR Bot 5 Pro 🇵🇷 – MENÚ BILINGÜE SIEMPRE

import express from 'express';
import morgan from 'morgan';

const app = express();
const PORT = process.env.PORT || 10000;
const TAG = 'DestapesPR Bot 5 Pro 🇵🇷';

const PHONE = '787-922-0068';
const FACEBOOK = 'https://www.facebook.com/destapesPR/';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));

// ======================= MENSAJE PRINCIPAL BILINGÜE =======================

function mainMenu() {
  return `${TAG}

🇵🇷 Bienvenido a DestapesPR / Welcome to DestapesPR

🔁 Comandos / Commands:
• "inicio", "menu" o "volver" → menú principal
• "start", "menu" or "back" → main menu
• Puedes escribir en español o en inglés, el menú siempre será bilingüe.

📋 Servicios / Services:
1️⃣ - Destape (drenajes o tuberías tapadas) / Unclog & drain cleaning
2️⃣ - Fuga de agua / Water leak
3️⃣ - Cámara (inspección con cámara) / Camera inspection
4️⃣ - Calentador (gas o eléctrico) / Water heater (gas or electric)
5️⃣ - Otro servicio / Other service
6️⃣ - Cita / Appointment

📘 Facebook: ${FACEBOOK}
☎️ Teléfono / Phone: ${PHONE}

🤖 DestapesPR Bot 5 Pro 🇵🇷`;
}

// ======================= HELPERS TWILIO =======================

function sendTwilioXML(res, text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Message>${safe}</Message></Response>`;

  res.set('Content-Type', 'application/xml; charset=utf-8');
  return res.status(200).send(xml);
}

// ======================= RUTAS DE DIAGNÓSTICO =======================

app.get('/__version', (_req, res) => {
  res.json({
    ok: true,
    tag: TAG,
    tz: 'America/Puerto_Rico',
  });
});

app.get('/', (_req, res) => {
  res.send(`${TAG} – online ✅`);
});

// ======================= WEBHOOK PRINCIPAL WHATSAPP =======================

app.post('/webhook/whatsapp', async (req, res) => {
  try {
    // Leemos pero realmente ignoramos el contenido;
    // siempre devolvemos el mismo menú bilingüe.
    const from =
      req.body.From ||
      req.body.from ||
      req.body.WaId ||
      req.body.waId ||
      '';
    const body =
      req.body.Body ||
      req.body.body ||
      '';

    console.log('Incoming WhatsApp:', { from, body });

    const reply = mainMenu();
    return sendTwilioXML(res, reply);
  } catch (err) {
    console.error('Error in /webhook/whatsapp', err);
    return sendTwilioXML(
      res,
      'Ocurrió un error temporal. Intenta de nuevo en unos momentos.',
    );
  }
});

// ======================= ARRANQUE DEL SERVIDOR =======================

app.listen(PORT, () => {
  console.log(`${TAG} listening on http://localhost:${PORT}`);
});