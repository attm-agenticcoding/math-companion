// Passcode encryption shared by the build (Node 20+) and the browser (Safari).
// AES-256-GCM; the key comes from the passcode via PBKDF2-SHA-256.
// Each encrypted item is bound to a label (its "additional data"), so a file
// cannot be swapped for another one without the decryption failing.

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
const MAGIC = utf8.encode('MCE1');

export function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Raw 32-byte key derived from the passcode. Slow on purpose. */
export async function deriveRawKey(passcode, saltB64, iterations) {
  const base = await subtle.importKey('raw', utf8.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64decode(saltB64), iterations },
    base,
    256,
  );
  return new Uint8Array(bits);
}

export function importKey(raw) {
  return subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes, label) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(label) }, key, bytes),
  );
  return { iv, ct };
}

export async function decryptBytes(key, iv, ct, label) {
  return new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(label) }, key, ct),
  );
}

/** JSON value -> {v, iv, ct} with base64 fields. */
export async function encryptJSON(key, value, label) {
  const { iv, ct } = await encryptBytes(key, utf8.encode(JSON.stringify(value)), label);
  return { v: 1, iv: b64encode(iv), ct: b64encode(ct) };
}

export async function decryptJSON(key, box, label) {
  if (!box || box.v !== 1) throw new Error('Unknown encrypted format');
  const bytes = await decryptBytes(key, b64decode(box.iv), b64decode(box.ct), label);
  return JSON.parse(fromUtf8.decode(bytes));
}

/** Binary file -> "MCE1" + iv(12) + ciphertext. Used for videos and captions. */
export async function encryptFile(key, bytes, label) {
  const { iv, ct } = await encryptBytes(key, bytes, label);
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

export async function decryptFile(key, bytes, label) {
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('Not an encrypted file');
  }
  return decryptBytes(key, bytes.subarray(4, 16), bytes.subarray(16), label);
}

export const labels = {
  check: 'check',
  index: 'private-index',
  lesson: (id) => `lesson:${id}`,
  media: (id, name) => `media:${id}/${name}`,
};
