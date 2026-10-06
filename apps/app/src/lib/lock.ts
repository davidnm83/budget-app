// App lock (PLT-2): a fingerprint (or face) check, or a PIN, before the app shows anything.
//
// It is a real lock, not just a screen over the app. Turning it on creates a random master key
// that encrypts the saved sign-in and the offline copy of your data. That key is never stored as
// it is. It is stored wrapped (encrypted) twice:
//   • by a key made from your PIN (PBKDF2), and
//   • by a key only your fingerprint can produce: the device's passkey gives back a secret
//     ("PRF") after it has checked you, and that secret unwraps the master key.
// Without the PIN or the fingerprint, what is on the device can't be read.
//
// Where the browser or phone can't hand back that secret, the fingerprint still works as a check
// before the app opens, but the key it releases is one the browser holds ("gate" mode). That is
// the same protection the offline copy had before the lock existed; Settings says which you have.
//
// The key lives in memory only while unlocked. It is dropped when the app has been in the
// background for LOCK_AFTER_MIN minutes, and is never there on a fresh start.
// Web only. The lock is per device and tied to the site's address.
import { useSyncExternalStore } from 'react';

export const LOCK_AFTER_MIN = 5;
const PIN_ITER = 600000;
const CFG = 'lock.v1', FAILS = 'lock.fails';
const TAG = 'lockenc:';

type Wrapped = { iv: string; data: string };
interface Config { v: 1; mode: 'prf' | 'gate' | 'pin'; credId?: string; salt?: string; prf?: Wrapped; pin: Wrapped & { salt: string; iter: number } }
export type LockMode = Config['mode'];

const can = typeof localStorage !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
export const lockAvailable = can;
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const enc = (s: string) => new TextEncoder().encode(s);
const AES = { name: 'AES-GCM', length: 256 } as const;

function readCfg(): Config | null { if (!can) return null; try { const c = JSON.parse(localStorage.getItem(CFG) ?? 'null'); return c?.v === 1 ? c : null; } catch { return null; } }
let cfg = readCfg();
let K: CryptoKey | null = null;
let waiting: (() => void)[] = [];

// ---- state for the screens -----------------------------------------------------------------
/** `covered`: the app is in the background with the lock on, so it's hidden (app switcher, the moment it comes back). */
export interface LockState { enabled: boolean; locked: boolean; mode: LockMode | null; covered: boolean }
let covered = false;
const snap = (): LockState => ({ enabled: !!cfg, locked: !!cfg && !K, mode: cfg?.mode ?? null, covered: !!cfg && covered });
let state = snap();
const subs = new Set<() => void>();
const emit = () => { state = snap(); subs.forEach((f) => f()); };
const OFF: LockState = { enabled: false, locked: false, mode: null, covered: false };
export function useLock(): LockState { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => OFF); }
export const lockEnabled = () => !!cfg;
export const isLocked = () => !!cfg && !K;
/** Resolves once the app is unlocked (at once when the lock is off). */
export const whenUnlocked = () => (isLocked() ? new Promise<void>((ok) => waiting.push(ok)) : Promise.resolve());
/** The master key; throws while locked. */
export function lockKey(): CryptoKey { if (!K) throw new Error('The app is locked.'); return K; }

function opened(key: CryptoKey) { K = key; try { localStorage.removeItem(FAILS); } catch { /* ignore */ } const w = waiting; waiting = []; emit(); w.forEach((f) => f()); }
/** Lock straight away (also what happens after LOCK_AFTER_MIN minutes in the background). */
export function lockNow() { if (cfg && K) { K = null; emit(); } }

// ---- crypto helpers ------------------------------------------------------------------------
async function wrap(raw: Uint8Array, by: CryptoKey): Promise<Wrapped> {
  const iv = rand(12);
  return { iv: b64(iv), data: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, by, raw as BufferSource)) };
}
async function unwrap(w: Wrapped, by: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) as BufferSource }, by, unb64(w.data) as BufferSource);
  return crypto.subtle.importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);
}
async function pinKey(pin: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, AES, false, ['encrypt', 'decrypt']);
}
async function prfKey(secret: ArrayBuffer) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc('budget-app lock v1') }, base, AES, false, ['encrypt', 'decrypt']);
}

// The key the browser holds in "gate" mode: stored so it can be used but not read out.
function gateDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => { const r = indexedDB.open('budget-lock', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
}
async function gateKey(set?: CryptoKey | null): Promise<CryptoKey | null> {
  const db = await gateDb();
  return new Promise((ok, fail) => {
    const s = db.transaction('kv', set === undefined ? 'readonly' : 'readwrite').objectStore('kv');
    const r = set === undefined ? s.get('key') : set === null ? s.delete('key') : s.put(set, 'key');
    r.onsuccess = () => ok(set === undefined ? (r.result as CryptoKey) ?? null : null); r.onerror = () => fail(r.error);
  });
}

// ---- fingerprint (a passkey kept by this device) ---------------------------------------------
const webauthn = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
export async function fingerprintAvailable(): Promise<boolean> {
  try { return webauthn() && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}
/** Ask the device to check the person. Returns the passkey's secret when the device gives one. */
async function assert(credId: string, salt: string): Promise<ArrayBuffer | null> {
  const got = await navigator.credentials.get({ publicKey: {
    challenge: rand(32) as BufferSource, rpId: location.hostname, userVerification: 'required', timeout: 60000,
    allowCredentials: [{ type: 'public-key', id: unb64(credId) as BufferSource, transports: ['internal'] }],
    extensions: { prf: { eval: { first: unb64(salt) } } } as any,
  } }) as PublicKeyCredential | null;
  if (!got) throw new Error('The fingerprint check was cancelled.');
  return ((got.getClientExtensionResults() as any).prf?.results?.first as ArrayBuffer | undefined) ?? null;
}
async function register(userName: string): Promise<{ credId: string; salt: string; secret: ArrayBuffer | null } | null> {
  if (!(await fingerprintAvailable())) return null;
  const salt = b64(rand(32));
  try {
    const made = await navigator.credentials.create({ publicKey: {
      challenge: rand(32) as BufferSource, rp: { name: 'Budget', id: location.hostname },
      user: { id: rand(16) as BufferSource, name: userName, displayName: `${userName} (app lock)` },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000, extensions: { prf: { eval: { first: unb64(salt) } } } as any,
    } }) as PublicKeyCredential | null;
    if (!made) return null;
    const credId = b64(made.rawId);
    const ext = (made.getClientExtensionResults() as any).prf;
    let secret: ArrayBuffer | null = ext?.results?.first ?? null;
    // Some devices only hand the secret back on a check, not when the passkey is made.
    if (!secret && ext?.enabled) { try { secret = await assert(credId, salt); } catch { secret = null; } }
    return { credId, salt, secret };
  } catch { return null; } // cancelled or not allowed: carry on with the PIN alone
}

// ---- turning it on and off ---------------------------------------------------------------------
export const pinProblem = (pin: string) => (/^\d{6,12}$/.test(pin) ? '' : 'Use 6 to 12 digits.');

/** Turn the lock on. Returns how the fingerprint ended up working ('pin' = no fingerprint on this device). */
export async function setupLock(pin: string, userName: string): Promise<LockMode> {
  if (!can) throw new Error('The app lock needs the web version over a secure (https) address.');
  const bad = pinProblem(pin); if (bad) throw new Error(bad);
  const raw = rand(32);
  const salt = rand(16);
  const pinWrap = { ...(await wrap(raw, await pinKey(pin, salt, PIN_ITER))), salt: b64(salt), iter: PIN_ITER };
  const fp = await register(userName);
  const key = await crypto.subtle.importKey('raw', raw as BufferSource, AES, false, ['encrypt', 'decrypt']);
  let next: Config;
  if (fp?.secret) next = { v: 1, mode: 'prf', credId: fp.credId, salt: fp.salt, prf: await wrap(raw, await prfKey(fp.secret)), pin: pinWrap };
  else if (fp) { await gateKey(key); next = { v: 1, mode: 'gate', credId: fp.credId, salt: fp.salt, pin: pinWrap }; }
  else next = { v: 1, mode: 'pin', pin: pinWrap };
  raw.fill(0);
  localStorage.setItem(CFG, JSON.stringify(next));
  cfg = next; opened(key);
  return next.mode;
}

/** Remove the lock from this device. Nothing is decrypted: call unprotectStored first if the data should be kept. */
export async function forgetLock() {
  if (!can) return;
  try { localStorage.removeItem(CFG); localStorage.removeItem(FAILS); } catch { /* ignore */ }
  try { await gateKey(null); } catch { /* ignore */ }
  cfg = null; K = null; const w = waiting; waiting = []; emit(); w.forEach((f) => f());
}

// ---- unlocking ---------------------------------------------------------------------------------
/** Seconds to wait before another PIN try (0 = go ahead). Five free tries, then 30 s, doubling to 15 min. */
export function pinWait(): number {
  try { const f = JSON.parse(localStorage.getItem(FAILS) ?? 'null'); return f?.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; } catch { return 0; }
}
function failed() {
  let n = 1; try { n = (JSON.parse(localStorage.getItem(FAILS) ?? 'null')?.n ?? 0) + 1; } catch { /* first */ }
  const until = n >= 5 ? Date.now() + Math.min(900, 30 * 2 ** (n - 5)) * 1000 : 0;
  try { localStorage.setItem(FAILS, JSON.stringify({ n, until })); } catch { /* ignore */ }
}
export async function unlockWithPin(pin: string) {
  if (!cfg) return;
  const wait = pinWait(); if (wait) throw new Error(`Too many wrong tries. Try again in ${wait < 60 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.`);
  let key: CryptoKey;
  try { key = await unwrap(cfg.pin, await pinKey(pin, unb64(cfg.pin.salt), cfg.pin.iter)); }
  catch { failed(); throw new Error('That PIN isn’t right.'); }
  opened(key);
}
export async function unlockWithFingerprint() {
  if (!cfg || cfg.mode === 'pin' || !cfg.credId || !cfg.salt) throw new Error('Fingerprint unlock isn’t set up on this device. Use your PIN.');
  const secret = await assert(cfg.credId, cfg.salt);
  if (cfg.mode === 'prf') {
    if (!secret || !cfg.prf) throw new Error('This device didn’t return what’s needed to unlock. Use your PIN.');
    opened(await unwrap(cfg.prf, await prfKey(secret)));
  } else {
    const key = await gateKey();
    if (!key) throw new Error('The key for this device is missing. Use your PIN.');
    opened(key);
  }
}

// ---- encrypting what's stored ------------------------------------------------------------------
export const isProtected = (v: string | null) => !!v && v.startsWith(TAG);
export async function protect(text: string): Promise<string> {
  const iv = rand(12);
  return TAG + b64(iv) + ':' + b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, lockKey(), enc(text)));
}
export async function unprotect(v: string): Promise<string> {
  const [iv, data] = v.slice(TAG.length).split(':');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, lockKey(), unb64(data) as BufferSource));
}
/** Encrypt (or decrypt) one localStorage entry in place, e.g. the saved sign-in when the lock is turned on (or off). */
export async function protectStored(k: string) { const v = localStorage.getItem(k); if (v && !isProtected(v)) localStorage.setItem(k, await protect(v)); }
export async function unprotectStored(k: string) { const v = localStorage.getItem(k); if (v && isProtected(v)) localStorage.setItem(k, await unprotect(v)); }

// ---- locking again after time in the background --------------------------------------------------
let hiddenAt = 0;
export function installAutoLock(): () => void {
  if (!can || typeof document === 'undefined') return () => {};
  // Covered the moment it's hidden, so neither the app switcher nor the return shows it; locked on the way
  // back once it has been away long enough (the cover comes off only after that's decided).
  const check = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); if (cfg && !covered) { covered = true; emit(); } return; }
    if (hiddenAt && Date.now() - hiddenAt >= LOCK_AFTER_MIN * 60000) lockNow();
    hiddenAt = 0;
    if (covered) { covered = false; emit(); }
  };
  document.addEventListener('visibilitychange', check);
  return () => document.removeEventListener('visibilitychange', check);
}
