import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');

function ensureDir(d) {
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {}
}

export function makeLog({ from, body, normalized, keyword }) {
  const ts = new Date().toISOString();
  return {
    ts,
    dbg_from: from || 'unknown',
    dbg_hasBody: body ? 'si' : 'no',
    dbg_normalized: normalized,
    dbg_keyword: keyword,
    dbg_sample: JSON.stringify(
      { keyword, dbg_normalized: normalized, dbg_keyword: keyword },
      null,
      2
    )
  };
}

export function writeLog(obj) {
  ensureDir(LOG_DIR);
  const file = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFile(file, JSON.stringify(obj) + '\n', () => {});
}