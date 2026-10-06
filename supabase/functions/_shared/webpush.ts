// Web Push, written on the platform's own crypto (no library): the message is encrypted for the one
// device (RFC 8291, aes128gcm) and the request is signed with the server's key (VAPID, RFC 8292).
// The push service (Google's for Chrome on Android) only carries the encrypted bytes.

/** Bytes over a plain ArrayBuffer, which is what the crypto and fetch calls take. */
type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();
export const b64u = (b: Bytes) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const cat = (...parts: Bytes[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

/** HKDF (extract and expand) with SHA-256. */
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** The server's signing key pair: `publicKey` (base64url, 65 bytes raw) is what the app subscribes with. */
export interface Vapid { publicKey: string; privateJwk: JsonWebKey; subject: string }

export async function makeVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64u(raw), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}

/** The Authorization header for a push service: a JWT signed with the server's key. */
export async function vapidAuth(endpoint: string, v: Vapid, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: v.subject })));
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${v.publicKey}`;
}

/** Encrypts `payload` for one device (its p256dh public key and auth secret, both base64url). */
export async function encryptPayload(payload: Bytes, p256dh: string, auth: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<Bytes> {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const peer = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, body);
}

export interface Subscription { endpoint: string; p256dh: string; auth: string }

/** Sends one message. `gone` = the device unsubscribed (404/410): its row should be removed. */
export async function sendPush(sub: Subscription, message: unknown, v: Vapid, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const r = await fetcher(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, v), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    body,
  });
  await r.body?.cancel().catch(() => {});
  return { ok: r.ok, gone: r.status === 404 || r.status === 410, status: r.status };
}
