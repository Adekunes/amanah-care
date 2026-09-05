// Client crypto (web/crypto.js) run under Node's WebCrypto. Same code the browser runs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeKey, exportKeyRaw, importKeyRaw, keyCheck, encryptJSON, decryptJSON, b64 } from '../web/crypto.js';

describe('crypto.js', () => {
  test('makeKey gives a 256-bit AES-GCM key that exports to 32 raw bytes', async () => {
    const key = await makeKey();
    assert.equal(key.algorithm.name, 'AES-GCM');
    assert.equal(key.algorithm.length, 256);
    const raw = await exportKeyRaw(key);
    assert.equal(b64.to(raw).length, 32);
  });

  test('export then import yields the same key (same key_check)', async () => {
    const key = await makeKey();
    const again = await importKeyRaw(await exportKeyRaw(key));
    assert.equal(await keyCheck(again), await keyCheck(key));
  });

  test('keyCheck is 64 hex chars and differs between keys', async () => {
    const a = await keyCheck(await makeKey());
    const b = await keyCheck(await makeKey());
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.notEqual(a, b);
  });

  test('encryptJSON / decryptJSON round-trip a payload', async () => {
    const key = await makeKey();
    const obj = { text: 'meds given (with water)', routine_id: 'r1', n: 3, ok: true };
    const { iv, cipher } = await encryptJSON(key, obj);
    assert.deepEqual(await decryptJSON(key, iv, cipher), obj);
  });

  test('every encryption uses a fresh 96-bit IV, so identical payloads differ on the wire', async () => {
    const key = await makeKey();
    const a = await encryptJSON(key, { text: 'same' });
    const b = await encryptJSON(key, { text: 'same' });
    assert.equal(b64.to(a.iv).length, 12);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.cipher, b.cipher);
  });

  test('ciphertext never contains the plaintext', async () => {
    const key = await makeKey();
    const { cipher } = await encryptJSON(key, { text: 'refused food at lunch' });
    const bytes = Buffer.from(cipher, 'base64').toString('latin1');
    assert.equal(bytes.includes('refused food'), false);
  });

  test('wrong key decrypts to null (caller shows a lock, never garbage)', async () => {
    const { iv, cipher } = await encryptJSON(await makeKey(), { text: 'secret' });
    assert.equal(await decryptJSON(await makeKey(), iv, cipher), null);
  });

  test('tampered ciphertext decrypts to null (AES-GCM authenticates)', async () => {
    const key = await makeKey();
    const { iv, cipher } = await encryptJSON(key, { text: 'secret' });
    const bytes = b64.to(cipher);
    bytes[bytes.length - 1] ^= 0x01;
    assert.equal(await decryptJSON(key, iv, b64.from(bytes)), null);
  });

  test('missing ciphertext decrypts to null', async () => {
    assert.equal(await decryptJSON(await makeKey(), 'AAAAAAAAAAAAAAAA', ''), null);
  });

  test('b64 helpers round-trip arbitrary bytes', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff);
    assert.deepEqual([...b64.to(b64.from(bytes))], [...bytes]);
  });
});
