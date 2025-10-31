cat > src/keywords.js <<'EOF'
/**
 * Limpia texto, detecta idioma y clasifica intención
 */

export function normalizeText(text = '') {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function detectLanguage(text) {
  const spanishWords = ['hola', 'gracias', 'cita', 'destape', 'fuga', 'camara'];
  const englishWords = ['hello', 'thanks', 'appointment', 'drain', 'leak', 'camera'];

  const txt = normalizeText(text);
  const esScore = spanishWords.filter(w => txt.includes(w)).length;
  const enScore = englishWords.filter(w => txt.includes(w)).length;
  return esScore >= enScore ? 'es' : 'en';
}

export function detectIntent(text) {
  const msg = normalizeText(text);

  const sets = {
    destape: ['tuberia', 'tubo', 'tapada', 'destapar', 'obstruida', 'baño', 'fregadero', 'lavamanos'],
    fuga: ['fuga', 'escape', 'chorro', 'goteo', 'salidero'],
    camara: ['camara', 'inspeccion', 'visual', 'ver tuberia'],
    cita: ['cita', 'agendar', 'visita', 'calendly', 'agenda', 'programar'],
    otros: ['hola', 'buenos', 'buenas', 'gracias', 'ok', 'saludos', 'hi', 'hello']
  };

  for (const [key, words] of Object.entries(sets)) {
    if (words.some(w => msg.includes(w))) return key;
  }
  return 'otros';
}
EOF