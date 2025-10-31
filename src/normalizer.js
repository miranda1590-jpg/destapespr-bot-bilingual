const stripDiacritics = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');

export function normalizeText(input) {
  const original = String(input ?? '');
  const lower = original.toLowerCase().trim();
  const noDiacritics = stripDiacritics(lower);
  const cleaned = noDiacritics.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return { original, dbg_normalized: cleaned };
}

const KW_ES = ['fuga','obstruccion','tapado','destape','inundacion','olores','filtracion','bomba','calentador','tubo','drenaje','camara','raices'];
const KW_EN = ['leak','blockage','clog','unclog','flood','smell','odor','filtration','pump','heater','pipe','drain','camera','roots'];

const HINT_ES = ['el','la','los','las','que','una','bajo','fregadero','baño','exterior','cocina'];
const HINT_EN = ['the','and','is','are','under','sink','bathroom','outside','kitchen'];

export function detectLanguage(text) {
  const scoreEn = (KW_EN.some(k=>text.includes(k)) ? 2 : 0) + (HINT_EN.some(w=>text.includes(w)) ? 1 : 0);
  const scoreEs = (KW_ES.some(k=>text.includes(k)) ? 2 : 0) + (HINT_ES.some(w=>text.includes(w)) ? 1 : 0);
  if (scoreEn > scoreEs) return 'en';
  if (scoreEs > scoreEn) return 'es';
  return /[áéíóúñ]/i.test(text) ? 'es' : 'es';
}

export function detectKeyword(text, langGuess) {
  const list = langGuess === 'en' ? KW_EN : KW_ES;
  const words = text.split(/\s+/);
  for (const k of list) if (words.includes(k)) return mapToEs(k, langGuess);
  for (const k of list) if (text.includes(k)) return mapToEs(k, langGuess);
  return '';
}

function mapToEs(k, lang) {
  if (lang !== 'en') return k;
  const map = {
    leak:'fuga', blockage:'obstruccion', clog:'obstruccion', unclog:'destape',
    flood:'inundacion', smell:'olores', odor:'olores', filtration:'filtracion',
    pump:'bomba', heater:'calentador', pipe:'tubo', drain:'drenaje',
    camera:'camara', roots:'raices'
  };
  return map[k] || '';
}