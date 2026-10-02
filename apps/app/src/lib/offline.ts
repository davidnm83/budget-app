// PLT-7: a read-only copy of what you've looked at, for when there is no connection.
//
// Every read the app makes goes through `offlineFetch`. While connected, the answer is saved on
// this device; when the network can't be reached, the last saved answer is returned instead, and
// anything that would change data is refused with a plain message (nothing is queued).
//
// What is saved is encrypted (AES-GCM) with a key the browser generates and keeps in IndexedDB
// marked non-extractable: the app can use it but nothing can read it out or copy it. That keeps
// the data unreadable to anyone looking through the device's storage; it does not lock the app
// itself. Saved data is wiped on sign-out and dropped after KEEP_DAYS.
import { useSyncExternalStore } from 'react';
import { lockEnabled, lockKey } from './lock';

const DB = 'budget-offline';
const KEEP_DAYS = 30;       // saved answers older than this are deleted
const REFRESH_DAYS = 7;     // answers you've asked for this recently are kept fresh in the background
const REFRESH_MAX = 80;
const DAY = 86400000;
// Database functions that only read. Anything else sent with POST is treated as a change.
const READ_RPC = /\/rest\/v1\/rpc\/(report_|merchant_)/;
export const OFFLINE_WRITE = "You're offline. Changes can't be saved until you're back online.";
export const OFFLINE_MISS = "Not saved for offline use yet. Open this once while connected and it will be kept.";

const can = typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle && typeof localStorage !== 'undefined';
const ls = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

// ---- connection state, for the "Offline" pill --------------------------------------------------
export interface OfflineState { offline: boolean; since: number }
let state: OfflineState = { offline: false, since: can ? Number(ls('offline.lastOnline')) || 0 : 0 };
const subs = new Set<() => void>();
let lastStamp = 0;
function setOffline(off: boolean) {
  const now = Date.now();
  if (!off && now - lastStamp > 30000) { lastStamp = now; lsSet('offline.lastOnline', String(now)); if (!state.offline) state = { offline: false, since: now }; }
  if (off === state.offline) return;
  state = { offline: off, since: off ? state.since : now };
  subs.forEach((f) => f());
}
/** The device reports a connection again: stop treating the sign-in as offline. */
export const backOnline = () => setOffline(false);
export const isOffline = () => state.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
const NONE: OfflineState = { offline: false, since: 0 };
export function useOffline(): OfflineState {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => NONE);
}
if (can && typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOffline(true));
  if (navigator.onLine === false) state = { ...state, offline: true };
}

// ---- encrypted store ---------------------------------------------------------------------------
interface Saved { url: string; method: string; headers: Record<string, string>; body: string | null; status: number; resHeaders: Record<string, string>; text: string }
interface Row { id: string; iv: Uint8Array; data: ArrayBuffer; at: number; used: number }

let dbP: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return dbP ??= new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('res', { keyPath: 'id' }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
  });
}
const done = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
async function store(name: 'kv' | 'res', mode: IDBTransactionMode = 'readonly') { return (await db()).transaction(name, mode).objectStore(name); }

let keyP: Promise<CryptoKey> | null = null;
function key(): Promise<CryptoKey> {
  // With the app lock on, the lock's key is used: no fingerprint or PIN, no reading the saved data.
  if (lockEnabled()) return Promise.resolve().then(lockKey);
  return keyP ??= (async () => {
    const have = await done((await store('kv')).get('key'));
    if (have) return have as CryptoKey;
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await done((await store('kv', 'readwrite')).put(k, 'key'));
    return k;
  })();
}
async function idOf(parts: (string | null)[]): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n')));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function put(id: string, v: Saved, used: number) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(JSON.stringify(v)));
  await done((await store('res', 'readwrite')).put({ id, iv, data, at: Date.now(), used } satisfies Row));
}
async function open(row: Row | undefined): Promise<Saved | null> {
  if (!row) return null;
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv as BufferSource }, await key(), row.data))); }
  catch { return null; }
}
const get = async (id: string) => open(await done((await store('res')).get(id)) as Row | undefined);

/** Delete everything saved for offline use, and the key it was encrypted with. */
export async function wipeOffline() {
  if (!can) return;
  lsSet('offline.lastOnline', null); lsSet('offline.uid', null); lsSet('offline.refreshed', null);
  try { keyP = null; await done((await store('res', 'readwrite')).clear()); await done((await store('kv', 'readwrite')).clear()); } catch { /* nothing saved */ }
}
/** The saved answers were encrypted with a key that's no longer the one in use (the app lock was turned on or off): start again. */
export async function resetOfflineStore() {
  if (!can) return;
  try { keyP = null; await done((await store('res', 'readwrite')).clear()); await done((await store('kv', 'readwrite')).clear()); } catch { /* nothing saved */ }
}
/** Saved data belongs to one sign-in: a different user on this device starts from nothing. */
export async function offlineUser(uid: string) {
  if (!can) return;
  const was = ls('offline.uid');
  if (was && was !== uid) await wipeOffline();
  lsSet('offline.uid', uid);
}
async function prune() {
  const cut = Date.now() - KEEP_DAYS * DAY;
  const s = await store('res', 'readwrite');
  for (const row of (await done(s.getAll())) as Row[]) if (row.at < cut) s.delete(row.id);
}
if (can) setTimeout(() => { prune().catch(() => {}); }, 5000);

// ---- the fetch the Supabase client uses --------------------------------------------------------
const KEEP_RES = ['content-type', 'content-range'];
const json = (body: Record<string, unknown>) => new Response(JSON.stringify(body), { status: 503, headers: { 'content-type': 'application/json' } });
const response = (v: Saved) => new Response(v.status === 204 || v.method === 'HEAD' ? null : v.text, { status: v.status, headers: v.resHeaders });

function kindOf(url: string, method: string): 'read' | 'write' | 'pass' {
  if (url.includes('/rest/v1/')) return method === 'GET' || method === 'HEAD' || (method === 'POST' && READ_RPC.test(url)) ? 'read' : 'write';
  if (url.includes('/functions/v1/')) return 'write';
  return 'pass'; // sign-in and pictures look after themselves
}

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!can || (typeof input !== 'string' && !(input instanceof URL))) return fetch(input, init);
  const url = String(input), method = (init?.method ?? 'GET').toUpperCase();
  const kind = kindOf(url, method);
  if (kind === 'pass') return fetch(input, init).catch((e) => { if ((e as any)?.name !== 'AbortError') setOffline(true); throw e; });
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => { if (k !== 'authorization') headers[k] = v; });
  const body = typeof init?.body === 'string' ? init.body : null;
  const id = kind === 'read' ? await idOf([method, url, headers.accept ?? '', headers.prefer ?? '', headers.range ?? '', body]) : '';

  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    try {
      const was = state.offline;
      const res = await fetch(input, init);
      setOffline(false);
      // First answer after being offline with a sign-in that ran out meanwhile: show the saved
      // copy this once; the sign-in renews itself before the next request.
      if (was && res.status === 401 && kind === 'read') { const hit = await get(id).catch(() => null); if (hit) return response(hit); }
      if (kind === 'read' && res.ok) keep(id, { url, method, headers, body }, res.clone(), Date.now());
      return res;
    } catch (e) {
      if ((e as any)?.name === 'AbortError') throw e;
      setOffline(true);
    }
  } else setOffline(true);

  if (kind === 'write') return json({ message: OFFLINE_WRITE, error: OFFLINE_WRITE, code: 'OFFLINE' });
  const hit = await get(id).catch(() => null);
  return hit ? response(hit) : json({ message: OFFLINE_MISS, code: 'OFFLINE' });
}

function keep(id: string, req: Pick<Saved, 'url' | 'method' | 'headers' | 'body'>, res: Response, used: number) {
  const resHeaders: Record<string, string> = {};
  for (const h of KEEP_RES) { const v = res.headers.get(h); if (v) resHeaders[h] = v; }
  return res.text().then((text) => put(id, { ...req, status: res.status, resHeaders, text }, used)).catch(() => {});
}

/**
 * Bring what's saved up to date: asks again for everything you've looked at in the last week, a
 * few at a time, so the saved copy isn't only as fresh as your last visit to each page. Runs at
 * most every ten minutes, and stops at the first sign of no connection.
 */
export async function refreshSaved(token: string) {
  if (!can || isOffline()) return;
  if (Date.now() - Number(ls('offline.refreshed') || 0) < 10 * 60000) return;
  lsSet('offline.refreshed', String(Date.now()));
  const cut = Date.now() - REFRESH_DAYS * DAY;
  const rows = ((await done((await store('res')).getAll())) as Row[]).filter((r) => r.used >= cut).sort((a, b) => b.used - a.used).slice(0, REFRESH_MAX);
  let stop = false;
  const next = async (): Promise<void> => {
    const row = rows.shift();
    if (!row || stop) return;
    const v = await open(row);
    if (v) {
      try {
        const res = await fetch(v.url, { method: v.method, headers: { ...v.headers, authorization: `Bearer ${token}` }, body: v.body ?? undefined });
        if (res.ok) await keep(row.id, v, res, row.used); else if (res.status === 401) stop = true;
      } catch { stop = true; }
    }
    return next();
  };
  await Promise.all([next(), next(), next()]);
}
