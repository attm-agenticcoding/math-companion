// Everything is kept on this iPad only (Safari's local storage). Nothing is
// sent anywhere. Safari can clear it if the site isn't opened for a few weeks;
// then the passcode is asked again and progress starts fresh.
import { b64encode, b64decode, importKey, decryptJSON, deriveRawKey, labels } from './crypto.js';

const P = 'mc.';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(P + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(P + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function remove(key) {
  try { localStorage.removeItem(P + key); } catch { /* ignore */ }
}

// ---- passcode key
const kdfId = (kdf) => `${kdf.salt}:${kdf.iterations}`;
let memoryKey = null;

/** Returns a CryptoKey if this iPad is already unlocked, else null. */
export async function savedKey(site) {
  if (memoryKey) return memoryKey;
  const s = read('key', null);
  if (!s || s.kdf !== kdfId(site.kdf)) return null;
  try {
    const key = await importKey(b64decode(s.raw));
    await decryptJSON(key, site.check, labels.check);
    memoryKey = key;
    return key;
  } catch {
    remove('key'); // passcode was changed
    return null;
  }
}

/** Try a passcode; on success remember it on this iPad. */
export async function unlock(site, passcode) {
  const raw = await deriveRawKey(passcode, site.kdf.salt, site.kdf.iterations);
  const key = await importKey(raw);
  try {
    await decryptJSON(key, site.check, labels.check);
  } catch {
    return null;
  }
  memoryKey = key;
  write('key', { kdf: kdfId(site.kdf), raw: b64encode(raw) });
  return key;
}

export function lock() {
  memoryKey = null;
  remove('key');
}

// ---- progress
export function progress(lessonId) {
  return read(`progress.${lessonId}`, { steps: {}, problems: {} });
}
export function saveProgress(lessonId, p) {
  write(`progress.${lessonId}`, p);
}
export function clearAllProgress() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(`${P}progress.`)) localStorage.removeItem(k);
  } catch { /* ignore */ }
}

// ---- questions the site couldn't answer (shown to the parent)
export function savedQuestions() {
  return read('questions', []);
}
export function saveQuestion(q) {
  const list = savedQuestions();
  list.unshift({ ...q, when: new Date().toISOString() });
  write('questions', list.slice(0, 200));
}
export function clearQuestions() {
  remove('questions');
}

// ---- parent settings
export function settings() {
  return read('settings', { dadEmail: '' });
}
export function saveSettings(s) {
  write('settings', s);
}
