// Registers the service worker that keeps the app itself (pages, code, fonts) on the device, so
// the installed app opens without a connection. Web only, and only in a built app.
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const go = () => navigator.serviceWorker.register('/sw.js').then((reg) => {
    // An installed app can stay open for days; look for a newer version whenever it comes back into view.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
}
