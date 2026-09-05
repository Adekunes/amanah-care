// Amanah Care client crypto. All plaintext lives and dies in the browser.
// H is a 256-bit AES-GCM key made with WebCrypto. Never sent to the server.
// Every ciphertext carries a fresh random 96-bit IV (SR-10). key_check is the
// SHA-256 of the raw key bytes, hex (SR-02): proves possession, reveals nothing.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  from: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  to:   (s)   => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
};

export async function makeKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKeyRaw(key) {
  return b64.from(await crypto.subtle.exportKey('raw', key)); // base64 of 32 bytes
}

export async function importKeyRaw(b64raw) {
  const raw = b64.to(b64raw);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function keyCheck(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns { iv, cipher } both base64. New IV every call.
export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce
  const data = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: b64.from(iv), cipher: b64.from(ct) };
}

export async function decryptJSON(key, ivB64, cipherB64) {
  if (!cipherB64) return null;
  try {
    const iv = b64.to(ivB64);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64.to(cipherB64));
    return JSON.parse(dec.decode(pt));
  } catch { return null; } // wrong key or tampered -> null, caller shows a lock
}
