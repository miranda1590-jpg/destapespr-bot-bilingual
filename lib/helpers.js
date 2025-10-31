export function isBusinessHoursPR(d = new Date()) {
  const hour = d.getUTCHours() - 4; // PR UTC-4
  const h = (hour + 24) % 24;
  const day = d.getUTCDay(); // 0=Sun
  const isWeekday = day >= 1 && day <= 5;
  return isWeekday && h >= 8 && h < 17;
}

export function detectIntent(text='') {
  const t = (text || '').toLowerCase();
  if (/(emergen|inundaci|fuga|no sale agua|no hay agua|water heater explot|tuber[íi]a rota|leak|flood)/.test(t)) return 'EMERGENCIA';
  if (/(cita|agenda|hora|appointment|schedule)/.test(t)) return 'AGENDAR';
  if (/(membres[íi]a|plan|suscripci|membership)/.test(t)) return 'MEMBRESIA';
  if (/(precio|cu[aá]nto|cotiz|estimate|quote)/.test(t)) return 'COTIZACION';
  if (/(c[aá]mara|inspecci[oó]n|video|camera)/.test(t)) return 'INSPECCION';
  return 'OTRO';
}

export function detectLang(text='') {
  const t = (text||'').toLowerCase();
  const enHits = /(schedule|quote|leak|water heater|camera|business|residential|estimate)/.test(t);
  const esHits = /(cita|cotiz|fuga|calentador|c[aá]mara|negocio|residencial)/.test(t);
  if (enHits && !esHits) return 'EN';
  if (esHits && !enHits) return 'ES';
  return 'ES';
}
