// src/reminders.js
// Esta versión es mínima: deja preparado el sistema de recordatorios para pruebas locales.
// Si Render o Twilio lo llama, no romperá tu bot.

export function scheduleAllForBooking({
  to,
  lang = 'es',
  whenISO,
  service,
  name = 'Cliente',
  address = 'por confirmar',
  slotLabel,
  dateLabel,
  durationMin = 60
}) {
  console.log('⏰ Simulación de recordatorio programado:');
  console.log({
    to,
    lang,
    whenISO,
    service,
    name,
    address,
    slotLabel,
    dateLabel,
    durationMin
  });

  // En el futuro aquí puedes integrar Twilio, Calendly o Render cron jobs
  return { ok: true };
}