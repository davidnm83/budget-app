// Run: deno test supabase/functions/_shared/notify.test.ts
// Web Push encryption and signing (checked the way a device and a push service would), and the hourly
// notification run against an in-memory stand-in for the database.
import { b64u, encryptPayload, makeVapidKeys, unb64u, vapidAuth } from './webpush.ts';
import { runNotifications } from './notify.ts';
import { fakeDb, type Row } from './fake_db.ts';
import { addDays } from './core/index.ts';

function assertEquals(a: unknown, b: unknown, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`);
}
type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();
const cat = (...p: Bytes[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, n: number): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
}

/** A device: its key pair and auth secret, and how it decrypts a message (RFC 8291, the receiving side). */
async function device() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const decrypt = async (body: Bytes) => {
    const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), data = body.slice(21 + idlen);
    const peer = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, pair.privateKey, 256));
    const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), pub, asPublic), 32);
    const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12) }, key, data));
    if (plain[plain.length - 1] !== 2) throw new Error('missing the last-record delimiter');
    return new TextDecoder().decode(plain.slice(0, -1));
  };
  return { p256dh: b64u(pub), auth: b64u(auth), decrypt };
}

Deno.test('web push: a device can decrypt the message', async () => {
  const d = await device();
  const body = await encryptPayload(enc.encode('{"title":"Rent due"}'), d.p256dh, d.auth);
  assertEquals(new DataView(body.buffer).getUint32(16), 4096, 'record size');
  assertEquals(await d.decrypt(body), '{"title":"Rent due"}');
});

Deno.test('web push: the VAPID signature verifies with the public key', async () => {
  const keys = await makeVapidKeys();
  const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'mailto:me@example.com' }, 1_800_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
  assertEquals(m[4], keys.publicKey);
  assertEquals(JSON.parse(new TextDecoder().decode(unb64u(m[2]))), { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 43200, sub: 'mailto:me@example.com' });
  const pub = await crypto.subtle.importKey('raw', unb64u(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), enc.encode(`${m[1]}.${m[2]}`));
  assertEquals(ok, true, 'signature');
});

Deno.test('hourly run: sends what is due once, removes devices that unsubscribed', async () => {
  const today = '2026-10-07', u = 'u1';
  const d = await device();
  const tables: Record<string, Row[]> = {
    push_subscriptions: [{ id: 's1', user_id: u, endpoint: 'https://push.example/abc', p256dh: d.p256dh, auth: d.auth }],
    push_keys: [], notification_log: [],
    user_prefs: [{ user_id: u, notify: { on: { checkin: false, radar: false, subs: false, goal: false, review: false } }, sync_every: null }],
    account_balances: [{ id: 'a1', user_id: u, name: 'Chequing', type: 'depository', balance: 600, plan_include: true, plan_buffer: 200, is_hidden: false }],
    plaid_items: [{ id: 'i1', user_id: u, institution_name: 'Test Bank', status: 'login_required' }],
    recurring: [{ id: 'r1', user_id: u, name: 'Rent', kind: 'bill', amount: -500, estimated: false, frequency: 'monthly', start_date: addDays(today, 1), end_date: null, account_id: 'a1', category_id: null, match_text: null, active: true }],
    plan_entries: [], transactions: [], accounts: [],
  };
  const db = fakeDb(tables);
  const seen: string[] = [];
  const ok = (async (_url: string, init: any) => { seen.push(JSON.parse(await d.decrypt(init.body)).title); return new Response(null, { status: 201 }); }) as typeof fetch;
  // 7 AM: inside quiet hours, nothing.
  assertEquals((await runNotifications(db, 7, today, ok)).sent, 0);
  // 9 AM: the bank, the bill tomorrow and the dip below the buffer.
  const r = await runNotifications(db, 9, today, ok);
  assertEquals(seen, ['Test Bank needs fixing', 'Rent $500 due tomorrow', 'Chequing dips to $100 tomorrow']);
  assertEquals(r.sent, 3);
  assertEquals(tables.push_keys.length, 1, 'a signing key was made and kept');
  // 10 AM: all already sent.
  assertEquals((await runNotifications(db, 10, today, ok)).sent, 0);
  // The next day the bank is still broken: one new reminder; the device has gone away, so it is removed.
  const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
  assertEquals((await runNotifications(db, 9, addDays(today, 1), gone)).sent, 0);
  assertEquals(tables.push_subscriptions.length, 0);
});
