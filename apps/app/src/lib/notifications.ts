// Notifications on this device (Web Push): turning them on asks for permission, subscribes with the
// server's public key and saves the subscription (push_subscriptions); the server's hourly run does the
// rest (supabase/functions/_shared/notify.ts). Settings are user_prefs.notify, shared by all devices.
import type { Note, NotifySettings } from '@budget-app/core';
import { lockEnabled } from './lock';
import { callFunction, supabase } from './supabase';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const b64u = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

/** A name for this device in the list: "Chrome on Android", "Chrome on Windows". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'this device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

async function registration() {
  // The service worker is only registered in a built app; register it here too so this works in any build.
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
}

/** This device's subscription, if it has one the server knows about. */
export async function deviceEndpoint(): Promise<string | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

export async function turnOn(s: NotifySettings): Promise<void> {
  if (!pushSupported()) throw new Error('This browser can’t show notifications from the app. On an iPhone, add the app to the home screen first.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.');
  const { publicKey } = await callFunction<{ publicKey: string }>('notify', { action: 'key' });
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (a reinstall of the server) has to be replaced.
  if (sub && b64u(sub.options.applicationServerKey as ArrayBuffer | null) !== publicKey) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const { error } = await supabase.from('push_subscriptions').upsert({ endpoint: sub.endpoint, p256dh: b64u(sub.getKey('p256dh')), auth: b64u(sub.getKey('auth')), device: deviceName() }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
  // Amounts stay off the lock screen by default when the app itself is locked.
  if (s.hideAmounts === undefined) await saveNotifySettings({ ...s, hideAmounts: lockEnabled() });
}

export async function turnOff(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
}

export interface Device { id: string; device: string | null; endpoint: string; created_at: string; last_ok_at: string | null }
/** Every device with notifications on. None before the migration. */
export async function loadDevices(): Promise<Device[]> {
  const { data, error } = await supabase.from('push_subscriptions').select('id, device, endpoint, created_at, last_ok_at').order('created_at');
  return error ? [] : (data ?? []) as Device[];
}
export async function removeDevice(id: string) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function loadNotifySettings(): Promise<NotifySettings> {
  const { data } = await supabase.from('user_prefs').select('notify').maybeSingle();
  return ((data as any)?.notify ?? {}) as NotifySettings;
}
export async function saveNotifySettings(s: NotifySettings) {
  const { error } = await supabase.from('user_prefs').upsert({ notify: s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export const sendTest = () => callFunction<{ devices: number }>('notify', { action: 'test' });
export const preview = () => callFunction<{ notes: Note[] }>('notify', { action: 'preview' }).then((r) => r.notes);
