import { toast } from './toast';

// Registers the service worker that keeps the app itself (pages, code, fonts) on the device, so
// the installed app opens without a connection. Web only, and only in a built app.
export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // A newer version takes over in the background (the worker skips waiting); say so, and reload on a tap.
  // The very first install also takes control, so only count it when a version was already in charge.
  if (navigator.serviceWorker.controller) {
    let told = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (told) return; told = true;
      toast('Update ready', { action: { label: 'Reload', run: () => location.reload() } });
    });
  }
  const go = () => navigator.serviceWorker.register('/sw.js').then((reg) => {
    // An installed app can stay open for days; look for a newer version whenever it comes back into view.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
}
